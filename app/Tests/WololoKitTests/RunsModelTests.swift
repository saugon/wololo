import XCTest
@testable import WololoKit

@MainActor
final class RunsModelTests: XCTestCase {
    private func column(_ model: RunsModel, _ id: String) -> [String] {
        Board(runs: model.runs, now: model.now, mode: .byStatus).columns.first { $0.id == id }?.runs.map(\.id) ?? []
    }

    func testATitleGivenInTheAppReplacesTheRunsOwnUntilItGoesBack() throws {
        let fixture = try StoreFixture()
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "wololo-titles-\(UUID().uuidString)"))
        let model = RunsModel(dataDirectory: DataDirectory(url: fixture.root), refreshInterval: nil, tickInterval: nil, watch: false,
                              titles: RunTitles(defaults: defaults, persists: true))
        try fixture.write("live", status: "running", ["title": "Pagos parciales"])
        model.reload()
        XCTAssertEqual(model.runs[0].displayTitle, "Pagos parciales")

        model.rename("live", to: "  Cobro en mesa  ")
        XCTAssertEqual(model.runs[0].displayTitle, "Cobro en mesa")
        XCTAssertEqual(model.runs[0].originalTitle, "Pagos parciales")
        XCTAssertTrue(matches(model.runs[0], query: "mesa"))

        // A rewrite of the snapshot keeps it, and so does a model started anew.
        try fixture.write("live", status: "waiting_user", ["title": "Pagos parciales"])
        model.refresh()
        XCTAssertEqual(model.runs[0].displayTitle, "Cobro en mesa")
        let again = RunsModel(dataDirectory: DataDirectory(url: fixture.root), refreshInterval: nil, tickInterval: nil, watch: false,
                              titles: RunTitles(defaults: defaults, persists: true))
        again.reload()
        XCTAssertEqual(again.runs[0].displayTitle, "Cobro en mesa")

        model.rename("live", to: nil)
        XCTAssertEqual(model.runs[0].displayTitle, "Pagos parciales")
        XCTAssertNil(defaults.object(forKey: RunTitles.key))

        // The run's own title, or a blank one, is no title of the person's.
        model.rename("live", to: "Pagos parciales")
        XCTAssertNil(model.runs[0].customTitle)
        model.rename("live", to: "   ")
        XCTAssertNil(model.runs[0].customTitle)
    }

    func testASnapshotWritesNoTitle() throws {
        let fixture = try StoreFixture()
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "wololo-titles-\(UUID().uuidString)"))
        let model = RunsModel(dataDirectory: DataDirectory(url: fixture.root), refreshInterval: nil, tickInterval: nil, watch: false,
                              titles: RunTitles(defaults: defaults, persists: false))
        try fixture.write("live", status: "running", ["title": "Pagos parciales"])
        model.reload()
        model.rename("live", to: "Otro")
        XCTAssertEqual(model.runs[0].displayTitle, "Pagos parciales")
        XCTAssertNil(defaults.object(forKey: RunTitles.key))
    }

    func testRewrittenSnapshotMovesTheCardOnRefresh() throws {
        let fixture = try StoreFixture()
        let model = RunsModel(dataDirectory: DataDirectory(url: fixture.root), refreshInterval: nil, tickInterval: nil, watch: false)
        try fixture.write("live", status: "running")
        model.reload()
        XCTAssertEqual(column(model, "working"), ["live"])

        try fixture.write("live", status: "waiting_agents", ["doing": ["text": "Implementando ítem 5", "since": 1]])
        model.refresh()
        XCTAssertEqual(column(model, "working"), ["live"])
        XCTAssertEqual(activityLine(model.runs[0], now: model.now), "Implementando ítem 5")

        try fixture.write("live", status: "done")
        model.refresh()
        XCTAssertEqual(column(model, "working"), [])
        XCTAssertEqual(column(model, "finished"), ["live"])
    }

    /// Scenario 2, through the watcher and the 2 s poll: each change shows within 3 s.
    func testStartedModelFollowsRewritesOnItsOwn() throws {
        let fixture = try StoreFixture()
        try fixture.write("live", status: "running")
        let model = RunsModel(dataDirectory: DataDirectory(url: fixture.root))
        model.start()
        defer { model.stop() }
        XCTAssertEqual(column(model, "working"), ["live"])

        try fixture.write("live", status: "waiting_agents", ["doing": ["text": "Implementando ítem 5", "since": 1]])
        waitUntil("waiting_agents") { model.runs.first?.status == .waitingAgents }
        XCTAssertEqual(column(model, "working"), ["live"])
        XCTAssertEqual(activityLine(model.runs[0], now: model.now), "Implementando ítem 5")

        let revision = model.eventsRevision
        try fixture.append(#"{"v":1,"seq":1,"ts":1,"run":"live","type":"doing","data":{}}"# + "\n", toEventsOf: "live")
        waitUntil("an events revision") { model.eventsRevision > revision }

        try fixture.write("live", status: "done")
        waitUntil("done") { model.runs.first?.status == .done }
        XCTAssertEqual(column(model, "finished"), ["live"])
    }

    /// The fallback for whatever FSEvents drops or merges: the 2 s mtime poll alone.
    func testPollAloneCatchesARewriteWithinThreeSeconds() throws {
        let fixture = try StoreFixture()
        try fixture.write("live", status: "running")
        let model = RunsModel(dataDirectory: DataDirectory(url: fixture.root), tickInterval: nil, watch: false)
        model.start()
        defer { model.stop() }

        try fixture.write("live", status: "done")
        waitUntil("done") { model.runs.first?.status == .done }
    }

    func testMissingRunsDirectoryAndItsLaterCreation() throws {
        let fixture = try StoreFixture(createRuns: false)
        let model = RunsModel(dataDirectory: DataDirectory(url: fixture.root), refreshInterval: 0.1, tickInterval: nil)
        model.start()
        defer { model.stop() }
        XCTAssertEqual(model.state, .missingRunsDirectory)
        XCTAssertEqual(model.runs, [])

        try fixture.write("first")
        waitUntil("the first run") { model.runs.map(\.id) == ["first"] }
        XCTAssertEqual(model.state, .ok)
    }

    func testARescanOfADirectoryCountsAsAnEventsChange() throws {
        let fixture = try StoreFixture()
        let model = RunsModel(dataDirectory: DataDirectory(url: fixture.root), refreshInterval: nil, tickInterval: nil, watch: false)

        model.changed([fixture.runsURL.appendingPathComponent("r/run.json").path])
        XCTAssertEqual(model.eventsRevision, 0)
        model.changed([fixture.runsURL.appendingPathComponent("r").path])
        XCTAssertEqual(model.eventsRevision, 1)
        model.changed([fixture.runsURL.appendingPathComponent("r/events.jsonl").path])
        XCTAssertEqual(model.eventsRevision, 2)
    }

    func testDroppingAStartedModelStopsItsTimers() throws {
        let fixture = try StoreFixture()
        var ticks = 0
        var model: RunsModel? = RunsModel(dataDirectory: DataDirectory(url: fixture.root), clock: {
            ticks += 1
            return 0
        }, refreshInterval: nil, tickInterval: 0.02)
        model?.start()
        weak let dropped = model
        model = nil
        XCTAssertNil(dropped)

        let count = ticks
        RunLoop.main.run(until: Date().addingTimeInterval(0.1))
        XCTAssertEqual(ticks, count)
    }

    func testTickMovesNowSoARunGoesOrphaned() throws {
        let fixture = try StoreFixture()
        try fixture.write("r", status: "running", heartbeat: 1_000)
        var clock: TimeInterval = 1_010
        let model = RunsModel(dataDirectory: DataDirectory(url: fixture.root), clock: { clock },
                              refreshInterval: nil, tickInterval: nil, watch: false)
        model.reload()
        XCTAssertEqual(model.now, 1_010)
        XCTAssertEqual(effectiveStatus(model.runs[0], now: model.now), .running)

        clock = 1_100
        model.tick()
        XCTAssertEqual(model.now, 1_100)
        XCTAssertEqual(effectiveStatus(model.runs[0], now: model.now), .orphaned)
    }

    func testTimersTickWhileStarted() throws {
        let fixture = try StoreFixture()
        var clock: TimeInterval = 0
        let model = RunsModel(dataDirectory: DataDirectory(url: fixture.root), clock: { clock },
                              refreshInterval: nil, tickInterval: 0.05, watch: false)
        model.start()
        clock = 42
        waitUntil("a tick") { model.now == 42 }

        model.stop()
        XCTAssertFalse(model.isStarted)
        clock = 43
        RunLoop.main.run(until: Date().addingTimeInterval(0.2))
        XCTAssertEqual(model.now, 42, "no ticks after stop")
    }
}
