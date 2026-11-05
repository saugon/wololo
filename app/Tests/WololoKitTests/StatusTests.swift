import XCTest
@testable import WololoKit

final class StatusTests: XCTestCase {
    private func run(_ status: String, heartbeatAt: TimeInterval) throws -> Run {
        let json = #"{ "id": "r", "status": "\#(status)", "owner": { "heartbeat_at": \#(heartbeatAt) } }"#
        return try Run.decode(from: Data(json.utf8))
    }

    func testDecodesEveryKnownStatus() {
        let raw = [
            "running", "waiting_user", "waiting_permission", "waiting_agents", "waiting_ci", "waiting_tests",
            "blocked", "stalled", "pausing", "paused", "orphaned", "done", "failed", "cancelled",
        ]
        XCTAssertEqual(RunStatus.known.map(\.rawValue), raw)
        for value in raw {
            XCTAssertEqual(RunStatus(rawValue: value).rawValue, value)
            XCTAssertNotEqual(RunStatus(rawValue: value), .unknown(value))
        }
        XCTAssertEqual(RunStatus(rawValue: "something_new"), .unknown("something_new"))
    }

    func testRunningWithAnOldHeartbeatIsOrphaned() throws {
        let now: TimeInterval = 10_000
        XCTAssertEqual(effectiveStatus(try run("running", heartbeatAt: now - 120), now: now), .orphaned)
        XCTAssertEqual(effectiveStatus(try run("running", heartbeatAt: now - 30), now: now), .running)
        XCTAssertEqual(effectiveStatus(try run("running", heartbeatAt: now - 90), now: now), .running)
        XCTAssertEqual(effectiveStatus(try run("waiting_user", heartbeatAt: now - 300), now: now), .orphaned)
        XCTAssertEqual(effectiveStatus(try run("something_new", heartbeatAt: now - 300), now: now), .orphaned)
    }

    func testPausedAndTerminalKeepTheirStatus() throws {
        let now: TimeInterval = 10_000
        XCTAssertEqual(effectiveStatus(try run("paused", heartbeatAt: 0), now: now), .paused)
        XCTAssertEqual(effectiveStatus(try run("done", heartbeatAt: 0), now: now), .done)
        XCTAssertEqual(effectiveStatus(try run("failed", heartbeatAt: 0), now: now), .failed)
        XCTAssertEqual(effectiveStatus(try run("cancelled", heartbeatAt: 0), now: now), .cancelled)
        XCTAssertEqual(effectiveStatus(try run("pausing", heartbeatAt: 0), now: now), .orphaned)
    }

    func testTerminalStatuses() {
        let terminal = RunStatus.known.filter(\.isTerminal)
        XCTAssertEqual(terminal, [.done, .failed, .cancelled])
        XCTAssertFalse(RunStatus.unknown("x").isTerminal)
    }

    func testWaitingOnPerson() {
        let waiting = RunStatus.known.filter(\.isWaitingOnPerson)
        XCTAssertEqual(waiting, [.waitingUser, .waitingPermission, .blocked, .stalled])
        XCTAssertFalse(RunStatus.orphaned.isWaitingOnPerson)
        XCTAssertFalse(RunStatus.unknown("x").isWaitingOnPerson)
    }

    func testWaitingUserRunWaitsOnThePerson() throws {
        let now: TimeInterval = 10_000
        let status = effectiveStatus(try run("waiting_user", heartbeatAt: now - 5), now: now)
        XCTAssertEqual(status, .waitingUser)
        XCTAssertTrue(status.isWaitingOnPerson)
    }
}
