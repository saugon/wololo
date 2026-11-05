import XCTest
@testable import WololoKit

final class RunStoreTests: XCTestCase {
    func testScanReadsEveryRunAndSkipsStagingFiles() throws {
        let fixture = try StoreFixture()
        try fixture.write("b")
        try fixture.write("a", status: "waiting_user")
        let staging = fixture.runsURL.appendingPathComponent("a/run.json.x1y2z3.tmp")
        try Data("{\"id\": \"a\", \"status\": \"do".utf8).write(to: staging)
        try FileManager.default.createDirectory(at: fixture.runsURL.appendingPathComponent("only-staging"), withIntermediateDirectories: true)
        try Data("{}".utf8).write(to: fixture.runsURL.appendingPathComponent("only-staging/run.json.abc.tmp"))

        let store = RunStore(runsURL: fixture.runsURL)
        store.scan()

        XCTAssertEqual(store.state, .ok)
        XCTAssertEqual(store.runs.map(\.id), ["a", "b"])
        XCTAssertEqual(store.runs[0].status, .waitingUser)
    }

    func testTruncatedRewriteKeepsTheLastGoodSnapshot() throws {
        let fixture = try StoreFixture()
        try fixture.write("r", status: "running", ["doing": ["text": "Ítem 2", "since": 1]])
        let store = RunStore(runsURL: fixture.runsURL)
        store.scan()
        XCTAssertEqual(store.runs.first?.status, .running)

        try fixture.writeRaw("r", #"{"id": "r", "status": "waiting_ag"#)
        store.refresh()
        XCTAssertEqual(store.runs.map(\.id), ["r"])
        XCTAssertEqual(store.runs.first?.status, .running)
        XCTAssertEqual(store.runs.first?.doing?.text, "Ítem 2")

        store.scan()
        XCTAssertEqual(store.runs.first?.status, .running, "a full scan keeps it too")

        try fixture.write("r", status: "done")
        store.refresh()
        XCTAssertEqual(store.runs.first?.status, .done)
    }

    func testRunThatNeverDecodedIsAbsent() throws {
        let fixture = try StoreFixture()
        try fixture.write("good")
        try fixture.writeRaw("broken", #"{"id": "broken", "sta"#)
        try fixture.writeRaw("no-id", #"{"status": "running"}"#)

        let store = RunStore(runsURL: fixture.runsURL)
        store.scan()

        XCTAssertEqual(store.runs.map(\.id), ["good"])
    }

    func testMissingRunsDirectoryIsAStateNotAnError() throws {
        let fixture = try StoreFixture(createRuns: false)
        let store = RunStore(runsURL: fixture.runsURL)
        store.scan()
        XCTAssertEqual(store.state, .missingRunsDirectory)
        XCTAssertEqual(store.runs, [])

        try fixture.write("first")
        store.refresh()
        XCTAssertEqual(store.state, .ok)
        XCTAssertEqual(store.runs.map(\.id), ["first"])

        try FileManager.default.removeItem(at: fixture.runsURL)
        store.refresh()
        XCTAssertEqual(store.state, .missingRunsDirectory)
        XCTAssertEqual(store.runs, [])
    }

    func testRunsWhoseDirectoryOrFileDisappearAreRemoved() throws {
        let fixture = try StoreFixture()
        try fixture.write("a")
        try fixture.write("b")
        try fixture.write("c")
        let store = RunStore(runsURL: fixture.runsURL)
        store.scan()
        XCTAssertEqual(store.runs.map(\.id), ["a", "b", "c"])

        try FileManager.default.removeItem(at: fixture.runsURL.appendingPathComponent("a"))
        try FileManager.default.removeItem(at: fixture.runFile("c"))
        store.refresh()

        XCTAssertEqual(store.runs.map(\.id), ["b"])
    }

    /// Same size and the old mtime, but a new inode: a rename into place is still noticed.
    func testReplacedFileWithTheSameSizeAndMtimeIsReread() throws {
        let fixture = try StoreFixture()
        try fixture.write("r", status: "running", heartbeat: 1_000)
        let store = RunStore(runsURL: fixture.runsURL)
        store.scan()
        var old = stat()
        XCTAssertEqual(stat(fixture.runFile("r").path, &old), 0)

        try fixture.write("r", status: "blocked", heartbeat: 1_000)
        var times = [old.st_atimespec, old.st_mtimespec]
        XCTAssertEqual(utimensat(AT_FDCWD, fixture.runFile("r").path, &times, 0), 0)
        var new = stat()
        XCTAssertEqual(stat(fixture.runFile("r").path, &new), 0)
        XCTAssertEqual(new.st_size, old.st_size)
        XCTAssertEqual(new.st_mtimespec.tv_sec, old.st_mtimespec.tv_sec)
        XCTAssertEqual(new.st_mtimespec.tv_nsec, old.st_mtimespec.tv_nsec)
        XCTAssertNotEqual(new.st_ino, old.st_ino)

        store.refresh()
        XCTAssertEqual(store.runs.first?.status, .blocked)
    }

    func testUnreadableRunsDirectoryKeepsTheRunsItHad() throws {
        let fixture = try StoreFixture()
        try fixture.write("a")
        let store = RunStore(runsURL: fixture.runsURL)
        store.scan()

        XCTAssertEqual(chmod(fixture.runsURL.path, 0), 0)
        defer { chmod(fixture.runsURL.path, 0o755) }
        guard (try? FileManager.default.contentsOfDirectory(atPath: fixture.runsURL.path)) == nil else {
            throw XCTSkip("permissions do not apply here (running as root?)")
        }
        store.refresh()

        XCTAssertEqual(store.state, .ok)
        XCTAssertEqual(store.runs.map(\.id), ["a"])
    }

    func testRefreshOnlyRereadsFilesThatChanged() throws {
        let fixture = try StoreFixture()
        try fixture.write("a")
        try fixture.write("b")
        try fixture.write("c")
        let store = RunStore(runsURL: fixture.runsURL)

        store.scan()
        XCTAssertEqual(store.reads, 3)
        store.refresh()
        XCTAssertEqual(store.reads, 3, "nothing changed")

        try fixture.write("b", status: "waiting_ci")
        store.refresh()
        XCTAssertEqual(store.reads, 4, "only b")
        XCTAssertEqual(store.runs.first { $0.id == "b" }?.status, .waitingCI)

        try fixture.writeRaw("c", "{")
        store.refresh()
        store.refresh()
        XCTAssertEqual(store.reads, 5, "a broken file is read once, not on every refresh")

        store.scan()
        XCTAssertEqual(store.reads, 8, "scan reads them all")
    }
}
