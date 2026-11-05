import Foundation

public enum StoreState: Equatable, Sendable {
    case ok
    /// `<data>/runs` does not exist yet: no run has been started with this data directory.
    case missingRunsDirectory
}

/// The runs under `<data>/runs/*/run.json`. Not thread-safe: use it from one queue.
public final class RunStore {
    public let runsURL: URL
    public private(set) var state: StoreState = .ok
    /// How many `run.json` files have been read, to check that `refresh()` skips the unchanged ones.
    public private(set) var reads = 0

    private struct Entry {
        var signature: FileSignature
        /// The last snapshot that decoded, kept while the file on disk does not.
        var run: Run?
    }

    private var entries: [String: Entry] = [:]

    public init(runsURL: URL) {
        self.runsURL = runsURL
    }

    /// Every run that has decoded at least once, sorted by the name of its directory under `runs/`.
    public var runs: [Run] {
        entries.keys.sorted().compactMap { entries[$0]?.run }
    }

    /// Reads every `run.json` again.
    public func scan() {
        update(force: true)
    }

    /// Reads only the `run.json` files whose modification time, size or inode changed since they were last read.
    public func refresh() {
        update(force: false)
    }

    private func update(force: Bool) {
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: runsURL.path, isDirectory: &isDirectory), isDirectory.boolValue else {
            state = .missingRunsDirectory
            entries = [:]
            return
        }
        state = .ok

        // An unreadable listing says nothing about which runs exist: keep what we have until it reads again.
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: runsURL.path) else { return }
        var next: [String: Entry] = [:]
        for name in names where !name.hasPrefix(".") && !name.hasSuffix(".tmp") {
            let file = runsURL.appendingPathComponent(name).appendingPathComponent("run.json")
            guard let signature = FileSignature(path: file.path) else { continue }
            let previous = entries[name]
            if !force, let previous, previous.signature == signature {
                next[name] = previous
                continue
            }
            next[name] = Entry(signature: signature, run: read(file) ?? previous?.run)
        }
        entries = next
    }

    private func read(_ file: URL) -> Run? {
        reads += 1
        guard let data = try? Data(contentsOf: file) else { return nil }
        return try? Run.decode(from: data)
    }
}

/// Enough of `stat` to tell that a file was replaced or rewritten: the mod renames a new file into place.
struct FileSignature: Equatable {
    let seconds: Int
    let nanoseconds: Int
    let size: Int64
    let inode: UInt64

    init?(path: String) {
        var info = stat()
        guard stat(path, &info) == 0, info.st_mode & S_IFMT == S_IFREG else { return nil }
        seconds = Int(info.st_mtimespec.tv_sec)
        nanoseconds = Int(info.st_mtimespec.tv_nsec)
        size = Int64(info.st_size)
        inode = UInt64(info.st_ino)
    }
}
