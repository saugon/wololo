import Foundation

/// A JSON value as it came in an event's `data`, kept loose: each event type has its own fields.
public enum JSONValue: Equatable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public subscript(key: String) -> JSONValue? {
        if case .object(let fields) = self { return fields[key] }
        return nil
    }

    public var string: String? {
        if case .string(let value) = self { return value }
        return nil
    }

    public var number: Double? {
        if case .number(let value) = self { return value }
        return nil
    }

    public var int: Int? {
        guard let value = number, value.isFinite, value.rounded() == value, abs(value) < 9e15 else { return nil }
        return Int(value)
    }

    public var bool: Bool? {
        if case .bool(let value) = self { return value }
        return nil
    }

    public var array: [JSONValue]? {
        if case .array(let values) = self { return values }
        return nil
    }

    /// The value as the mod's `str()` prints it: empty for null, numbers without a trailing `.0`.
    public var text: String {
        switch self {
        case .null: return ""
        case .bool(let value): return value ? "true" : "false"
        case .number(let value): return int.map(String.init) ?? String(value)
        case .string(let value): return value
        case .array(let values): return values.map(\.text).joined(separator: ",")
        case .object: return "[object Object]"
        }
    }
}

extension JSONValue: Decodable {
    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() {
            self = .null
        } else if let value = try? c.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? c.decode(Double.self) {
            self = .number(value)
        } else if let value = try? c.decode(String.self) {
            self = .string(value)
        } else if let value = try? c.decode([JSONValue].self) {
            self = .array(value)
        } else {
            self = .object(try c.decode([String: JSONValue].self))
        }
    }
}

/// One line of a run's `events*.jsonl`.
public struct RunEvent: Equatable, Sendable {
    public var seq: Int
    public var ts: TimeInterval
    public var type: String
    public var data: [String: JSONValue]

    public init(seq: Int, ts: TimeInterval, type: String, data: [String: JSONValue] = [:]) {
        self.seq = seq
        self.ts = ts
        self.type = type
        self.data = data
    }

    /// `data[key]` as the mod's `str()`: empty when missing.
    public func text(_ key: String) -> String {
        data[key]?.text ?? ""
    }
}

extension RunEvent: Decodable {
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        // Without a seq there is no place for the event in the timeline.
        let rawSeq = try c.decode(Double.self, forKey: "seq")
        guard rawSeq.isFinite, abs(rawSeq) < 9e15 else {
            throw DecodingError.dataCorruptedError(forKey: "seq", in: c, debugDescription: "seq out of range")
        }
        seq = Int(rawSeq)
        type = try c.decode(String.self, forKey: "type")
        ts = c.value("ts", or: 0)
        let raw: JSONValue? = c.optional("data")
        if case .object(let fields)? = raw {
            data = fields
        } else {
            data = [:]
        }
    }
}

public enum EventReader {
    /// `events.N.jsonl` in numeric order: what the mod's `rotateIfLarge` moved aside, oldest first.
    public static func rotatedFiles(runDir: URL) -> [URL] {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: runDir.path)) ?? []
        return names
            .compactMap { name -> (Int, String)? in rotationNumber(name).map { ($0, name) } }
            .sorted { $0.0 < $1.0 }
            .map { runDir.appendingPathComponent($0.1) }
    }

    /// Every event of a run, as the mod's `readEvents`: rotated files then `events.jsonl`, stably sorted by `seq`.
    /// A line that does not parse, such as the last one caught halfway through a write, is skipped. Events that
    /// share a seq are all kept: the mod numbers them `last_seq + 1`, and hooks running at once can collide.
    public static func readAll(runDir: URL) -> [RunEvent] {
        snapshot(runDir: runDir).events
    }

    public static func parse(_ data: Data) -> [RunEvent] {
        let decoder = JSONDecoder()
        var events: [RunEvent] = []
        for line in data.split(separator: UInt8(ascii: "\n"), omittingEmptySubsequences: true) {
            if let event = try? decoder.decode(RunEvent.self, from: Data(line)) {
                events.append(event)
            }
        }
        return events
    }

    /// Sorted by `seq`, keeping file order among events that share one.
    static func ordered(_ events: [RunEvent]) -> [RunEvent] {
        events.enumerated()
            .sorted { $0.element.seq != $1.element.seq ? $0.element.seq < $1.element.seq : $0.offset < $1.offset }
            .map(\.element)
    }

    struct Snapshot {
        var events: [RunEvent] = []
        /// The inode of the `events.jsonl` that was read, nil when there was none.
        var inode: UInt64?
        /// Bytes of it up to the end of its last full line.
        var offset: UInt64 = 0
    }

    /// `events.jsonl` is opened before the rotated files are listed: if the mod rotates it in between, the open
    /// file is then one of the rotated ones, and is skipped there by its inode instead of being missed.
    static func snapshot(runDir: URL) -> Snapshot {
        var snapshot = Snapshot()
        var current: [RunEvent] = []
        if let handle = try? FileHandle(forReadingFrom: runDir.appendingPathComponent("events.jsonl")) {
            defer { try? handle.close() }
            if let info = fileInfo(handle), let data = try? handle.readToEnd() {
                let lines = completeLines(data)
                snapshot.inode = info.inode
                snapshot.offset = UInt64(lines.count)
                current = parse(lines)
            }
        }
        let rotated = rotatedFiles(runDir: runDir).flatMap { file -> [RunEvent] in
            if let inode = snapshot.inode, inodeOf(file) == inode { return [] }
            return (try? Data(contentsOf: file)).map(parse) ?? []
        }
        snapshot.events = ordered(rotated + current)
        return snapshot
    }

    /// The bytes up to and including the last newline.
    static func completeLines(_ data: Data) -> Data {
        guard let end = data.lastIndex(of: UInt8(ascii: "\n")) else { return Data() }
        return data[data.startIndex...end]
    }

    static func fileInfo(_ handle: FileHandle) -> (inode: UInt64, size: UInt64)? {
        var info = Darwin.stat()
        guard fstat(handle.fileDescriptor, &info) == 0 else { return nil }
        return (UInt64(info.st_ino), UInt64(max(0, info.st_size)))
    }

    private static func inodeOf(_ file: URL) -> UInt64? {
        var info = Darwin.stat()
        guard stat(file.path, &info) == 0 else { return nil }
        return UInt64(info.st_ino)
    }

    private static func rotationNumber(_ name: String) -> Int? {
        guard name.hasPrefix("events."), name.hasSuffix(".jsonl") else { return nil }
        let middle = name.dropFirst("events.".count).dropLast(".jsonl".count)
        guard !middle.isEmpty, middle.allSatisfy(\.isASCII), middle.allSatisfy(\.isNumber) else { return nil }
        return Int(middle)
    }
}

/// Follows a run's events: the first `poll()` reads everything, later ones read only what was appended to
/// `events.jsonl`. When the mod rotates the file (another inode) or it shrinks, it reads everything again.
/// Not thread-safe: use it from one queue.
public final class EventTail {
    public enum Update: Equatable, Sendable {
        case unchanged
        /// Events added after the ones already in `events`.
        case appended([RunEvent])
        /// `events` changed other than at its end: read from scratch, or an appended event sorted before the last
        /// one. Draw it again from `events`.
        case reset
    }

    public let runDir: URL
    /// Every event read so far, stably sorted by `seq`.
    public private(set) var events: [RunEvent] = []

    private var started = false
    private var inode: UInt64?
    /// Bytes of `events.jsonl` consumed, always up to the end of a full line. A trailing line without its
    /// newline stays past the offset, so the next poll reads it again once the writer finishes it.
    private var offset: UInt64 = 0

    private var currentFile: URL { runDir.appendingPathComponent("events.jsonl") }

    public init(runDir: URL) {
        self.runDir = runDir
    }

    @discardableResult
    public func poll() -> Update {
        guard started else {
            reset()
            return .reset
        }
        guard let handle = try? FileHandle(forReadingFrom: currentFile) else {
            // Gone between a rotation and the next append: the rotated file has the lines it had.
            if inode == nil { return .unchanged }
            reset()
            return .reset
        }
        defer { try? handle.close() }
        guard let info = EventReader.fileInfo(handle), info.inode == inode, info.size >= offset else {
            reset()
            return .reset
        }
        guard info.size > offset else { return .unchanged }
        guard (try? handle.seek(toOffset: offset)) != nil, let data = try? handle.readToEnd() else { return .unchanged }
        let lines = EventReader.completeLines(data)
        offset += UInt64(lines.count)
        let added = EventReader.parse(lines)
        guard !added.isEmpty else { return .unchanged }
        let seqs = [events.last?.seq].compactMap { $0 } + added.map(\.seq)
        let inOrder = zip(seqs, seqs.dropFirst()).allSatisfy { $0 <= $1 }
        events = inOrder ? events + added : EventReader.ordered(events + added)
        return inOrder ? .appended(added) : .reset
    }

    private func reset() {
        started = true
        let snapshot = EventReader.snapshot(runDir: runDir)
        events = snapshot.events
        inode = snapshot.inode
        offset = snapshot.offset
    }
}
