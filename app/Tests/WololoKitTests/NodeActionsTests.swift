import XCTest
@testable import WololoKit

/// Spec 17, 20 and 21: the drawer's action button, the note under "Estado" and the node's right-click menu.
final class NodeActionsTests: XCTestCase {
    private let home = "/Users/x"
    private let shop = "acme/shop"

    // Scenario 8: a ready step starts its issue's run in the project's folder, and says exactly what it will run.
    func testReadyStepStartsTheRunAndShowsTheLineAndFolder() {
        let status = NodeStatus(state: .ready, issue: IssueRef(repo: shop, number: 131))
        let action = NodeActionPresentation.make(status: status, command: "/wololo #131",
                                                 folder: .folder("/Users/x/code/shop"), home: home)
        XCTAssertEqual(action?.kind, .start(command: "/wololo #131", folder: "/Users/x/code/shop"))
        XCTAssertEqual(action?.label, "▶ Arrancar run")
        XCTAssertEqual(action?.isEnabled, true)
        XCTAssertEqual(action?.isPrimary, true)
        XCTAssertEqual(action?.subline, "claude '/wololo #131' en ~/code/shop")
        XCTAssertEqual(action?.sublineIsCommand, true)
    }

    // Scenario 11
    func testStartWithoutAFolderIsDisabledWithTheReason() {
        let status = NodeStatus(state: .ready, issue: IssueRef(repo: "otra/lib", number: 12))
        let action = NodeActionPresentation.make(status: status, command: "/wololo https://github.com/otra/lib/issues/12",
                                                 folder: .disabled(reason: "Agregá un proyecto para otra/lib"), home: home)
        XCTAssertEqual(action?.kind, NodeActionPresentation.Kind.none)
        XCTAssertEqual(action?.label, "▶ Arrancar run")
        XCTAssertEqual(action?.isEnabled, false)
        XCTAssertEqual(action?.subline, "Agregá un proyecto para otra/lib")
        XCTAssertEqual(action?.sublineIsCommand, false)
    }

    // Scenario 12
    func testBlockedStepIsDisabledSayingHowManyNodesItWaitsOn() {
        let two = NodeActionPresentation.make(status: NodeStatus(state: .blocked(by: 2)), command: "/wololo #142",
                                              folder: .folder("/Users/x/code/shop"), home: home)
        XCTAssertEqual(two?.label, "Bloqueado por 2 nodos")
        XCTAssertEqual(two?.isEnabled, false)
        XCTAssertEqual(two?.kind, NodeActionPresentation.Kind.none)
        let one = NodeActionPresentation.make(status: NodeStatus(state: .blocked(by: 1)), command: "x",
                                              folder: .folder("/a"), home: home)
        XCTAssertEqual(one?.label, "Bloqueado por 1 nodo")
    }

    func testStepInProgressViewsItsRun() {
        let status = NodeStatus(state: .doing(stage: "implement"), runID: "r1", runIsLive: true)
        let action = NodeActionPresentation.make(status: status, command: "x", folder: .folder("/a"), home: home)
        XCTAssertEqual(action?.kind, .viewRun(id: "r1"))
        XCTAssertEqual(action?.label, "Ver run")
        XCTAssertEqual(action?.subline, "En curso · implement")
    }

    func testStepInReviewOpensItsPR() {
        let status = NodeStatus(state: .review(prNumber: 140, ci: "passing"), runID: "r1",
                                prURL: "https://github.com/acme/shop/pull/140", prNumber: 140, ci: "passing")
        let action = NodeActionPresentation.make(status: status, command: "x", folder: .folder("/a"), home: home)
        XCTAssertEqual(action?.kind, .openPR(url: "https://github.com/acme/shop/pull/140"))
        XCTAssertEqual(action?.label, "Abrir PR #140")
        XCTAssertEqual(action?.subline, "En review · CI en verde")
    }

    // A run already going on the issue is looked at instead of starting a second one.
    func testPendingOrReadyStepWithALiveRunViewsIt() {
        for state in [NodeState.pending, .ready] {
            let status = NodeStatus(state: state, runID: "r1", runIsLive: true)
            let action = NodeActionPresentation.make(status: status, command: "/wololo #131", folder: .folder("/a"),
                                                     home: home)
            XCTAssertEqual(action?.kind, .viewRun(id: "r1"))
            XCTAssertEqual(action?.label, "Ver run")
            XCTAssertEqual(action?.isEnabled, true)
            XCTAssertEqual(action?.isPrimary, false)
            XCTAssertEqual(action?.subline, "Hay un run trabajando en este issue")
        }
    }

    func testStepInReviewWithoutAPRLinkViewsItsRun() {
        let status = NodeStatus(state: .review(prNumber: nil, ci: nil), runID: "r1", runIsLive: true)
        let action = NodeActionPresentation.make(status: status, command: "x", folder: .folder("/a"), home: home)
        XCTAssertEqual(action?.kind, .viewRun(id: "r1"))
        XCTAssertEqual(action?.label, "Ver run")
        XCTAssertEqual(action?.isEnabled, true)
    }

    func testDoneWithAPROpensIt() {
        let status = NodeStatus(state: .done(prNumber: 140), runID: "r1",
                                prURL: "https://github.com/acme/shop/pull/140", prNumber: 140)
        let action = NodeActionPresentation.make(status: status, command: "x", folder: .folder("/a"), home: home)
        XCTAssertEqual(action?.kind, .openPR(url: "https://github.com/acme/shop/pull/140"))
        XCTAssertEqual(action?.label, "Abrir PR #140")
        XCTAssertEqual(action?.isEnabled, true)
        XCTAssertEqual(action?.isTextOnly, false)
        XCTAssertEqual(action?.subline, "Hecho")
    }

    func testReviewSublineSaysHowCIIsGoing() {
        func subline(ci: String?) -> String? {
            let status = NodeStatus(state: .review(prNumber: 140, ci: ci), runID: "r1",
                                    prURL: "https://github.com/acme/shop/pull/140", prNumber: 140, ci: ci)
            return NodeActionPresentation.make(status: status, command: "x", folder: .folder("/a"), home: home)?.subline
        }
        XCTAssertEqual(subline(ci: "failing"), "En review · CI en rojo")
        XCTAssertEqual(subline(ci: "pending"), "En review · CI corriendo")
        XCTAssertEqual(subline(ci: nil), "En review")
    }

    func testDoneWithoutAPRShowsTheWordHechoAndNoButton() {
        let action = NodeActionPresentation.make(status: NodeStatus(state: .done(prNumber: nil), isManual: true),
                                                 command: "x", folder: .folder("/a"), home: home)
        XCTAssertEqual(action?.label, "Hecho")
        XCTAssertEqual(action?.isTextOnly, true)
        XCTAssertEqual(action?.isEnabled, false)
    }

    func testFinalNodeAndManualProgressWithoutARunHaveNoAction() {
        XCTAssertNil(NodeActionPresentation.make(status: NodeStatus(state: .pending, isFinal: true), command: "x",
                                                 folder: .folder("/a"), home: home))
        XCTAssertNil(NodeActionPresentation.make(status: NodeStatus(state: .doing(stage: nil), isManual: true),
                                                 command: "x", folder: .folder("/a"), home: home))
    }

    func testAbbreviatingHome() {
        XCTAssertEqual(NodeActionPresentation.abbreviatingHome("/Users/x/code/shop", home: "/Users/x"), "~/code/shop")
        XCTAssertEqual(NodeActionPresentation.abbreviatingHome("/Users/x", home: "/Users/x/"), "~")
        XCTAssertEqual(NodeActionPresentation.abbreviatingHome("/Users/xy/shop", home: "/Users/x"), "/Users/xy/shop")
        XCTAssertEqual(NodeActionPresentation.abbreviatingHome("/tmp/shop", home: ""), "/tmp/shop")
    }

    // Spec 17: the note says whether the state comes from the run or from the person.
    func testStateNoteTellsManualFromDerived() {
        XCTAssertEqual(NodeStatus(state: .done(prNumber: nil), isManual: true, runID: "r1").stateNote,
                       "Manual: le gana al run hasta que vuelvas a Auto.")
        XCTAssertEqual(NodeStatus(state: .done(prNumber: nil), isManual: true).stateNote,
                       "Manual: no hay run que lo diga, lo marcaste vos.")
        XCTAssertEqual(NodeStatus(state: .doing(stage: "plan"), runID: "r1", runIsLive: true).stateNote,
                       "Automático: sale del run y su PR.")
        XCTAssertEqual(NodeStatus(state: .ready).stateNote, "Todo lo que lo precede está hecho: se puede arrancar.")
        XCTAssertEqual(NodeStatus(state: .blocked(by: 2)).stateNote,
                       "Bloqueado: espera a 2 nodos. Se desbloquea solo cuando estén hechos.")
        XCTAssertEqual(NodeStatus(state: .ready, warning: .lastRunFailed, runID: "r1").stateNote,
                       "Automático: el último run falló. Podés arrancar otro.")
        XCTAssertEqual(NodeStatus(state: .pending, isFinal: true).stateNote,
                       "Se completa solo cuando todo lo que llega a él está hecho.")
    }

    // A blocked step whose run is going talks about the run, not about waiting.
    func testStateNoteForABlockedStepWithALiveRunAndACancelledRun() {
        XCTAssertEqual(NodeStatus(state: .blocked(by: 1), baseState: .doing(stage: "plan"), runID: "r1",
                                  runIsLive: true).stateNote,
                       "Automático: sale del run y su PR.")
        XCTAssertEqual(NodeStatus(state: .blocked(by: 1)).stateNote,
                       "Bloqueado: espera a 1 nodo. Se desbloquea solo cuando esté hecho.")
        XCTAssertEqual(NodeStatus(state: .pending, warning: .lastRunCancelled, runID: "r1").stateNote,
                       "Automático: el último run se canceló. Podés arrancar otro.")
    }

    // Scenario 12: "Arrancar igual" on a blocked step, unless its run is already going.
    func testMenuOffersStartAnywayOnABlockedStep() {
        XCTAssertEqual(NodeMenuEntry.entries(for: NodeStatus(state: .blocked(by: 2)), isFinal: false),
                       [.startAnyway, .delete])
        XCTAssertEqual(NodeMenuEntry.entries(for: NodeStatus(state: .ready), isFinal: false), [.delete])
        XCTAssertEqual(NodeMenuEntry.entries(for: nil, isFinal: false), [.delete])
        XCTAssertEqual(NodeMenuEntry.entries(for: NodeStatus(state: .pending, isFinal: true), isFinal: true), [])
    }

    func testMenuOffersTheRunInsteadOfStartingABlockedStepWhoseRunIsLive() {
        let status = NodeStatus(state: .blocked(by: 1), runID: "r1", runIsLive: true)
        XCTAssertEqual(NodeMenuEntry.entries(for: status, isFinal: false), [.viewRun(id: "r1"), .delete])
        XCTAssertEqual(NodeMenuEntry.startAnyway.title, "Arrancar igual")
        XCTAssertEqual(NodeMenuEntry.viewRun(id: "r1").title, "Ver run")
        XCTAssertEqual(NodeMenuEntry.delete.title, "Borrar paso")
    }

    // Spec 16: `131`, `#131`, `owner/repo#n` or the URL; anything else is kept but flagged.
    func testIssueFieldValue() {
        XCTAssertEqual(issueFieldValue("  131 ", defaultRepo: shop).value, "131")
        XCTAssertTrue(issueFieldValue("#131", defaultRepo: shop).isValid)
        XCTAssertTrue(issueFieldValue("otra/lib#12", defaultRepo: shop).isValid)
        XCTAssertTrue(issueFieldValue("https://github.com/otra/lib/issues/12", defaultRepo: shop).isValid)
        XCTAssertTrue(issueFieldValue("131", defaultRepo: nil).isValid)
        let invalid = issueFieldValue("login", defaultRepo: shop)
        XCTAssertEqual(invalid.value, "login")
        XCTAssertFalse(invalid.isValid)
        let blank = issueFieldValue("   ", defaultRepo: shop)
        XCTAssertNil(blank.value)
        XCTAssertTrue(blank.isValid)
    }
}
