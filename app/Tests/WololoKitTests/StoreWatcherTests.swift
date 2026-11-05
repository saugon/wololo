import XCTest
@testable import WololoKit

final class StoreWatcherTests: XCTestCase {
    func testSnapshotsAndEventLogsAreRelevant() {
        for path in [
            "/data/runs/web-87-abc/run.json",
            "/data/runs/web-87-abc/events.jsonl",
            "/data/runs/web-87-abc/events.1.jsonl",
            "/data/runs/web-87-abc/events.12.jsonl",
            "run.json",
        ] {
            XCTAssertTrue(StoreWatcher.isRelevant(path: path), path)
        }
    }

    func testStagingFilesAndEverythingElseAreNot() {
        for path in [
            "/data/runs/web-87-abc/run.json.k3j9a1.tmp",
            "/data/runs/web-87-abc/events.jsonl.q8w7e6.tmp",
            "/data/runs/web-87-abc/owner.json",
            "/data/runs/web-87-abc/spec.md",
            "/data/runs/web-87-abc/screenshots/01-board.png",
            "/data/runs/web-87-abc",
            "/data/runs",
            "/data/sessions/s1.json",
            "/data/runs/web-87-abc/run.json.bak",
            "/data/runs/web-87-abc/events.txt",
        ] {
            XCTAssertFalse(StoreWatcher.isRelevant(path: path), path)
        }
    }

    func testReportsARenamedSnapshotButNotItsStagingFile() throws {
        let fixture = try StoreFixture()
        try FileManager.default.createDirectory(at: fixture.runFile("r").deletingLastPathComponent(), withIntermediateDirectories: true)
        var seen: [String] = []
        let watcher = StoreWatcher(url: fixture.runsURL, debounce: 0.05) { seen += $0 }
        XCTAssertTrue(watcher.start())
        defer { watcher.stop() }

        try fixture.write("r")

        waitUntil("the watcher to report run.json") { seen.contains { $0.hasSuffix("/r/run.json") } }
        XCTAssertFalse(seen.contains { $0.hasSuffix(".tmp") }, "\(seen)")
    }
}
