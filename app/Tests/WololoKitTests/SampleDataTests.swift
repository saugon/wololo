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
