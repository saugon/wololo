import XCTest
@testable import WololoKit

final class RunDetailTests: XCTestCase {
    private let now = fixtureNow

    private func stages(_ ids: [(String, TimeInterval, TimeInterval?)]) -> [[String: Any]] {
        ids.map { id, start, end in
            ["id": id, "started_at": start, "finished_at": end.map { $0 as Any } ?? NSNull()]
        }
    }

    func testScenario10CompletedStagesHaveDurations() throws {
        let run = try makeRun("r", status: "waiting_user", [
            "stage": ["id": "gate_a", "index": 2, "total": 8, "since": now - 100],
            "stages": stages([("context", now - 1000, now - 820), ("definition", now - 820, now - 100), ("gate_a", now - 100, nil)]),
            "gates": ["gate_a": ["requested_at": now - 100, "resolved_at": NSNull(), "outcome": NSNull(), "by": NSNull()]],
        ])

        let rows = stageRows(run, now: now)

        XCTAssertEqual(rows.map(\.id), Stage.all.map(\.id))
        XCTAssertEqual(rows.map(\.state), [.done, .done, .current, .pending, .pending, .pending, .pending, .pending])
        XCTAssertEqual(rows.map(\.durationText), ["3m", "12m", "1m", "", "", "", "", ""])
        XCTAssertEqual(rows[2].note, "te espera")
        XCTAssertEqual(rows[2].label, "Aprobar spec")
        XCTAssertTrue(rows[2].isGate)
        XCTAssertNil(rows[0].note)
        XCTAssertNil(rows[6].note)
    }

    func testGateOutcomesAndReenteredStages() throws {
        let run = try makeRun("r", [
            "lang": "en",
            "stage": ["id": "pr", "index": 7, "total": 8, "since": now - 10],
            "stages": stages([("plan", now - 900, now - 800), ("implement", now - 800, now - 500),
                              ("plan", now - 500, now - 440), ("implement", now - 440, now - 20), ("pr", now - 10, nil)]),
            "gates": [
                "gate_a": ["requested_at": 0, "resolved_at": 1, "outcome": "approved", "by": "user"],
                "gate_b": ["requested_at": 0, "resolved_at": 1, "outcome": "approved", "by": "auto"],
            ],
        ])

        let rows = stageRows(run, now: now)

        XCTAssertEqual(rows[3].elapsed, 160, "both visits to Plan")
        XCTAssertEqual(rows[4].elapsed, 720)
        XCTAssertEqual(rows[2].note, "approved by you")
        XCTAssertEqual(rows[6].note, "passed on its own")
        XCTAssertNil(rows[0].elapsed, "done but never entered")
        XCTAssertEqual(rows[7].state, .current)
        XCTAssertEqual(rows[7].elapsed, 10)
    }

    func testGateNotes() throws {
        func note(_ outcome: Any, by: Any = "user", lang: String = "es") throws -> String? {
            let run = try makeRun("r", ["lang": lang, "gates": ["gate_a": ["requested_at": 0, "outcome": outcome, "by": by]]])
            return stageRows(run, now: now)[2].note
        }
        XCTAssertEqual(try note("approved"), "aprobado por vos")
        XCTAssertEqual(try note("approved", by: "claude"), "pasó solo")
        XCTAssertEqual(try note("changes"), "cambios pedidos")
        XCTAssertEqual(try note("changes", lang: "en"), "changes requested")
        XCTAssertEqual(try note(NSNull(), by: NSNull()), "te espera")
    }

    func testFinishedRunsCloseTheirLastStage() throws {
        let entries = stages([("context", now - 300, now - 200), ("definition", now - 200, now - 50)])
        let stage: [String: Any] = ["id": "definition", "index": 1, "total": 8, "since": now - 200]
        let done = try makeRun("r", status: "done", ["stage": stage, "stages": entries, "outcome": "done", "finished_at": now - 50])
        XCTAssertEqual(stageRows(done, now: now).prefix(3).map(\.state), [.done, .done, .pending])

        let failed = try makeRun("r", status: "failed", ["stage": stage, "stages": entries, "outcome": "failed", "finished_at": now - 50])
        let rows = stageRows(failed, now: now)
        XCTAssertEqual(rows.prefix(3).map(\.state), [.done, .current, .pending])
        XCTAssertEqual(rows[1].elapsed, 150)

        let fresh = try makeRun("r")
        XCTAssertEqual(Set(stageRows(fresh, now: now).map(\.state)), [.pending])
    }

    func testScenario10OnlyTheDocumentsThatExist() throws {
        let fixture = try StoreFixture()
        let runDir = fixture.runsURL.appendingPathComponent("r")
        try FileManager.default.createDirectory(at: runDir.appendingPathComponent("log.md"), withIntermediateDirectories: true)
        for name in ["plan.md", "spec.md", "notes.md"] {
            try Data("# \(name)\n".utf8).write(to: runDir.appendingPathComponent(name))
        }

        let documents = runDocuments(runDir: runDir)

        XCTAssertEqual(documents.map(\.name), ["spec.md", "plan.md"])
        XCTAssertEqual(documents.map(\.url.lastPathComponent), ["spec.md", "plan.md"])

        for name in runDocumentNames {
            try? FileManager.default.removeItem(at: runDir.appendingPathComponent(name))
            try Data().write(to: runDir.appendingPathComponent(name))
        }
        XCTAssertEqual(runDocuments(runDir: runDir).map(\.name),
                       ["source.md", "context.md", "spec.md", "plan.md", "log.md", "summary.md"])
    }

    func testCostPerStageWithTotals() throws {
        let run = try makeRun("r", [
            "time": [
                "implement": ["work": 1920.0, "agents": 2400.0, "tests": 60, "roles": ["implementer": 2400.0]],
                "context": ["work": 136.0, "agents": 170.0],
                "gate_a": ["work": 110.0, "you": 935.0, "paused": 20],
                "later": ["work": 5],
            ],
            "usage": [
                "context": ["input": 40, "output": 4360, "cache_read": 302000, "cache_write": 12400, "usd": 0.3889],
                "implement": ["input": 68, "output": 22200, "cache_read": 1640000, "cache_write": 57000, "usd": 2.8667],
                "plan": ["usd": 0.5],
            ],
        ])

        let table = costTable(run)

        XCTAssertEqual(table.rows.map(\.id), ["context", "gate_a", "plan", "implement", "later"])
        XCTAssertEqual(table.rows.map(\.label), ["Contexto", "Aprobar spec", "Plan", "Implementación", "later"])
        let implement = table.rows[3]
        XCTAssertEqual(implement.work, 1920)
        XCTAssertEqual(implement.agents, 2400)
        XCTAssertEqual(implement.tests, 60)
        XCTAssertEqual(implement.usd, 2.8667, accuracy: 1e-9)
        XCTAssertEqual(implement.tokens, 1_719_268)
        XCTAssertEqual(table.rows[1].you, 935)
        XCTAssertEqual(table.rows[1].paused, 20)
        XCTAssertEqual(table.rows[2].work, 0)
        XCTAssertEqual(table.total.work, 1920 + 136 + 110 + 5)
        XCTAssertEqual(table.total.agents, 2570)
        XCTAssertEqual(table.total.you, 935)
        XCTAssertEqual(table.total.usd, 3.7556, accuracy: 1e-9)
        XCTAssertEqual(table.total.label, "Total")

        XCTAssertEqual(costTable(try makeRun("r")).rows, [])
    }

    func testScreenshotPaths() throws {
        let runDir = URL(fileURLWithPath: "/data/runs/r")
        func url(_ file: String) throws -> String? {
            let run = try makeRun("r", ["screenshots": [["file": file, "caption": "c"]]])
            return screenshotURL(run.screenshots[0], runDir: runDir)?.path
        }
        XCTAssertEqual(try url("01-tablero.png"), "/data/runs/r/screenshots/01-tablero.png")
        XCTAssertEqual(try url("screenshots/01-tablero.png"), "/data/runs/r/screenshots/01-tablero.png")
        XCTAssertEqual(try url("evidence/shots/a.png"), "/data/runs/r/evidence/shots/a.png")
        XCTAssertEqual(try url("/tmp/a.png"), "/tmp/a.png")
        XCTAssertNil(try url(""))
    }
}
