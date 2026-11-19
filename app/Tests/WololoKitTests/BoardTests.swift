import XCTest
@testable import WololoKit

final class BoardTests: XCTestCase {
    private let now = fixtureNow

    private func column(_ board: Board, _ id: String) -> [String] {
        board.columns.first { $0.id == id }?.runs.map(\.id) ?? []
    }

    func testEveryStatusMapsToItsGroup() {
        let expected: [RunStatus: StatusGroup] = [
            .waitingUser: .waiting, .waitingPermission: .waiting, .blocked: .waiting, .stalled: .waiting,
            .running: .working, .waitingAgents: .working, .waitingTests: .working, .waitingCI: .working,
            .pausing: .working, .inReview: .review, .paused: .onHold, .orphaned: .onHold, .done: .finished, .failed: .finished,
            .cancelled: .finished,
        ]
        for status in RunStatus.known {
            XCTAssertEqual(StatusGroup(status), expected[status], status.rawValue)
        }
    }

    func testUnknownStatusIsWorking() throws {
        let run = try makeRun("new", status: "something_new")
        XCTAssertEqual(StatusGroup(run, now: now), .working)
        XCTAssertEqual(column(Board(runs: [run], now: now, mode: .byStatus), "working"), ["new"])
    }

    func testStatusColumnsAndLabels() {
        let board = Board(runs: [], now: now, mode: .byStatus)
        XCTAssertEqual(board.columns.map(\.id), ["waiting", "working", "review", "finished"])
        XCTAssertEqual(board.columns.map { $0.label(.es) }, ["Te espera", "Trabajando", "En revisión", "Terminado"])
        XCTAssertEqual(board.columns.map { $0.label(.en) }, ["Waiting for you", "Working", "In review", "Finished"])
        XCTAssertEqual(StatusGroup.onHold.label(.es), "En pausa / huérfano")
        XCTAssertEqual(board.onHold, [])
    }

    func testWaitingUserGoesFirstInTheWidgetAndIsCounted() throws {
        let runs = [
            try makeRun("busy", status: "running", updatedAt: now - 10),
            try makeRun("asks", status: "waiting_user", updatedAt: now - 600,
                        ["waiting": ["on": "user", "question": "¿Aprobás el spec?", "since": now - 600]]),
            try makeRun("old", status: "waiting_agents", updatedAt: now - 300),
            try makeRun("shipped", status: "done", updatedAt: now - 5),
        ]

        XCTAssertEqual(widgetRuns(runs, now: now).map(\.id), ["asks", "busy", "old"])
        XCTAssertEqual(menuBarCount(runs, now: now), 1)
        XCTAssertEqual(column(Board(runs: runs, now: now, mode: .byStatus), "waiting"), ["asks"])
        XCTAssertEqual(activityLine(runs[1], now: now), "¿Aprobás el spec?")
        XCTAssertEqual(RunProgress(runs[1], now: now).role, .waiting)
    }

    func testMenuBarHeaderCountsWaitingAmongActive() throws {
        let runs = [
            try makeRun("asks", status: "waiting_user"),
            try makeRun("blocked", status: "blocked"),
            try makeRun("busy", status: "running"),
            try makeRun("orphan", status: "running", ["owner": ["heartbeat_at": now - 120]]),
            try makeRun("shipped", status: "done"),
        ]
        XCTAssertEqual(menuBarHeader(runs, now: now), "2 te esperan · 4 activos")
        XCTAssertEqual(menuBarHeader(Array(runs[2...]), now: now), "0 te esperan · 2 activos")
        XCTAssertEqual(menuBarHeader([runs[0]], now: now), "1 te espera · 1 activo")
    }

    func testBoardCountersCountWorkingAndWaitingOnPerson() throws {
        let runs = [
            try makeRun("asks", status: "waiting_user"),
            try makeRun("permission", status: "waiting_permission"),
            try makeRun("blocked", status: "blocked"),
            try makeRun("stalled", status: "stalled"),
            try makeRun("busy", status: "running"),
            try makeRun("agents", status: "waiting_agents"),
            try makeRun("pausing", status: "pausing"),
            try makeRun("new", status: "something_new"),
            try makeRun("orphan", status: "running", ["owner": ["heartbeat_at": now - 120]]),
            try makeRun("paused", status: "paused"),
            try makeRun("shipped", status: "done"),
        ]
        let counters = boardCounters(runs, now: now)
        XCTAssertEqual(counters.working, 4, "an orphaned run is not working")
        XCTAssertEqual(counters.waiting, 4)
        XCTAssertEqual(counters.waiting, menuBarCount(runs, now: now))
        let none = boardCounters([], now: now)
        XCTAssertEqual(none.working, 0)
        XCTAssertEqual(none.waiting, 0)
    }

    func testWaitingAndActiveLabels() {
        XCTAssertEqual(waitingLabel(1), "1 te espera")
        XCTAssertEqual(waitingLabel(3), "3 te esperan")
        XCTAssertEqual(waitingLabel(0), "0 te esperan")
        XCTAssertEqual(activeLabel(1), "1 activo")
        XCTAssertEqual(activeLabel(9), "9 activos")
    }

    func testOrphanedAndPausedRunsAreOnHold() throws {
        let orphan = try makeRun("orphan", status: "running", updatedAt: now - 120,
                                 ["owner": ["heartbeat_at": now - 120]])
        let paused = try makeRun("paused", status: "paused", updatedAt: now - 3600,
                                 ["owner": ["heartbeat_at": now - 3600]])
        let board = Board(runs: [orphan, paused], now: now, mode: .byStatus)

        XCTAssertEqual(effectiveStatus(orphan, now: now), .orphaned)
        XCTAssertEqual(effectiveStatus(paused, now: now), .paused)
        XCTAssertEqual(board.onHold.map(\.id), ["orphan", "paused"])
        XCTAssertEqual(board.onHoldCount, 2)
        XCTAssertFalse(board.columns.flatMap(\.runs).contains { ["orphan", "paused"].contains($0.id) })
        // Under the board in both modes, never in a stage column.
        let byStage = Board(runs: [orphan, paused], now: now, mode: .byStage)
        XCTAssertEqual(byStage.onHold.map(\.id), ["orphan", "paused"])
        XCTAssertTrue(byStage.columns.allSatisfy(\.runs.isEmpty))
        XCTAssertEqual(activityLine(orphan, now: now), "sin señal hace 2m")
        XCTAssertEqual(ago(orphan.updatedAt, now: now, lang: orphan.lang), "hace 2m")
    }

    func testGridShowsTheActiveRunsInTheWidgetsOrderAndTheRecentlyFinishedUnder() throws {
        let runs = [
            try makeRun("works", status: "running", updatedAt: now - 60),
            try makeRun("asks", status: "waiting_user", updatedAt: now - 30),
            try makeRun("fresh", status: "done", updatedAt: now - 3600, ["finished_at": now - 3600]),
            try makeRun("paused", status: "paused", updatedAt: now - 3600, ["owner": ["heartbeat_at": now - 3600]]),
        ]
        let board = Board(runs: runs, now: now, mode: .grid)

        XCTAssertEqual(board.columns.map(\.id), ["active", "finished"])
        XCTAssertEqual(board.columns[0].runs.map(\.id), ["asks", "works"])
        XCTAssertEqual(board.columns[1].runs.map(\.id), ["fresh"], "a run finished in the last 24 h stays in sight")
        XCTAssertEqual(board.recentlyFinished.map(\.id), ["fresh"])
        XCTAssertEqual(board.onHold.map(\.id), ["paused"])
    }

    func testOldFinishedRunsGoToTheArchive() throws {
        let day: TimeInterval = 24 * 3600
        let runs = [
            try makeRun("old", status: "done", updatedAt: now - 3 * day, ["finished_at": now - 3 * day]),
            try makeRun("fresh", status: "failed", updatedAt: now - 3600, ["finished_at": now - 3600]),
            try makeRun("no-finish-time", status: "cancelled", updatedAt: now - 2 * day),
            try makeRun("touched-later", status: "done", updatedAt: now - 60, ["finished_at": now - 2 * day]),
        ]
        let board = Board(runs: runs, now: now, mode: .byStatus)

        XCTAssertEqual(column(board, "finished"), ["fresh"])
        XCTAssertEqual(board.archive.map(\.id), ["no-finish-time", "touched-later", "old"])
        XCTAssertEqual(board.archiveCount, 3)
        XCTAssertEqual(Board(runs: runs, now: now, mode: .byStage).archiveCount, 3)
    }

    func testFinishedWindowEdges() throws {
        let day: TimeInterval = 24 * 3600
        let runs = [
            try makeRun("edge", status: "done", updatedAt: now - day, ["finished_at": now - day]),
            try makeRun("past-edge", status: "done", updatedAt: now - day - 1, ["finished_at": now - day - 1]),
            try makeRun("no-finish-time", status: "done", updatedAt: now - 3600),
        ]
        let board = Board(runs: runs, now: now, mode: .byStatus)

        XCTAssertEqual(column(board, "finished"), ["no-finish-time", "edge"])
        XCTAssertEqual(board.archive.map(\.id), ["past-edge"])
    }

    func testCancelledRunsGoStraightToTheArchive() throws {
        let runs = [
            try makeRun("discarded", status: "cancelled", updatedAt: now - 60, ["finished_at": now - 60]),
            try makeRun("shipped", status: "done", updatedAt: now - 120, ["finished_at": now - 120]),
            try makeRun("broke", status: "failed", updatedAt: now - 180, ["finished_at": now - 180]),
        ]
        let board = Board(runs: runs, now: now, mode: .byStatus)

        XCTAssertEqual(column(board, "finished"), ["shipped", "broke"])
        XCTAssertEqual(board.archive.map(\.id), ["discarded"])
    }

    func testWorkingRunsKeepTheOrderTheyStartedInWhateverTheyDo() throws {
        let runs = [
            try makeRun("second", updatedAt: now - 1, ["created_at": now - 600]),
            try makeRun("first", updatedAt: now - 90, ["created_at": now - 900]),
            try makeRun("third", status: "waiting_agents", updatedAt: now - 30, ["created_at": now - 300]),
            try makeRun("tie", updatedAt: now - 5, ["created_at": now - 600]),
        ]
        let order = ["first", "second", "tie", "third"]
        XCTAssertEqual(column(Board(runs: runs, now: now, mode: .byStatus), "working"), order)
        // A new event in one of them changes nothing.
        var busier = runs
        busier[2].updatedAt = now
        XCTAssertEqual(column(Board(runs: busier, now: now, mode: .byStatus), "working"), order)
        XCTAssertEqual(widgetRuns(busier, now: now).map(\.id), order)
    }

    func testWaitingRunsQueueByHowLongTheyWait() throws {
        let runs = [
            try makeRun("asked-late", status: "waiting_user", updatedAt: now - 1,
                        ["waiting": ["on": "user", "question": "?", "since": now - 60], "created_at": now - 9000]),
            try makeRun("asked-early", status: "waiting_permission", updatedAt: now - 2,
                        ["waiting": ["on": "permission", "question": "Bash", "since": now - 600], "created_at": now - 100]),
            try makeRun("blocked", status: "blocked", updatedAt: now - 3,
                        ["blocked": ["reason": "x", "since": now - 300], "created_at": now - 200]),
        ]
        let order = ["asked-early", "blocked", "asked-late"]
        XCTAssertEqual(column(Board(runs: runs, now: now, mode: .byStatus), "waiting"), order)
        XCTAssertEqual(widgetRuns(runs, now: now).map(\.id), order)
    }

    func testRunsOnHoldShowTheLastToStopFirst() throws {
        let runs = [
            try makeRun("paused-early", status: "paused", updatedAt: now - 10, ["paused": ["note": "", "since": now - 3000]]),
            try makeRun("orphan", status: "running", updatedAt: now - 5,
                        ["owner": ["session_id": "s", "cwd": "/tmp", "heartbeat_at": now - 1000]]),
            try makeRun("paused-late", status: "paused", updatedAt: now - 2000, ["paused": ["note": "", "since": now - 2000]]),
        ]
        XCTAssertEqual(Board(runs: runs, now: now, mode: .byStatus).onHold.map(\.id), ["orphan", "paused-late", "paused-early"])
    }

    /// The review column is a queue waiting on merges: the longest in review first, by when it went into review.
    func testReviewColumnQueuesByWhenTheRunWentIntoReview() throws {
        let runs = [
            try makeRun("late", status: "in_review", updatedAt: now - 1, ["pr_review": ["since": now - 60], "created_at": now - 9000]),
            try makeRun("early", status: "in_review", updatedAt: now - 2, ["pr_review": ["since": now - 3600], "created_at": now - 100]),
            try makeRun("no-since", status: "in_review", updatedAt: now - 3, ["pr_review": ["since": 0], "created_at": now - 600]),
            try makeRun("busy", status: "running"),
        ]
        let board = Board(runs: runs, now: now, mode: .byStatus)
        XCTAssertEqual(column(board, "review"), ["early", "no-since", "late"])
        XCTAssertEqual(column(board, "working"), ["busy"])
        XCTAssertEqual(boardCounters(runs, now: now).working, 1, "a run in review is not working")
        XCTAssertEqual(menuBarCount(runs, now: now), 0)
    }

    /// A run in review whose session closed stays in review: it waits on its reviewers, not on the session.
    func testRunInReviewWithoutSessionStaysInReview() throws {
        let run = try makeRun("pr", status: "in_review", ["owner": ["heartbeat_at": now - 86400]])
        let board = Board(runs: [run], now: now, mode: .byStatus)
        XCTAssertEqual(column(board, "review"), ["pr"])
        XCTAssertEqual(board.onHold, [])
        XCTAssertTrue(isActive(run, now: now))
        XCTAssertEqual(RunProgress(run, now: now).role, .review)
        XCTAssertEqual(activityLine(run, now: now), "Esperando revisión del PR")
    }

    func testRunInReviewStaysInItsStageColumn() throws {
        let run = try makeRun("pr", status: "in_review", ["stage": ["id": "pr", "index": 7, "since": 0]])
        XCTAssertEqual(column(Board(runs: [run], now: now, mode: .byStage), "pr"), ["pr"])
    }

    func testWidgetPutsRunsInReviewAfterTheWorkingOnes() throws {
        let runs = [
            try makeRun("review", status: "in_review", ["pr_review": ["since": now - 600], "created_at": now - 9000]),
            try makeRun("busy", status: "running", ["created_at": now - 300]),
            try makeRun("asks", status: "waiting_user", ["waiting": ["on": "user", "question": "?", "since": now - 60]]),
        ]
        XCTAssertEqual(widgetRuns(runs, now: now).map(\.id), ["asks", "busy", "review"])
    }

    func testFinishedRunsShowTheLastToFinishFirst() throws {
        let runs = [
            try makeRun("earlier", status: "done", updatedAt: now - 1, ["finished_at": now - 3600]),
            try makeRun("later", status: "failed", updatedAt: now - 500, ["finished_at": now - 600]),
        ]
        XCTAssertEqual(column(Board(runs: runs, now: now, mode: .byStatus), "finished"), ["later", "earlier"])
    }

    func testStageColumnsHoldOnlyActiveRuns() throws {
        let implementing = try makeRun("impl", status: "running", ["stage": ["id": "implement", "index": 4, "since": 0]])
        let finished = try makeRun("done", status: "done", ["stage": ["id": "implement", "index": 4, "since": 0]])
        let starting = try Run.decode(from: Data(#"""
        { "id": "fresh", "status": "running", "stage": null, "updated_at": 999000, "owner": { "heartbeat_at": 999990 } }
        """#.utf8))
        XCTAssertNil(starting.stage)

        let board = Board(runs: [implementing, finished, starting], now: now, mode: .byStage)

        XCTAssertEqual(board.columns.map(\.id), Stage.all.map(\.id))
        XCTAssertEqual(board.columns.map { $0.label(.es) }[5], "Implementación")
        XCTAssertEqual(column(board, "implement"), ["impl"])
        XCTAssertEqual(column(board, "context"), ["fresh"])
        XCTAssertFalse(board.columns.flatMap(\.runs).contains { $0.id == "done" })
    }

    func testProjectSummaries() throws {
        let runs = [
            try makeRun("w1", status: "waiting_user", ["project": ["key": "saugon__wololo"]]),
            try makeRun("w2", status: "running", ["project": ["key": "saugon__wololo"]]),
            try makeRun("w3", status: "done", ["project": ["key": "saugon__wololo"]]),
            try makeRun("b1", status: "done", ["project": ["key": "acme__billing"]]),
        ]
        let summaries = projectSummaries(runs, now: now)

        XCTAssertEqual(summaries.map(\.key), ["acme__billing", "saugon__wololo"])
        XCTAssertEqual(summaries.map(\.display), ["acme/billing", "saugon/wololo"])
        XCTAssertEqual(summaries.map(\.active), [0, 2])
        XCTAssertEqual(summaries.map(\.waiting), [0, 1])
        XCTAssertEqual(summaries.map(\.hasWaiting), [false, true])
    }

    func testProjectDisplay() throws {
        XCTAssertEqual(try makeRun("a", ["project": ["key": "saugon__wololo"]]).project.display, "saugon/wololo")
        XCTAssertEqual(try makeRun("b", ["project": ["key": "solo"]]).project.display, "solo")
        XCTAssertEqual(try makeRun("c", ["project": ["key": "", "path": "/Users/me/thing"]]).project.display, "thing")
    }

    func testLastFinishedForAnEmptyWidget() throws {
        let runs = [
            try makeRun("earlier", status: "done", ["finished_at": now - 7200]),
            try makeRun("later", status: "cancelled", ["finished_at": now - 60]),
            try makeRun("active", status: "running"),
        ]
        XCTAssertEqual(lastFinished(runs, now: now)?.id, "later")
        XCTAssertTrue(widgetRuns(runs.filter { $0.status.isTerminal }, now: now).isEmpty)
    }
}
