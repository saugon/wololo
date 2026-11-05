import Foundation
import XCTest

/// A throwaway data directory, removed when the test ends.
final class StoreFixture {
    let root: URL
    var runsURL: URL { root.appendingPathComponent("runs") }

    init(createRuns: Bool = true) throws {
        root = FileManager.default.temporaryDirectory
            .appendingPathComponent("wololo-desk-tests")
            .appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: createRuns ? runsURL : root, withIntermediateDirectories: true)
    }

    deinit {
        try? FileManager.default.removeItem(at: root)
    }

    func runFile(_ id: String) -> URL {
        runsURL.appendingPathComponent(id).appendingPathComponent("run.json")
    }

    /// Writes like the mod: a `*.tmp` staging file renamed into place.
    func write(_ id: String, status: String = "running", heartbeat: TimeInterval = Date().timeIntervalSince1970,
               _ fields: [String: Any] = [:]) throws {
        var object: [String: Any] = [
            "id": id,
            "status": status,
            "updated_at": heartbeat,
            "owner": ["session_id": "s", "cwd": "/tmp", "heartbeat_at": heartbeat],
        ]
        object.merge(fields) { _, new in new }
        try writeAtomically(JSONSerialization.data(withJSONObject: object), to: runFile(id))
    }

    /// Writes bytes straight into `run.json`, as a reader would see a write caught halfway.
    func writeRaw(_ id: String, _ text: String) throws {
        let file = runFile(id)
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(text.utf8).write(to: file)
    }

    func writeAtomically(_ data: Data, to file: URL) throws {
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        let staging = file.deletingLastPathComponent().appendingPathComponent("\(file.lastPathComponent).\(UUID().uuidString.prefix(6)).tmp")
        try data.write(to: staging)
        guard rename(staging.path, file.path) == 0 else {
            throw CocoaError(.fileWriteUnknown)
        }
    }

    func append(_ text: String, toEventsOf id: String) throws {
        let file = runsURL.appendingPathComponent(id).appendingPathComponent("events.jsonl")
        if !FileManager.default.fileExists(atPath: file.path) {
            FileManager.default.createFile(atPath: file.path, contents: nil)
        }
        let handle = try FileHandle(forWritingTo: file)
        defer { try? handle.close() }
        try handle.seekToEnd()
        try handle.write(contentsOf: Data(text.utf8))
    }
}

/// Spins the main run loop until `condition` holds, or fails after `timeout`.
func waitUntil(_ description: String, timeout: TimeInterval = 3, file: StaticString = #filePath, line: UInt = #line,
               _ condition: () -> Bool) {
    let deadline = Date().addingTimeInterval(timeout)
    while !condition() {
        if Date() > deadline {
            XCTFail("Timed out after \(timeout) s waiting for \(description)", file: file, line: line)
            return
        }
        RunLoop.main.run(until: Date().addingTimeInterval(0.02))
    }
}
