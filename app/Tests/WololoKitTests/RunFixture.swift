import Foundation
@testable import WololoKit

let fixtureNow: TimeInterval = 1_000_000

/// A run decoded from JSON, with a fresh heartbeat unless `fields` sets `owner`.
func makeRun(_ id: String, status: String = "running", updatedAt: TimeInterval = fixtureNow - 60, _ fields: [String: Any] = [:]) throws -> Run {
    var object: [String: Any] = [
        "id": id,
        "status": status,
        "updated_at": updatedAt,
        "owner": ["session_id": "s", "cwd": "/tmp", "heartbeat_at": fixtureNow - 5],
    ]
    object.merge(fields) { _, new in new }
    return try Run.decode(from: JSONSerialization.data(withJSONObject: object))
}
