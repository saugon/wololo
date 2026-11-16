import XCTest
@testable import WololoKit

/// "Descartar" cancels a run no session holds, as the mod's cancel would; a run a live session holds is left alone.
final class DiscardTests: XCTestCase {
    func testOnlyARunNoSessionHoldsCanBeDiscarded() throws {
        let stale: [String: Any] = ["owner": ["cwd": "/tmp", "heartbeat_at": fixtureNow - 120]]
        XCTAssertTrue(RunDiscard.canDiscard(try makeRun("r1", status: "paused", stale), now: fixtureNow))
        XCTAssertTrue(RunDiscard.canDiscard(try makeRun("r2", status: "running", stale), now: fixtureNow))
        XCTAssertFalse(RunDiscard.canDiscard(try makeRun("r3", status: "paused"), now: fixtureNow))
        XCTAssertFalse(RunDiscard.canDiscard(try makeRun("r4", status: "running"), now: fixtureNow))
        XCTAssertFalse(RunDiscard.canDiscard(try makeRun("r5", status: "done", stale), now: fixtureNow))
    }

    func testDiscardAppendsTheCancelAndWritesTheSnapshotItLeaves() throws {
        let store = try StoreFixture()
        let now = Date().timeIntervalSince1970
        try store.write("r1", status: "paused", heartbeat: now - 600, [
            "last_seq": 2,
            "stages": [["id": "context", "started_at": now - 900, "finished_at": NSNull()]],
        ])
        try store.append(#"{"v":1,"seq":1,"ts":1,"run":"r1","type":"run.started","data":{}}"# + "\n", toEventsOf: "r1")
        try store.append(#"{"v":1,"seq":2,"ts":2,"run":"r1","type":"paused","data":{"note":"x"}}"# + "\n", toEventsOf: "r1")
        let dir = store.runsURL.appendingPathComponent("r1")

        try RunDiscard.discard(runDir: dir, now: now)

        let lines = try String(contentsOf: dir.appendingPathComponent("events.jsonl"), encoding: .utf8).split(separator: "\n")
        XCTAssertEqual(lines.count, 3)
        let event = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(lines[2].utf8)) as? [String: Any])
        XCTAssertEqual(event["seq"] as? Int, 3)
        XCTAssertEqual(event["type"] as? String, "run.finished")
        XCTAssertEqual((event["data"] as? [String: Any])?["outcome"] as? String, "cancelled")

        let run = try Run.decode(from: Data(contentsOf: store.runFile("r1")))
        XCTAssertEqual(run.status, .cancelled)
        XCTAssertEqual(run.outcome, "cancelled")
        let snapshot = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: store.runFile("r1"))) as? [String: Any])
        XCTAssertEqual(snapshot["last_seq"] as? Int, 3)
        let stage = try XCTUnwrap((snapshot["stages"] as? [[String: Any]])?.first)
        XCTAssertNotNil(stage["finished_at"] as? Double)
        XCTAssertThrowsError(try RunDiscard.discard(runDir: dir, now: now))
    }

    func testARunASessionHoldsIsNotWritten() throws {
        let store = try StoreFixture()
        try store.write("r1", status: "paused")
        let dir = store.runsURL.appendingPathComponent("r1")
        let before = try Data(contentsOf: store.runFile("r1"))
        XCTAssertThrowsError(try RunDiscard.discard(runDir: dir)) { error in
            XCTAssertEqual(error as? RunDiscard.Failure, .notDiscardable)
        }
        XCTAssertEqual(try Data(contentsOf: store.runFile("r1")), before)
        XCTAssertFalse(FileManager.default.fileExists(atPath: dir.appendingPathComponent("events.jsonl").path))
    }
}
