import XCTest
@testable import WololoKit

final class EventLabelsTests: XCTestCase {
    private func event(_ type: String, _ data: [String: JSONValue] = [:]) -> RunEvent {
        RunEvent(seq: 1, ts: 0, type: type, data: data)
    }

    private func lines(_ type: String, _ data: [String: JSONValue] = [:]) -> [String] {
        [eventLine(event(type, data), lang: .es), eventLine(event(type, data), lang: .en)]
    }

    func testReviewEvents() {
        XCTAssertEqual(lines("review.waiting", [:]), ["PR listo, en revisión", "PR ready, in review"])
        XCTAssertEqual(lines("pr.merged", [:]), ["PR mergeado", "PR merged"])
        XCTAssertEqual(lines("pr.closed", [:]), ["PR cerrado sin mergear", "PR closed without merging"])
        XCTAssertFalse(isMinorEvent("review.waiting"))
    }

    func testMockupNamesItsPageOrItsFiles() throws {
        XCTAssertEqual(lines("mockup.published", ["url": .string("https://claude.ai/artifact/a"), "files": .array([.string("01-cart.html")])]),
                       ["Mockup: https://claude.ai/artifact/a", "Mockup: https://claude.ai/artifact/a"])
        XCTAssertEqual(lines("mockup.published", ["url": .null, "files": .array([.string("01-cart.html"), .string("02-pay.html")])])[0],
                       "Mockup: 01-cart.html, 02-pay.html")
        let run = try makeRun("m", ["mockup": ["url": "https://claude.ai/artifact/a", "files": ["01-cart.html"]]])
        XCTAssertEqual(run.mockup?.link?.absoluteString, "https://claude.ai/artifact/a")
        XCTAssertNil(try makeRun("l", ["mockup": ["url": NSNull(), "files": ["01-cart.html"]]]).mockup?.link)
    }

    func testMainEventsInBothLanguages() {
        XCTAssertEqual(lines("run.started", ["mode": .string("checkpoints")]),
                       ["Arrancó el run · modo checkpoints", "Run started · checkpoints mode"])
        XCTAssertEqual(lines("stage.entered", ["stage": .string("plan")]), ["Entró a Plan", "Entered Plan"])
        XCTAssertEqual(lines("stage.entered", ["stage": .string("implement"), "reason": .string("el plan no alcanza")]),
                       ["Entró a Implementación (vuelve: el plan no alcanza)", "Entered Implementation (back: el plan no alcanza)"])
        XCTAssertEqual(lines("gate.resolved", ["gate": .string("gate_a"), "outcome": .string("approved"), "by": .string("user")]),
                       ["Aprobaste el spec", "You approved the spec"])
        XCTAssertEqual(lines("gate.resolved", ["gate": .string("gate_b"), "by": .string("auto")]),
                       ["El PR pasó solo", "The PR passed on its own"])
        XCTAssertEqual(lines("gate.resolved", ["gate": .string("gate_a"), "outcome": .string("changes")]),
                       ["Pediste cambios en el spec", "You asked for changes to the spec"])
        XCTAssertEqual(lines("item.committed", ["n": .number(2), "sha": .string("abc1234def5678")]),
                       ["Ítem 2 commiteado · abc1234", "Item 2 committed · abc1234"])
        XCTAssertEqual(lines("question.asked", ["question": .string("¿Aprobás el spec?")]),
                       ["¿Aprobás el spec?", "¿Aprobás el spec?"])
        XCTAssertEqual(lines("blocked", ["reason": .string("un test parece estar mal")]),
                       ["Bloqueado: un test parece estar mal", "Blocked: un test parece estar mal"])
        XCTAssertEqual(lines("run.finished", ["outcome": .string("done"), "summary": .string("PR #43 abierto")]),
                       ["Run terminado: listo. PR #43 abierto", "Run finished: done. PR #43 abierto"])
        XCTAssertEqual(lines("decision", ["text": .string("usar SQLite"), "by": .string("user")]),
                       ["Decisión (vos): usar SQLite", "Decision (you): usar SQLite"])
        XCTAssertEqual(lines("assumption", ["text": .string("el CSV es UTF-8")]),
                       ["Supuesto: el CSV es UTF-8", "Assumption: el CSV es UTF-8"])
        XCTAssertEqual(lines("corrected", ["text": .string("era otro endpoint")]),
                       ["Corregido: era otro endpoint", "Corrected: era otro endpoint"])
        XCTAssertEqual(lines("plan.ready", ["items": .array([.string("a"), .string("b"), .string("c")])]),
                       ["Plan listo: 3 ítems", "Plan ready: 3 items"])
        XCTAssertEqual(lines("pr.opened", ["number": .number(43), "url": .string("https://x/43")]),
                       ["PR #43 abierto (draft)", "PR #43 opened (draft)"])
        XCTAssertEqual(lines("ci.updated", ["state": .string("failing")]), ["CI en rojo", "CI failing"])
        XCTAssertEqual(lines("agent.started", ["role": .string("implementer"), "description": .string("Ítem 5")]),
                       ["Arrancó implementador: Ítem 5", "Started implementer: Ítem 5"])
        XCTAssertEqual(lines("usage", ["stage": .string("implement"), "input": .number(6), "output": .number(812),
                                       "cache_read": .number(41000), "cache_write": .number(900), "usd": .number(0.031)]),
                       ["Uso en Implementación: 42.7k tokens · $0.03", "Usage in Implementation: 42.7k tokens · $0.03"])
        XCTAssertEqual(lines("time", ["stage": .string("plan"), "kind": .string("work"), "seconds": .number(125)]),
                       ["Tiempo de trabajo en Plan: 2m", "Time working in Plan: 2m"])
    }

    func testAnswersListEveryPair() {
        let pairs: JSONValue = .array([
            .object(["header": .string("Alcance"), "question": .string("¿Incluye el CSV?"), "answer": .string("Sí")]),
            .object(["question": .string("¿Y el PDF?")]),
        ])
        XCTAssertEqual(eventLine(event("question.answered", ["pairs": pairs]), lang: .es),
                       "Alcance: ¿Incluye el CSV? → Sí · ¿Y el PDF? → (sin respuesta)")
        XCTAssertEqual(eventLine(event("question.answered", ["answered": .bool(false)]), lang: .en), "You dismissed the question")
    }

    func testUnknownTypesAndMissingDataNeverCrash() {
        XCTAssertEqual(lines("something.new"), ["Evento something.new", "Event something.new"])
        XCTAssertEqual(lines("something.new", ["message": .string("hola")]), ["Evento something.new: hola", "Event something.new: hola"])
        let types = ["run.started", "owner.changed", "risk.set", "stage.entered", "stage.completed", "gate.requested",
                     "gate.resolved", "question.asked", "question.answered", "permission.asked", "permission.resolved",
                     "agent.started", "agent.finished", "task.started", "task.finished", "plan.ready", "item.started",
                     "item.verified", "item.reviewed", "item.committed", "debate.turn", "assumption", "decision",
                     "corrected", "doing", "blocked", "unblocked", "stalled", "pause.requested", "paused", "resumed",
                     "ci.updated", "pr.opened", "pr.ready", "signing.deferred", "signing.done", "github.published",
                     "adapter.ran", "adapter.started", "screenshot.saved", "usage", "time", "run.finished"]
        for type in types {
            for lang in Lang.allCases {
                _ = eventLine(event(type), lang: lang)
                _ = eventLine(event(type, ["stage": .object([:]), "n": .array([]), "pairs": .string("x")]), lang: lang)
            }
        }
        XCTAssertEqual(eventLine(event("stage.entered", ["stage": .string("later")]), lang: .es), "Entró a later")
    }

    func testMinorEvents() {
        for type in ["usage", "time", "doing", "agent.started", "agent.finished", "task.started", "task.finished",
                     "permission.asked", "permission.resolved"] {
            XCTAssertTrue(isMinorEvent(type), type)
        }
        for type in ["stage.entered", "gate.resolved", "question.asked", "item.committed", "blocked", "run.finished",
                     "decision", "something.new"] {
            XCTAssertFalse(isMinorEvent(type), type)
        }
    }

    func testTimelineHidesMinorEventsUnlessAsked() {
        let events = [
            RunEvent(seq: 1, ts: 10, type: "stage.entered", data: ["stage": .string("plan")]),
            RunEvent(seq: 2, ts: 11, type: "usage", data: ["usd": .number(1)]),
            RunEvent(seq: 3, ts: 12, type: "blocked", data: ["reason": .string("falta la clave")]),
        ]
        XCTAssertEqual(timeline(events, lang: .es, includeMinor: false).map(\.text), ["Entró a Plan", "Bloqueado: falta la clave"])
        let all = timeline(events, lang: .es, includeMinor: true)
        XCTAssertEqual(all.map(\.seq), [1, 2, 3])
        XCTAssertEqual(all.map(\.isMinor), [false, true, false])
        XCTAssertEqual(all[2].ts, 12)
    }

    func testAmounts() {
        XCTAssertEqual(usdText(2.8667), "$2.87")
        XCTAssertEqual(usdText(0), "$0.00")
        XCTAssertEqual(usdText(0.001), "<$0.01")
        XCTAssertEqual(tokensText(812), "812")
        XCTAssertEqual(tokensText(42_000), "42k")
        XCTAssertEqual(tokensText(1_719_200), "1.7M")
    }
}
