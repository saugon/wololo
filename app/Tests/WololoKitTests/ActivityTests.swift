import XCTest
@testable import WololoKit

final class ActivityTests: XCTestCase {
    private let now = fixtureNow

    func testActivityPriority() throws {
        var fields: [String: Any] = [
            "waiting": ["on": "user", "question": "¿Aprobás el spec?", "since": 0],
            "blocked": ["reason": "un test parece estar mal", "since": 0],
            "doing": ["text": "Escribiendo el CSV", "since": 0],
            "paused": ["note": "falta la credencial", "since": 0],
            "items": ["done": 4, "total": 7, "current": ["n": 5, "title": "Animación al soltar"]],
        ]
        let expected = ["¿Aprobás el spec?", "un test parece estar mal", "Escribiendo el CSV", "falta la credencial", "Ítem 5: Animación al soltar"]
        for (key, line) in zip(["waiting", "blocked", "doing", "paused", "items"], expected) {
            XCTAssertEqual(activityLine(try makeRun("r", fields), now: now), line)
            fields.removeValue(forKey: key)
        }
        XCTAssertEqual(activityLine(try makeRun("r", fields), now: now), "")
    }

    func testFinishedRunsShowTheirSummary() throws {
        let failed = try makeRun("r", status: "failed", [
            "blocked": ["reason": "un test parece estar mal", "since": 0],
            "items": ["done": 1, "total": 6, "current": ["n": 2, "title": "Migrar el lockfile"]],
            "summary": "Se agotó el presupuesto de reversiones del ítem 2",
        ])
        XCTAssertEqual(activityLine(failed, now: now), "Se agotó el presupuesto de reversiones del ítem 2")

        let done = try makeRun("r", status: "done", [
            "paused": ["note": "falta la credencial", "since": 0],
            "summary": "PR #43 abierto, CI en verde",
        ])
        XCTAssertEqual(activityLine(done, now: now), "PR #43 abierto, CI en verde")

        let cancelled = try makeRun("r", status: "cancelled", ["doing": ["text": "Escribiendo", "since": 0]])
        XCTAssertEqual(activityLine(cancelled, now: now), "")
    }

    func testEmptyTextFallsThrough() throws {
        let run = try makeRun("r", [
            "waiting": ["on": "user", "question": "", "since": 0],
            "doing": ["text": "Corriendo la suite", "since": 0],
        ])
        XCTAssertEqual(activityLine(run, now: now), "Corriendo la suite")
    }

    func testEnglishCurrentItem() throws {
        let run = try makeRun("r", ["lang": "en", "items": ["current": ["n": 2, "title": "Write the CSV"]]])
        XCTAssertEqual(activityLine(run, now: now), "Item 2: Write the CSV")
    }

    func testOrphanedSaysHowLongWithoutSignal() throws {
        let fields: [String: Any] = ["owner": ["heartbeat_at": now - 840], "doing": ["text": "x", "since": 0]]
        XCTAssertEqual(activityLine(try makeRun("r", fields), now: now), "sin señal hace 14m")
        var english = fields
        english["lang"] = "en"
        XCTAssertEqual(activityLine(try makeRun("r", english), now: now), "no signal for 14m")
    }

    func testAgo() {
        XCTAssertEqual(ago(now - 45, now: now, lang: .es), "hace 45s")
        XCTAssertEqual(ago(now - 3900, now: now, lang: .en), "1h05 ago")
    }

    func testItemsChip() throws {
        let chip = itemsChip(try makeRun("r", ["items": ["done": 4, "total": 7]]))
        XCTAssertEqual(chip, MetaChip(text: "4/7", title: "4 de 7 ítems hechos"))
        XCTAssertEqual(itemsChip(try makeRun("r", ["lang": "en", "items": ["done": 1, "total": 2]]))?.title, "1 of 2 items done")
        XCTAssertNil(itemsChip(try makeRun("r")))
    }

    private func agent(_ role: String, finishedAt: TimeInterval? = nil) -> [String: Any] {
        var object: [String: Any] = ["id": role, "role": role, "status": "running", "started_at": 0]
        if let finishedAt { object["finished_at"] = finishedAt }
        return object
    }

    func testAgentsChipCountsLiveAgents() throws {
        let run = try makeRun("r", ["agents": [agent("implementer"), agent("verifier"), agent("critic", finishedAt: 10)]])
        XCTAssertEqual(liveAgents(run).map(\.role), ["implementer", "verifier"])
        XCTAssertEqual(agentsChip(run, now: now), MetaChip(text: "2", title: "2 agentes: implementer, verifier"))

        let one = try makeRun("r", ["lang": "en", "agents": [agent("critic")]])
        XCTAssertEqual(agentsChip(one, now: now)?.title, "1 agent: critic")
        let repeated = try makeRun("r", ["agents": [agent("explorer"), agent("explorer"), agent("critic")]])
        XCTAssertEqual(agentsChip(repeated, now: now), MetaChip(text: "3", title: "3 agentes: explorer ×2, critic"))
        XCTAssertNil(agentsChip(try makeRun("r", ["agents": [agent("critic", finishedAt: 10)]]), now: now))
    }

    func testAgentsChipIsEmptyOnceTheRunEndedOrLostItsSession() throws {
        let agents = [agent("implementer"), agent("verifier")]
        for status in ["done", "failed", "cancelled"] {
            XCTAssertNil(agentsChip(try makeRun("r", status: status, ["agents": agents]), now: now), status)
        }
        let orphan = try makeRun("r", ["agents": agents, "owner": ["heartbeat_at": now - 600]])
        XCTAssertNil(agentsChip(orphan, now: now))
        XCTAssertNotNil(agentsChip(try makeRun("r", status: "paused", ["agents": agents]), now: now))
    }

    func testPRChip() throws {
        let draft = try makeRun("r", ["pr": ["url": "https://github.com/acme/web/pull/120", "number": 120, "state": "draft", "ci": "pending"]])
        XCTAssertEqual(prChip(draft), MetaChip(text: "#120", title: "PR #120 draft, CI pendiente"))
        XCTAssertEqual(ciRole(draft), .pending)

        let ready = try makeRun("r", ["lang": "en", "pr": ["url": "https://github.com/acme/web/pull/43", "state": "ready", "ci": "passing"]])
        XCTAssertEqual(prChip(ready), MetaChip(text: "#43", title: "PR #43 ready, CI passing"))
        XCTAssertEqual(ciRole(ready), .passing)

        let noCI = try makeRun("r", ["pr": ["url": "", "state": "ready"]])
        XCTAssertEqual(prChip(noCI), MetaChip(text: "PR", title: "PR listo"))
        XCTAssertNil(ciRole(noCI))
        XCTAssertNil(prChip(try makeRun("r")))
    }

    func testSourceLabel() throws {
        XCTAssertEqual(sourceLabel(try makeRun("r", ["source": ["kind": "github_issue", "ref": "#4312"]])), "#4312")
        XCTAssertEqual(sourceLabel(try makeRun("r", ["source": ["kind": "github_issue", "ref": "87"]])), "#87")
        XCTAssertEqual(sourceLabel(try makeRun("r", ["source": ["kind": "file", "ref": "docs/plan-reporte.md"]])), "plan-reporte.md")
        XCTAssertEqual(sourceLabel(try makeRun("r", ["source": ["kind": "text", "ref": "Wololo Desk: una app"]])), "texto")
        XCTAssertEqual(sourceLabel(try makeRun("r", ["lang": "en", "source": ["kind": "text", "ref": ""]])), "text")
    }
}
