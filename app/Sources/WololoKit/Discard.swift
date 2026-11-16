import Foundation

/// "Descartar": cancels a run no session holds anymore (paused or orphaned, with no heartbeat for `orphanAfterSeconds`),
/// so it leaves the board without opening a terminal to resume it first. It writes what the mod's own cancel writes:
/// a `run.finished {outcome: cancelled}` line at the end of `events.jsonl`, and the snapshot as that event leaves it.
/// A run a live session holds is never touched: that session would write it back.
public enum RunDiscard {
    public enum Failure: Error, Equatable {
        case notDiscardable
        case unreadable(String)
    }

    public static func canDiscard(_ run: Run, now: TimeInterval) -> Bool {
        !run.status.isTerminal && run.outcome == nil && now - run.owner.heartbeatAt > orphanAfterSeconds
    }

    /// Cancels the run in `runDir`, read again from disk so a session that took it back in the meantime wins.
    public static func discard(runDir: URL, now: TimeInterval = Date().timeIntervalSince1970,
                               summary: String = "Descartado desde Wololo Desk.") throws {
        let snapshotURL = runDir.appendingPathComponent("run.json")
        let eventsURL = runDir.appendingPathComponent("events.jsonl")
        guard let data = try? Data(contentsOf: snapshotURL),
              var object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        else { throw Failure.unreadable(snapshotURL.path) }
        let run = try Run.decode(from: data)
        guard canDiscard(run, now: now) else { throw Failure.notDiscardable }

        let id = object["id"] as? String ?? run.id
        let ts = (now * 1000).rounded() / 1000
        let seq = max(lastSeq(eventsURL), object["last_seq"] as? Int ?? 0) + 1
        let event: [String: Any] = [
            "v": 1, "seq": seq, "ts": ts, "run": id, "type": "run.finished",
            "data": ["outcome": "cancelled", "summary": summary],
        ]
        try append(JSONSerialization.data(withJSONObject: event, options: [.sortedKeys]), to: eventsURL)

        object["outcome"] = "cancelled"
        object["status"] = "cancelled"
        object["summary"] = summary
        object["finished_at"] = ts
        object["doing"] = NSNull()
        object["waiting"] = NSNull()
        object["last_seq"] = seq
        object["updated_at"] = ts
        if let stages = object["stages"] as? [[String: Any]] {
            object["stages"] = stages.map { stage in
                var stage = stage
                if stage["finished_at"] == nil || stage["finished_at"] is NSNull { stage["finished_at"] = ts }
                return stage
            }
        }
        let snapshot = try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys])
        // Like the mod: a staging file renamed into place, so a reader never sees half a snapshot.
        let staging = runDir.appendingPathComponent("run.json.desk-\(UUID().uuidString.prefix(6)).tmp")
        try snapshot.write(to: staging)
        guard rename(staging.path, snapshotURL.path) == 0 else {
            try? FileManager.default.removeItem(at: staging)
            throw Failure.unreadable(snapshotURL.path)
        }
    }

    private static func lastSeq(_ url: URL) -> Int {
        guard let text = try? String(contentsOf: url, encoding: .utf8) else { return 0 }
        for line in text.split(separator: "\n").reversed() {
            if let object = (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any],
               let seq = object["seq"] as? Int {
                return seq
            }
        }
        return 0
    }

    private static func append(_ line: Data, to url: URL) throws {
        if !FileManager.default.fileExists(atPath: url.path) {
            FileManager.default.createFile(atPath: url.path, contents: nil)
        }
        let handle = try FileHandle(forUpdating: url)
        defer { try? handle.close() }
        let end = try handle.seekToEnd()
        // A log whose last line has no newline yet still gets the event on a line of its own.
        var needsBreak = false
        if end > 0 {
            try handle.seek(toOffset: end - 1)
            needsBreak = try handle.read(upToCount: 1) != Data("\n".utf8)
            try handle.seekToEnd()
        }
        try handle.write(contentsOf: (needsBreak ? Data("\n".utf8) : Data()) + line + Data("\n".utf8))
    }
}
