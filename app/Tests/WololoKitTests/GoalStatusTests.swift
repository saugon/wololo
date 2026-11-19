import XCTest
@testable import WololoKit

final class GoalStatusTests: XCTestCase {
    private let shop = "acme/shop"

    private func goal(_ nodes: [GoalNode], edges: [(String, String)] = []) -> Goal {
        var goal = Goal(id: "g", projectID: "acme__shop", title: "Ecommerce terminado", updatedAt: 0)
        for node in nodes {
            XCTAssertTrue(goal.addNode(node))
        }
        for (from, to) in edges {
            XCTAssertEqual(goal.connect(from: from, to: to), .ok)
        }
        return goal
    }

    private func issueRun(_ id: String, ref: String, status: String = "running", key: String = "acme__shop",
                          url: String? = nil, createdAt: TimeInterval = fixtureNow - 600,
                          _ extra: [String: Any] = [:]) throws -> Run {
        var source: [String: Any] = ["kind": "github_issue", "ref": ref]
        if let url { source["url"] = url }
        var fields: [String: Any] = [
            "source": source,
            "project": ["key": key, "path": "/code/shop"],
            "created_at": createdAt,
        ]
        fields.merge(extra) { _, new in new }
        return try makeRun(id, status: status, fields)
    }

    private func status(_ goal: Goal, _ runs: [Run], defaultRepo: String? = "acme/shop") -> GoalStatus {
        goal.status(defaultRepo: defaultRepo, runs: RunIndex(runs: runs), now: fixtureNow)
    }

    // MARK: - IssueRef

    func testParsesBareAndHashNumbersIntoTheDefaultRepo() {
        XCTAssertEqual(IssueRef.parse("131", defaultRepo: shop), IssueRef(repo: shop, number: 131))
        XCTAssertEqual(IssueRef.parse("#131", defaultRepo: shop), IssueRef(repo: shop, number: 131))
        XCTAssertEqual(IssueRef.parse("131", defaultRepo: nil), IssueRef(repo: nil, number: 131))
    }

    func testParsesAnotherRepoAndURLs() {
        XCTAssertEqual(IssueRef.parse("otra/lib#12", defaultRepo: shop), IssueRef(repo: "otra/lib", number: 12))
        XCTAssertEqual(IssueRef.parse("https://github.com/otra/lib/issues/12", defaultRepo: shop),
                       IssueRef(repo: "otra/lib", number: 12))
        XCTAssertEqual(IssueRef.parse("https://github.com/otra/lib/pull/7", defaultRepo: shop),
                       IssueRef(repo: "otra/lib", number: 7))
        XCTAssertEqual(IssueRef.parse("https://github.com/otra/lib/issues/12#issuecomment-1", defaultRepo: nil),
                       IssueRef(repo: "otra/lib", number: 12))
    }

    func testTrimsWhitespaceAndNewlinesBeforeParsing() {
        XCTAssertEqual(IssueRef.parse("  #131\n", defaultRepo: shop), IssueRef(repo: shop, number: 131))
        XCTAssertEqual(IssueRef.parse("\thttps://github.com/acme/shop/issues/9 \n", defaultRepo: nil),
                       IssueRef(repo: shop, number: 9))
    }

    func testRejectsGarbage() {
        for raw in ["", "  ", "abc", "#", "#abc", "12a", "-3", "0", "a/b/c#1", "/lib#1", "otra/#1",
                    "https://github.com/otra/lib", "https://gitlab.com/otra/lib/issues/1",
                    "https://github.com/otra/lib/commits/1"] {
            XCTAssertNil(IssueRef.parse(raw, defaultRepo: shop), raw)
        }
    }

    func testReposCompareCaseInsensitively() {
        let ref = IssueRef(repo: "Acme/Shop", number: 1)
        XCTAssertTrue(ref.isIn(repo: shop))
        XCTAssertEqual(ref.label(defaultRepo: shop), "#1")
        XCTAssertEqual(IssueRef(repo: "otra/lib", number: 12).label(defaultRepo: shop), "otra/lib#12")
    }

    // MARK: - Runs to issues

    func testRunRepoComesFromURLThenProjectKey() throws {
        let withURL = try issueRun("a", ref: "12", key: "acme__shop", url: "https://github.com/otra/lib/issues/12")
        XCTAssertEqual(runRepo(withURL), "otra/lib")
        let withoutURL = try issueRun("b", ref: "131")
        XCTAssertEqual(runRepo(withoutURL), shop)
        let noRepo = try issueRun("c", ref: "131", key: "shop")
        XCTAssertNil(runRepo(noRepo))
    }

    func testRepoFromProjectKey() {
        XCTAssertEqual(repo(fromProjectKey: "acme__shop"), shop)
        XCTAssertNil(repo(fromProjectKey: "local__shop-abc123"))
        XCTAssertNil(repo(fromProjectKey: "shop"))
    }

    func testLocalProjectKeyGivesNoRepo() throws {
        let run = try issueRun("r", ref: "131", key: "local__shop-abc123")
        XCTAssertNil(runRepo(run))
        XCTAssertNil(RunIndex(runs: [run]).run(for: IssueRef(repo: "local/shop-abc123", number: 131)))
    }

    func testURLMatchesTheNodeCaseInsensitively() throws {
        let run = try issueRun("r", ref: "5", url: "https://github.com/Acme/Shop/issues/5")
        XCTAssertEqual(RunIndex(runs: [run]).run(for: IssueRef(repo: shop, number: 5))?.id, "r")
        XCTAssertEqual(status(goal([GoalNode(id: "a", issue: "acme/shop#5")]), [run]).status(of: "a")?.runID, "r")
    }

    func testRefNamingAnotherRepoWinsOverTheProjectKey() throws {
        let run = try issueRun("r", ref: "otra/lib#12", key: "acme__shop")
        let index = RunIndex(runs: [run])
        XCTAssertEqual(index.run(for: IssueRef(repo: "otra/lib", number: 12))?.id, "r")
        XCTAssertNil(index.run(for: IssueRef(repo: shop, number: 12)))
    }

    func testURLGivesBothRepoAndNumber() throws {
        let run = try issueRun("r", ref: "otra/lib#5", url: "https://github.com/acme/shop/issues/7")
        let index = RunIndex(runs: [run])
        XCTAssertEqual(index.run(for: IssueRef(repo: shop, number: 7))?.id, "r")
        XCTAssertNil(index.run(for: IssueRef(repo: "otra/lib", number: 5)))
        XCTAssertNil(index.run(for: IssueRef(repo: shop, number: 5)))
        XCTAssertNil(index.run(for: IssueRef(repo: "otra/lib", number: 7)))
    }

    func testMostRecentRunWins() throws {
        let old = try issueRun("old", ref: "131", status: "failed", createdAt: fixtureNow - 9000)
        let new = try issueRun("new", ref: "131", createdAt: fixtureNow - 100)
        let index = RunIndex(runs: [new, old])
        XCTAssertEqual(index.run(for: IssueRef(repo: shop, number: 131))?.id, "new")
        XCTAssertEqual(RunIndex(runs: [old, new]).run(for: IssueRef(repo: shop, number: 131))?.id, "new")
    }

    func testOnlyGitHubIssueRunsCount() throws {
        let text = try makeRun("t", ["source": ["kind": "text", "ref": "131"], "project": ["key": "acme__shop"]])
        XCTAssertNil(RunIndex(runs: [text]).run(for: IssueRef(repo: shop, number: 131)))
    }

    func testNodeWithoutAnIssueFindsTheTextRunLaunchedFromIt() throws {
        let text = try makeRun("t", ["source": ["kind": "text", "ref": "Multiples imagenes"],
                                     "project": ["key": "acme__shop"], "node": ["goal": "g", "id": "a"],
                                     "stage": ["id": "context", "index": 0, "total": 8, "since": 0]])
        let other = try makeRun("o", ["source": ["kind": "text", "ref": "x"], "node": ["goal": "otro", "id": "a"]])
        let result = status(goal([GoalNode(id: "a", title: "Multiples imagenes")]), [text, other])
        XCTAssertEqual(result.status(of: "a")?.runID, "t")
        XCTAssertEqual(result.status(of: "a")?.state, .doing(stage: "context"))
        XCTAssertEqual(result.status(of: "a")?.action, .viewRun(id: "t"))
    }

    func testNewerOfTheLaunchedRunAndTheIssueRunWins() throws {
        let launched = try makeRun("l", ["source": ["kind": "text", "ref": "x"], "node": ["goal": "g", "id": "a"],
                                         "created_at": fixtureNow - 100])
        let old = try issueRun("old", ref: "131", status: "failed", createdAt: fixtureNow - 9000)
        let node = GoalNode(id: "a", issue: "131")
        XCTAssertEqual(status(goal([node]), [launched, old]).status(of: "a")?.runID, "l")
        let newer = try issueRun("new", ref: "131", createdAt: fixtureNow - 10)
        XCTAssertEqual(status(goal([node]), [launched, newer]).status(of: "a")?.runID, "new")
    }

    func testHashRefMatchesBareNumber() throws {
        let run = try issueRun("r", ref: "#131")
        let s = status(goal([GoalNode(id: "a", issue: "131")]), [run])
        XCTAssertEqual(s.status(of: "a")?.runID, "r")
    }

    func testIssueInAnotherRepoMatchesOnlyThatRepo() throws {
        let lib = try issueRun("lib", ref: "12", key: "otra__lib")
        let shopRun = try issueRun("shop", ref: "12")
        let s = status(goal([GoalNode(id: "a", issue: "otra/lib#12"), GoalNode(id: "b", issue: "#12")]),
                       [lib, shopRun])
        XCTAssertEqual(s.status(of: "a")?.runID, "lib")
        XCTAssertEqual(s.status(of: "b")?.runID, "shop")
    }

    // MARK: - Spec 17 table

    /// Scenario 5.
    func testLiveRunIsDoingAndManualStateOverridesUntilAuto() throws {
        let run = try issueRun("r", ref: "131", ["stage": ["id": "build", "index": 4, "since": 0]])
        var g = goal([GoalNode(id: "a", issue: "#131")])

        var a = try XCTUnwrap(status(g, [run]).status(of: "a"))
        XCTAssertEqual(a.state, .doing(stage: "build"))
        XCTAssertFalse(a.isManual)
        XCTAssertEqual(a.action, .viewRun(id: "r"))

        g.nodes[0].manualState = .done
        a = try XCTUnwrap(status(g, [run]).status(of: "a"))
        XCTAssertEqual(a.state, .done(prNumber: nil))
        XCTAssertTrue(a.isManual)

        g.nodes[0].manualState = nil
        XCTAssertEqual(status(g, [run]).status(of: "a")?.state, .doing(stage: "build"))
    }

    /// Scenario 6.
    func testMergedPRIsDoneAndItsArrowIsSatisfied() throws {
        let run = try issueRun("r", ref: "131", status: "in_review", [
            "pr": ["url": "https://github.com/acme/shop/pull/140", "number": 140, "state": "merged", "ci": "passing"],
        ])
        let g = goal([GoalNode(id: "a", issue: "131"), GoalNode(id: "b")], edges: [("a", "b")])
        let s = status(g, [run])
        XCTAssertEqual(s.status(of: "a")?.state, .done(prNumber: 140))
        XCTAssertEqual(s.status(of: "a")?.action, .openPR(url: "https://github.com/acme/shop/pull/140", number: 140))
        XCTAssertEqual(s.kind(of: GoalEdge(from: "a", to: "b")), .satisfied)
        XCTAssertEqual(s.status(of: "b")?.state, .ready)
    }

    func testOutcomeDoneIsDone() throws {
        let run = try issueRun("r", ref: "131", status: "done", ["outcome": "done"])
        let a = status(goal([GoalNode(id: "a", issue: "131")]), [run]).status(of: "a")
        XCTAssertEqual(a?.state, .done(prNumber: nil))
        XCTAssertEqual(a?.action, NodeAction.none)
    }

    func testReadyPRIsReviewWithCI() throws {
        let run = try issueRun("r", ref: "131", [
            "pr": ["url": "https://github.com/acme/shop/pull/140", "number": 140, "state": "ready", "ci": "pending"],
        ])
        let a = status(goal([GoalNode(id: "a", issue: "131")]), [run]).status(of: "a")
        XCTAssertEqual(a?.state, .review(prNumber: 140, ci: "pending"))
        XCTAssertEqual(a?.ci, "pending")
        XCTAssertEqual(a?.action, .openPR(url: "https://github.com/acme/shop/pull/140", number: 140))
    }

    func testInReviewStatusIsReviewEvenWithAStaleSession() throws {
        let run = try issueRun("r", ref: "131", status: "in_review", [
            "owner": ["heartbeat_at": fixtureNow - 86400],
            "pr": ["url": "https://github.com/acme/shop/pull/140", "number": 140, "state": "draft"],
        ])
        XCTAssertEqual(status(goal([GoalNode(id: "a", issue: "131")]), [run]).status(of: "a")?.state,
                       .review(prNumber: 140, ci: nil))
    }

    func testFailedOrCancelledRunIsPendingWithAWarning() throws {
        let failed = try issueRun("f", ref: "1", status: "failed", ["outcome": "failed"])
        let cancelled = try issueRun("c", ref: "2", status: "cancelled", ["outcome": "cancelled"])
        let s = status(goal([GoalNode(id: "a", issue: "1"), GoalNode(id: "b", issue: "2")]), [failed, cancelled])
        XCTAssertEqual(s.status(of: "a")?.baseState, .pending)
        XCTAssertEqual(s.status(of: "a")?.state, .ready)
        XCTAssertEqual(s.status(of: "a")?.warning, .lastRunFailed)
        XCTAssertEqual(s.status(of: "a")?.action, .start)
        XCTAssertEqual(s.status(of: "b")?.warning, .lastRunCancelled)
    }

    func testOrphanedRunIsStillDoing() throws {
        let run = try issueRun("r", ref: "131", ["owner": ["heartbeat_at": fixtureNow - 3600]])
        XCTAssertEqual(status(goal([GoalNode(id: "a", issue: "131")]), [run]).status(of: "a")?.state,
                       .doing(stage: nil))
    }

    // MARK: - Spec 18

    /// Scenario 7.
    func testManualDoneWithoutIssueMakesItsSuccessorReady() {
        let g = goal([GoalNode(id: "a", manualState: .done), GoalNode(id: "b")], edges: [("a", "b")])
        let s = status(g, [])
        XCTAssertEqual(s.status(of: "a")?.state, .done(prNumber: nil))
        XCTAssertEqual(s.status(of: "b")?.state, .ready)
        XCTAssertEqual(s.done, 1)
        XCTAssertEqual(s.total, 2)
    }

    /// Scenario 3.
    func testPendingPredecessorBlocksItsSuccessor() {
        let g = goal([GoalNode(id: "a"), GoalNode(id: "b")], edges: [("a", "b")])
        let s = status(g, [])
        XCTAssertEqual(s.status(of: "a")?.state, .ready)
        XCTAssertEqual(s.status(of: "b")?.state, .blocked(by: 1))
        XCTAssertEqual(s.kind(of: GoalEdge(from: "a", to: "b")), .blocking)
    }

    /// Scenario 12.
    func testBlockerCountCountsPredecessorsNotDone() throws {
        let g = goal([GoalNode(id: "a"), GoalNode(id: "b"), GoalNode(id: "c", manualState: .done), GoalNode(id: "d")],
                     edges: [("a", "d"), ("b", "d"), ("c", "d")])
        let s = status(g, [])
        XCTAssertEqual(s.blockerCount(of: "d"), 2)
        XCTAssertEqual(s.status(of: "d")?.action, .blocked(by: 2))
    }

    func testLiveRunBehindAPendingStepIsBlockedButKeepsItsBase() throws {
        let run = try issueRun("r", ref: "5")
        let g = goal([GoalNode(id: "a"), GoalNode(id: "b", issue: "5")], edges: [("a", "b")])
        let b = status(g, [run]).status(of: "b")
        XCTAssertEqual(b?.state, .blocked(by: 1))
        XCTAssertEqual(b?.baseState, .doing(stage: nil))
    }

    func testFinalIsDoneWhenEveryPredecessorIsDone() {
        var g = goal([GoalNode(id: "a", manualState: .done), GoalNode(id: "b")],
                     edges: [("a", Goal.finalID), ("b", Goal.finalID)])
        var s = status(g, [])
        XCTAssertEqual(s.status(of: Goal.finalID)?.state, .pending)
        XCTAssertEqual(s.kind(of: GoalEdge(from: "a", to: Goal.finalID)), .satisfied)
        XCTAssertEqual(s.kind(of: GoalEdge(from: "b", to: Goal.finalID)), .pendingToGoal)

        g.nodes[1].manualState = .done
        s = status(g, [])
        XCTAssertEqual(s.status(of: Goal.finalID)?.state, .done(prNumber: nil))
        XCTAssertEqual(s.fraction, 1)
    }

    func testFinalNodeHasNoAction() {
        var g = goal([GoalNode(id: "a")], edges: [("a", Goal.finalID)])
        XCTAssertEqual(status(g, []).status(of: Goal.finalID)?.action, NodeAction.none)
        g.nodes[0].manualState = .done
        let s = status(g, [])
        XCTAssertEqual(s.status(of: Goal.finalID)?.state, .done(prNumber: nil))
        XCTAssertEqual(s.status(of: Goal.finalID)?.action, NodeAction.none)
        XCTAssertEqual(status(goal([]), []).status(of: Goal.finalID)?.action, NodeAction.none)
    }

    func testManualPendingWithAGoingRunViewsItInsteadOfStartingAnother() throws {
        let live = try issueRun("live", ref: "1")
        let review = try issueRun("review", ref: "2", status: "in_review")
        let failed = try issueRun("failed", ref: "3", status: "failed", ["outcome": "failed"])
        let g = goal([GoalNode(id: "a", issue: "1", manualState: .pending),
                      GoalNode(id: "b", issue: "2", manualState: .pending),
                      GoalNode(id: "c", issue: "3", manualState: .pending)])
        let s = status(g, [live, review, failed])
        XCTAssertEqual(s.status(of: "a")?.state, .ready)
        XCTAssertEqual(s.status(of: "a")?.action, .viewRun(id: "live"))
        XCTAssertEqual(s.status(of: "b")?.action, .viewRun(id: "review"))
        XCTAssertEqual(s.status(of: "c")?.action, .start)
    }

    func testFinalWithoutPredecessorsIsNotDone() {
        XCTAssertEqual(status(goal([]), []).status(of: Goal.finalID)?.state, .pending)
    }

    func testNodeWithoutRunOrManualStateIsReady() {
        let a = status(goal([GoalNode(id: "a", issue: "#131")]), []).status(of: "a")
        XCTAssertEqual(a?.state, .ready)
        XCTAssertEqual(a?.issue, IssueRef(repo: shop, number: 131))
        XCTAssertNil(a?.runID)
    }
}
