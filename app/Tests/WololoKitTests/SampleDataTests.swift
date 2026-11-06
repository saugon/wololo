import XCTest
@testable import WololoKit

/// `app/scripts/sample-data.sh`, the data the UI snapshots are taken against.
final class SampleDataTests: XCTestCase {
    private let appDirectory = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()

    private func runScript(into directory: URL) throws -> Int32 {
        let script = appDirectory.appendingPathComponent("scripts/sample-data.sh")
        guard FileManager.default.isExecutableFile(atPath: script.path),
              FileManager.default.isExecutableFile(atPath: "/usr/bin/perl") else {
            throw XCTSkip("sample-data.sh or perl is not available")
        }
        let process = Process()
        process.executableURL = script
        process.arguments = [directory.path]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try process.run()
        process.waitUntilExit()
        return process.terminationStatus
    }

    func testScriptWritesARunOfEveryKind() throws {
        let fixture = try StoreFixture(createRuns: false)
        XCTAssertEqual(try runScript(into: fixture.root), 0)
        XCTAssertEqual(try runScript(into: fixture.root), 0, "it may replace the sample data it wrote")

        let store = RunStore(runsURL: fixture.runsURL)
        store.scan()
        let runs = store.runs
        let now = Date().timeIntervalSince1970
        XCTAssertGreaterThanOrEqual(runs.count, 10)
        XCTAssertEqual(store.reads, runs.count, "every template decodes")
        XCTAssertEqual(Set(runs.map { StatusGroup($0, now: now) }), Set(StatusGroup.allCases))

        let statuses = Set(runs.map { effectiveStatus($0, now: now) })
        for status: RunStatus in [.waitingUser, .waitingPermission, .blocked, .waitingAgents, .running, .waitingTests,
                                  .waitingCI, .orphaned, .paused, .done, .failed] {
            XCTAssertTrue(statuses.contains(status), status.rawValue)
        }

        let board = Board(runs: runs, now: now, mode: .byStatus)
        XCTAssertEqual(board.archiveCount, 1, "the run done 3 days ago")
        XCTAssertEqual(filterRuns(runs, query: "4312").map(\.source.ref), ["4312"])
        XCTAssertGreaterThanOrEqual(filterRuns(runs, query: "", project: "saugon__wololo").count, 1)

        let busy = try XCTUnwrap(runs.first { $0.status == .waitingAgents })
        XCTAssertEqual(busy.items.done, 4)
        XCTAssertEqual(busy.items.total, 7)
        XCTAssertEqual(liveAgents(busy).count, 2)
        XCTAssertLessThan(now - busy.owner.heartbeatAt, 60, "times are stamped relative to now")

        let files = try FileManager.default.contentsOfDirectory(atPath: fixture.runsURL.appendingPathComponent(busy.id).path)
        for name in ["events.1.jsonl", "events.jsonl", "spec.md", "plan.md", "context.md", "source.md", "screenshots"] {
            XCTAssertTrue(files.contains(name), name)
        }
        let png = try Data(contentsOf: fixture.runsURL.appendingPathComponent(busy.id).appendingPathComponent(busy.screenshots[0].file))
        XCTAssertEqual(Array(png.prefix(4)), [0x89, 0x50, 0x4E, 0x47])

        let runDir = fixture.runsURL.appendingPathComponent(busy.id)
        let events = EventReader.readAll(runDir: runDir)
        XCTAssertEqual(events.first?.type, "run.started")
        XCTAssertEqual(events.map(\.seq), Array(1...627), "rotated then current, the broken last line skipped")
        XCTAssertEqual(runDocuments(runDir: runDir).map(\.name), ["source.md", "context.md", "spec.md", "plan.md", "log.md"])
        let shot = try XCTUnwrap(screenshotURL(busy.screenshots[0], runDir: runDir))
        XCTAssertTrue(FileManager.default.fileExists(atPath: shot.path))
    }

    /// Scenarios 4 and 5 on the data the snapshots use: the board header's counters and the busy card's texts.
    func testBoardCountersAndCardTexts() throws {
        let fixture = try StoreFixture(createRuns: false)
        XCTAssertEqual(try runScript(into: fixture.root), 0)
        let store = RunStore(runsURL: fixture.runsURL)
        store.scan()
        let runs = store.runs
        let now = Date().timeIntervalSince1970

        let counters = boardCounters(runs, now: now)
        XCTAssertEqual(counters.working, 4)
        XCTAssertEqual(counters.waiting, 3)

        let busy = try XCTUnwrap(runs.first { $0.id == "web-4312-a4f9c2" })
        // Pinned 53 s after its last update, still well within its heartbeat.
        let later = busy.updatedAt + 53
        XCTAssertEqual(originLabel(busy), "acme/web #4312")
        XCTAssertEqual(effectiveStatus(busy, now: later).label(busy.lang), "Agentes trabajando")
        XCTAssertEqual(activityLine(busy, now: later, prefixed: false), "Implementando ítem 5: animación al soltar la tarjeta")
        XCTAssertEqual(RunProgress(busy, now: later).metaText, "5/8 Implementación")
        XCTAssertNil(prLabel(busy))
        XCTAssertEqual(agentsLabel(busy, now: later), "2 agentes")
        XCTAssertEqual(shortAgo(busy.updatedAt, now: later, lang: busy.lang), "53s")
    }

    func testRefusesToReplaceRunsItDidNotWrite() throws {
        let fixture = try StoreFixture()
        try fixture.write("real-run")

        XCTAssertEqual(try runScript(into: fixture.root), 1)

        let store = RunStore(runsURL: fixture.runsURL)
        store.scan()
        XCTAssertEqual(store.runs.map(\.id), ["real-run"])
        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.root.appendingPathComponent(".wololo-sample").path))
    }
}
