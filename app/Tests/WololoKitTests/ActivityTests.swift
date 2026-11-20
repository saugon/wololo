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
        let expected = ["¿Aprobás el spec?", "Bloqueado: un test parece estar mal", "Escribiendo el CSV", "En pausa: falta la credencial", "Ítem 5: Animación al soltar"]
        for (key, line) in zip(["waiting", "blocked", "doing", "paused", "items"], expected) {
            XCTAssertEqual(activityLine(try makeRun("r", fields), now: now), line)
            fields.removeValue(forKey: key)
        }
        XCTAssertEqual(activityLine(try makeRun("r", fields), now: now), "")
    }

    func testAPermissionRequestSaysSo() throws {
        let fields: [String: Any] = ["waiting": ["on": "permission", "question": "Bash · npm run db:migrate", "since": 0]]
        XCTAssertEqual(activityLine(try makeRun("r", status: "waiting_permission", fields), now: now), "Pide permiso: Bash · npm run db:migrate")
        var english = fields
        english["lang"] = "en"
        XCTAssertEqual(activityLine(try makeRun("r", status: "waiting_permission", english), now: now), "Needs permission: Bash · npm run db:migrate")
    }

    func testBlockAndPauseSayWhatTheyAre() throws {
        let blocked: [String: Any] = ["blocked": ["reason": "un test parece estar mal", "since": 0]]
        XCTAssertEqual(activityLine(try makeRun("r", status: "blocked", blocked), now: now), "Bloqueado: un test parece estar mal")
        XCTAssertEqual(activityLine(try makeRun("r", status: "blocked", blocked.merging(["lang": "en"]) { $1 }), now: now),
                       "Blocked: un test parece estar mal")

        let paused: [String: Any] = ["paused": ["note": "falta la credencial", "since": 0]]
        XCTAssertEqual(activityLine(try makeRun("r", status: "paused", paused), now: now), "En pausa: falta la credencial")
        XCTAssertEqual(activityLine(try makeRun("r", status: "paused", paused.merging(["lang": "en"]) { $1 }), now: now),
                       "Paused: falta la credencial")
    }

    /// The card shows the status on its own line, so its activity drops the prefix; the widget keeps it.
    func testUnprefixedActivityDropsTheStatusWord() throws {
        let cases: [(String, [String: Any], String)] = [
            ("waiting_permission", ["waiting": ["on": "permission", "question": "Bash · npm run db:migrate", "since": 0]], "Bash · npm run db:migrate"),
            ("blocked", ["blocked": ["reason": "un test parece estar mal", "since": 0]], "un test parece estar mal"),
            ("paused", ["paused": ["note": "falta la credencial", "since": 0]], "falta la credencial"),
            ("blocked", ["lang": "en", "blocked": ["reason": "a test looks wrong", "since": 0]], "a test looks wrong"),
            ("running", ["items": ["done": 4, "total": 7, "current": ["n": 5, "title": "Animación al soltar"]]], "Ítem 5: Animación al soltar"),
        ]
        for (status, fields, line) in cases {
            let run = try makeRun("r", status: status, fields)
            XCTAssertEqual(activityLine(run, now: now, prefixed: false), line)
            XCTAssertEqual(activityLine(run, now: now), activityLine(run, now: now, prefixed: true))
        }
        XCTAssertEqual(activityLine(try makeRun("r", status: "blocked", cases[1].1), now: now), "Bloqueado: un test parece estar mal")
        let orphan = try makeRun("r", ["owner": ["heartbeat_at": now - 600]])
        XCTAssertEqual(activityLine(orphan, now: now, prefixed: false), "sin señal hace 10m")
    }

    func testAPermissionRequestWithoutQuestionFallsThrough() throws {
        let run = try makeRun("r", status: "waiting_permission", [
            "waiting": ["on": "permission", "question": "", "since": 0],
            "doing": ["text": "Migrando la base", "since": 0],
        ])
        XCTAssertEqual(activityLine(run, now: now), "Migrando la base")
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

    func testOrphanedSilenceUsesTheCompactUnitOfAgo() throws {
        let fields: [String: Any] = ["owner": ["heartbeat_at": now - 3900], "doing": ["text": "x", "since": 0]]
        XCTAssertEqual(activityLine(try makeRun("r", fields), now: now), "sin señal hace 1h")
        var english = fields
        english["lang"] = "en"
        XCTAssertEqual(activityLine(try makeRun("r", english), now: now), "no signal for 1h")
        var days = fields
        days["owner"] = ["heartbeat_at": now - 259_200]
        XCTAssertEqual(activityLine(try makeRun("r", days), now: now), "sin señal hace 3 d")
    }

    func testAgo() {
        XCTAssertEqual(ago(now - 45, now: now, lang: .es), "hace 45s")
        XCTAssertEqual(ago(now - 3900, now: now, lang: .en), "1h ago")
        XCTAssertEqual(ago(now - 720, now: now, lang: .es), "hace 12m")
        XCTAssertEqual(ago(now - 7200, now: now, lang: .es), "hace 2h")
        XCTAssertEqual(ago(now - 259_200, now: now, lang: .es), "hace 3 d")
        XCTAssertEqual(ago(now - 259_200, now: now, lang: .en), "3d ago")
        XCTAssertEqual(ago(now + 30, now: now, lang: .es), "hace 0s")
    }

    func testShortAgoDropsTheWord() {
        XCTAssertEqual(shortAgo(now - 45, now: now, lang: .es), "45s")
        XCTAssertEqual(shortAgo(now - 720, now: now, lang: .en), "12m")
        XCTAssertEqual(shortAgo(now - 259_200, now: now, lang: .es), "3 d")
        XCTAssertEqual(shortAgo(now - 259_200, now: now, lang: .en), "3d")
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

    func testAgentsLabel() throws {
        XCTAssertEqual(agentsLabel(1, lang: .es), "1 agente")
        XCTAssertEqual(agentsLabel(2, lang: .es), "2 agentes")
        XCTAssertEqual(agentsLabel(1, lang: .en), "1 agent")
        XCTAssertEqual(agentsLabel(3, lang: .en), "3 agents")
        XCTAssertNil(agentsLabel(0, lang: .es))

        let agents = [agent("implementer"), agent("verifier"), agent("critic", finishedAt: 10)]
        XCTAssertEqual(agentsLabel(try makeRun("r", ["agents": agents]), now: now), "2 agentes")
        XCTAssertNil(agentsLabel(try makeRun("r"), now: now))
        XCTAssertNil(agentsLabel(try makeRun("r", status: "done", ["agents": agents]), now: now))
        XCTAssertNil(agentsLabel(try makeRun("r", ["agents": agents, "owner": ["heartbeat_at": now - 600]]), now: now))
    }

    func testPRLabel() throws {
        XCTAssertEqual(prLabel(try makeRun("r", ["pr": ["url": "https://github.com/acme/web/pull/120", "number": 120, "state": "draft"]])), "PR #120")
        XCTAssertEqual(prLabel(try makeRun("r", ["pr": ["url": "https://github.com/acme/web/pull/43", "state": "ready"]])), "PR #43")
        XCTAssertEqual(prLabel(try makeRun("r", ["pr": ["url": "", "state": "ready"]])), "PR")
        XCTAssertNil(prLabel(try makeRun("r")))
    }

    /// Scenario 4: the texts of a card in implementation with 4/7 items, 2 agents, PR #120 and 53 s old.
    func testCardTextsInTheReferenceLayout() throws {
        let run = try makeRun("web-87", status: "waiting_agents", updatedAt: now - 53, [
            "title": "Arrastrar y soltar tarjetas",
            "source": ["kind": "github_issue", "ref": "87"],
            "project": ["key": "acme__web", "path": "/code/acme/web"],
            "stage": ["id": "implement", "index": 4, "since": 0],
            "items": ["done": 4, "total": 7, "current": ["n": 5, "title": "Animación al soltar"]],
            "agents": [agent("implementer"), agent("verifier")],
            "doing": ["text": "Implementando ítem 5", "since": 0],
            "pr": ["url": "https://github.com/acme/web/pull/120", "number": 120, "state": "draft", "ci": "pending"],
        ])
        let status = effectiveStatus(run, now: now)
        XCTAssertEqual(originLabel(run), "acme/web #87")
        XCTAssertEqual(status.label(run.lang), "Agentes trabajando")
        XCTAssertEqual(activityLine(run, now: now, prefixed: false), "Implementando ítem 5")
        XCTAssertEqual(RunProgress(run, now: now).metaText, "6/9 Implementación")
        XCTAssertEqual(prLabel(run), "PR #120")
        XCTAssertEqual(agentsLabel(run, now: now), "2 agentes")
        XCTAssertEqual(shortAgo(run.updatedAt, now: now, lang: run.lang), "53s")
    }

    func testOriginLabel() throws {
        XCTAssertEqual(originLabel(try makeRun("r", ["project": ["key": "saugon__wololo", "path": "/p"],
                                                      "source": ["kind": "file", "ref": "docs/plan.md"]])), "saugon/wololo")
        XCTAssertEqual(originLabel(try makeRun("r", ["project": ["key": "saugon__wololo", "path": "/p"],
                                                      "source": ["kind": "text", "ref": "app"]])), "saugon/wololo")
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

        let merged = try makeRun("r", ["pr": ["url": "", "number": 5, "state": "merged", "ci": "passing"]])
        XCTAssertEqual(prChip(merged), MetaChip(text: "#5", title: "PR #5 mergeado, CI en verde"))
        let closed = try makeRun("r", ["pr": ["url": "", "number": 5, "state": "closed"]])
        XCTAssertEqual(prChip(closed)?.title, "PR #5 cerrado")
    }

    func testSourceLabel() throws {
        XCTAssertEqual(sourceLabel(try makeRun("r", ["source": ["kind": "github_issue", "ref": "#4312"]])), "#4312")
        XCTAssertEqual(sourceLabel(try makeRun("r", ["source": ["kind": "github_issue", "ref": "87"]])), "#87")
        XCTAssertEqual(sourceLabel(try makeRun("r", ["source": ["kind": "file", "ref": "docs/plan-reporte.md"]])), "plan-reporte.md")
        XCTAssertEqual(sourceLabel(try makeRun("r", ["source": ["kind": "text", "ref": "Wololo: una app"]])), "texto")
        XCTAssertEqual(sourceLabel(try makeRun("r", ["lang": "en", "source": ["kind": "text", "ref": ""]])), "text")
    }
}
