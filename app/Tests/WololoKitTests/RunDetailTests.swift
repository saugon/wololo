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
            "stage": ["id": "gate_a", "index": 3, "total": 9, "since": now - 100],
            "stages": stages([("context", now - 1000, now - 820), ("definition", now - 820, now - 100), ("gate_a", now - 100, nil)]),
            "gates": ["gate_a": ["requested_at": now - 100, "resolved_at": NSNull(), "outcome": NSNull(), "by": NSNull()]],
        ])

        let rows = stageRows(run, now: now)

        XCTAssertEqual(rows.map(\.id), Stage.all.map(\.id))
        XCTAssertEqual(rows.map(\.state), [.done, .done, .done, .current, .pending, .pending, .pending, .pending, .pending])
        XCTAssertEqual(rows.map(\.durationText), ["3m", "12m", "", "1m", "", "", "", "", ""])
        XCTAssertEqual(rows[3].note, "te espera")
        XCTAssertEqual(rows[3].label, "Aprobar spec")
        XCTAssertTrue(rows[3].isGate)
        XCTAssertNil(rows[0].note)
        XCTAssertNil(rows[7].note)
        XCTAssertNil(rows[2].elapsed, "the mockup stage, never entered")
    }

    func testGateOutcomesAndReenteredStages() throws {
        let run = try makeRun("r", [
            "lang": "en",
            "stage": ["id": "pr", "index": 8, "total": 9, "since": now - 10],
            "stages": stages([("plan", now - 900, now - 800), ("implement", now - 800, now - 500),
                              ("plan", now - 500, now - 440), ("implement", now - 440, now - 20), ("pr", now - 10, nil)]),
            "gates": [
                "gate_a": ["requested_at": 0, "resolved_at": 1, "outcome": "approved", "by": "user"],
                "gate_b": ["requested_at": 0, "resolved_at": 1, "outcome": "approved", "by": "auto"],
            ],
        ])

        let rows = stageRows(run, now: now)

        XCTAssertEqual(rows[4].elapsed, 160, "both visits to Plan")
        XCTAssertEqual(rows[5].elapsed, 720)
        XCTAssertEqual(rows[3].note, "approved by you")
        XCTAssertEqual(rows[7].note, "passed on its own")
        XCTAssertNil(rows[0].elapsed, "done but never entered")
        XCTAssertEqual(rows[8].state, .current)
        XCTAssertEqual(rows[8].elapsed, 10)
    }

    func testGateNotes() throws {
        func note(_ outcome: Any, by: Any = "user", lang: String = "es") throws -> String? {
            let run = try makeRun("r", ["lang": lang, "gates": ["gate_a": ["requested_at": 0, "outcome": outcome, "by": by]]])
            return stageRows(run, now: now)[3].note
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

    func testRunDirectoryIsUnderRuns() {
        let directory = DataDirectory(url: URL(fileURLWithPath: "/data/wololo"))
        XCTAssertEqual(directory.runURL(id: "web-4312-a4f9c2").path, "/data/wololo/runs/web-4312-a4f9c2")
    }

    func testItemMarks() throws {
        let items: [String: Any] = [
            "done": 1, "total": 5,
            "current": ["n": 4, "title": "d"],
            "list": [
                ["n": 1, "title": "a", "state": "done", "sha": "8ada11ce9ec9"],
                ["n": 2, "title": "b", "state": "active"],
                ["n": 3, "title": "c", "state": "failing"],
                ["n": 4, "title": "d", "state": "pending"],
                ["n": 5, "title": "e", "state": "something_new"],
            ],
        ]
        let running = try makeRun("r", ["items": items])
        XCTAssertEqual(running.items.list.map { itemMark($0, in: running, now: now) },
                       [.done, .active, .failing, .active, .pending], "the current item is active even before its event")

        let cancelled = try makeRun("r", status: "cancelled", ["items": items])
        XCTAssertEqual(cancelled.items.list.map { itemMark($0, in: cancelled, now: now) },
                       [.done, .pending, .pending, .pending, .pending])
    }

    func testPRLine() throws {
        func line(_ pr: [String: Any], lang: String = "es") throws -> PRLine? {
            prLine(try makeRun("r", ["lang": lang, "pr": pr]))
        }
        let draft = try line(["url": "https://github.com/acme/web/pull/88", "number": 88, "state": "draft", "ci": "pending"])
        XCTAssertEqual(draft?.text, "PR #88 · draft")
        XCTAssertEqual(draft?.url?.absoluteString, "https://github.com/acme/web/pull/88")
        XCTAssertEqual(draft?.ci, "CI pendiente")
        XCTAssertEqual(draft?.ciRole, .pending)

        let ready = try line(["url": "https://github.com/acme/web/pull/91", "state": "ready", "ci": "failing"], lang: "en")
        XCTAssertEqual(ready?.text, "PR #91 · ready for review", "the number comes from the URL when missing")
        XCTAssertEqual(ready?.ci, "CI failing")

        let bare = try line(["url": "", "state": "open"])
        XCTAssertEqual(bare?.text, "PR · listo para revisar")
        XCTAssertNil(bare?.url)
        XCTAssertNil(bare?.ci)

        let merged = try line(["url": "", "number": 7, "state": "merged"])
        XCTAssertEqual(merged?.text, "PR #7 · mergeado")
        let closed = try line(["url": "", "number": 7, "state": "closed"], lang: "en")
        XCTAssertEqual(closed?.text, "PR #7 · closed")

        XCTAssertNil(prLine(try makeRun("r")))
    }
}
