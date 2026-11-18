import XCTest
@testable import WololoKit

final class NodeLabelsTests: XCTestCase {
    private let shop = "acme/shop"

    func testStateLabels() {
        XCTAssertEqual(NodeState.pending.label, "Pendiente")
        XCTAssertEqual(NodeState.ready.label, "Listo para arrancar")
        XCTAssertEqual(NodeState.doing(stage: "implement").label, "En curso")
        XCTAssertEqual(NodeState.review(prNumber: 1, ci: nil).label, "En review")
        XCTAssertEqual(NodeState.done(prNumber: nil).label, "Hecho")
        XCTAssertEqual(NodeState.blocked(by: 2).label, "Bloqueado")
    }

    /// Spec 19: `#n · PR #m · CI` or `sin issue`.
    func testMetaLineWithPRAndCI() {
        let status = NodeStatus(state: .review(prNumber: 140, ci: "passing"), issue: IssueRef(repo: shop, number: 128),
                                runID: "r", prNumber: 140, ci: "passing")
        XCTAssertEqual(status.metaLine(defaultRepo: shop), "#128 · PR #140 · CI ✓")
        var failing = status
        failing.ci = "failing"
        XCTAssertEqual(failing.metaLine(defaultRepo: shop), "#128 · PR #140 · CI ✗")
        failing.ci = nil
        XCTAssertEqual(failing.metaLine(defaultRepo: shop), "#128 · PR #140")
    }

    func testCardLabelAddsTheStageOfAStepInProgress() {
        XCTAssertEqual(NodeState.doing(stage: "implement").cardLabel, "En curso · implement")
        XCTAssertEqual(NodeState.doing(stage: nil).cardLabel, "En curso")
        XCTAssertEqual(NodeState.blocked(by: 2).cardLabel, "Bloqueado")
    }

    func testMetaLineWithoutIssue() {
        XCTAssertEqual(NodeStatus(state: .ready).metaLine(defaultRepo: shop), "sin issue")
        XCTAssertEqual(NodeStatus(state: .done(prNumber: nil), isManual: true).metaLine(defaultRepo: shop), "sin issue")
    }

    /// Only the issue, the PR and its CI: no count of blockers, no stage, no "sin run" nor "marcado a mano".
    func testMetaLineIsOnlyTheIssuePRAndCI() {
        let issue = IssueRef(repo: shop, number: 142)
        XCTAssertEqual(NodeStatus(state: .blocked(by: 2), issue: issue).metaLine(defaultRepo: shop), "#142")
        XCTAssertEqual(NodeStatus(state: .doing(stage: "implement"), issue: issue, runID: "r").metaLine(defaultRepo: shop),
                       "#142")
        XCTAssertEqual(NodeStatus(state: .ready, issue: issue).metaLine(defaultRepo: shop), "#142")
        XCTAssertEqual(NodeStatus(state: .done(prNumber: nil), isManual: true, issue: issue).metaLine(defaultRepo: shop),
                       "#142")
        XCTAssertEqual(NodeStatus(state: .blocked(by: 1), issue: issue, runID: "r", prNumber: 150, ci: "pending")
                        .metaLine(defaultRepo: shop), "#142 · PR #150 · CI …")
    }

    /// Spec 17: a pending step whose last run failed or was cancelled says so.
    func testMetaLineWarnsAboutAFailedOrCancelledRun() {
        let issue = IssueRef(repo: shop, number: 142)
        XCTAssertEqual(NodeStatus(state: .ready, warning: .lastRunFailed, issue: issue, runID: "r")
                        .metaLine(defaultRepo: shop), "#142 · el último run falló")
        XCTAssertEqual(NodeStatus(state: .ready, warning: .lastRunCancelled, issue: issue, runID: "r")
                        .metaLine(defaultRepo: shop), "#142 · el último run se canceló")
    }

    func testMetaLineNamesAnotherRepo() {
        let status = NodeStatus(state: .ready, issue: IssueRef(repo: "otra/lib", number: 12))
        XCTAssertEqual(status.metaLine(defaultRepo: shop), "otra/lib#12")
    }

    func testGoalSubtitle() {
        XCTAssertEqual(goalSubtitle(projectName: "web", repo: "acme/web", done: 2, total: 7),
                       "web · acme/web · 2 de 7 pasos hechos")
        XCTAssertEqual(goalSubtitle(projectName: "web", repo: nil, done: 0, total: 1), "web · 0 de 1 paso hecho")
        XCTAssertEqual(goalSubtitle(projectName: nil, repo: "acme/web", done: 0, total: 0), "0 de 0 pasos hechos")
    }
}
