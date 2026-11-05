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
            .pausing: .working, .paused: .onHold, .orphaned: .onHold, .done: .finished, .failed: .finished,
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
        XCTAssertEqual(board.columns.map(\.id), ["waiting", "working", "onHold", "finished"])
        XCTAssertEqual(board.columns.map { $0.label(.es) }, ["Te espera", "Trabajando", "En pausa / huérfano", "Terminado"])
        XCTAssertEqual(board.columns.map { $0.label(.en) }, ["Waiting for you", "Working", "Paused / orphaned", "Finished"])
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
        XCTAssertEqual(column(board, "onHold"), ["orphan", "paused"])
        XCTAssertEqual(column(board, "working"), [])
        XCTAssertEqual(activityLine(orphan, now: now), "sin señal hace 2m")
        XCTAssertEqual(ago(orphan.updatedAt, now: now, lang: orphan.lang), "hace 2m")
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
        XCTAssertEqual(board.archive.map(\.id), ["touched-later", "no-finish-time", "old"])
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

    func testColumnsSortByMostRecentUpdate() throws {
        let runs = [
            try makeRun("b", updatedAt: now - 30),
            try makeRun("a", updatedAt: now - 10),
            try makeRun("c", updatedAt: now - 90),
            try makeRun("tie-2", updatedAt: now - 30),
        ]
        XCTAssertEqual(column(Board(runs: runs, now: now, mode: .byStatus), "working"), ["a", "b", "tie-2", "c"])
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
        XCTAssertEqual(board.columns.map { $0.label(.es) }[4], "Implementación")
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
