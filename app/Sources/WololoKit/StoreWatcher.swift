import CoreServices
import Foundation

/// Watches a directory tree with FSEvents and reports, batched, the changed paths that matter to the store.
public final class StoreWatcher {
    public let url: URL
    private let debounce: TimeInterval
    private let queue: DispatchQueue
    private let onChange: ([String]) -> Void
    private var stream: FSEventStreamRef?
    private var pending: [String] = []
    private var flush: DispatchWorkItem?

    /// `onChange` runs on `queue` with the relevant paths seen since the last call.
    public init(url: URL, debounce: TimeInterval = 0.2, queue: DispatchQueue = .main, onChange: @escaping ([String]) -> Void) {
        self.url = url
        self.debounce = debounce
        self.queue = queue
        self.onChange = onChange
    }

    deinit {
        stop()
    }

    public var isRunning: Bool { stream != nil }

    /// Only snapshots and event logs: the mod's `*.tmp` staging files are renamed into place a moment later.
    public static func isRelevant(path: String) -> Bool {
        let name = (path as NSString).lastPathComponent
        if name.hasSuffix(".tmp") { return false }
        if name == "run.json" { return true }
        return name.hasPrefix("events") && name.hasSuffix(".jsonl")
    }

    @discardableResult
    public func start() -> Bool {
        if stream != nil { return true }
        var context = FSEventStreamContext(
            version: 0,
            info: Unmanaged.passUnretained(self).toOpaque(),
            retain: nil,
            release: nil,
            copyDescription: nil
        )
        let flags = FSEventStreamCreateFlags(
            kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagUseCFTypes | kFSEventStreamCreateFlagNoDefer
        )
        guard let stream = FSEventStreamCreate(
            kCFAllocatorDefault,
            StoreWatcher.callback,
            &context,
            [url.path] as CFArray,
            FSEventStreamEventId(kFSEventStreamEventIdSinceNow),
            0.05,
            flags
        ) else { return false }
        FSEventStreamSetDispatchQueue(stream, queue)
        guard FSEventStreamStart(stream) else {
            FSEventStreamInvalidate(stream)
            FSEventStreamRelease(stream)
            return false
        }
        self.stream = stream
        return true
    }

    public func stop() {
        flush?.cancel()
        flush = nil
        pending = []
        guard let stream else { return }
        FSEventStreamStop(stream)
        FSEventStreamInvalidate(stream)
        FSEventStreamRelease(stream)
        self.stream = nil
    }

    private static let callback: FSEventStreamCallback = { _, info, count, paths, flags, _ in
        guard let info else { return }
        let watcher = Unmanaged<StoreWatcher>.fromOpaque(info).takeUnretainedValue()
        let list = Unmanaged<CFArray>.fromOpaque(paths).takeUnretainedValue() as? [String] ?? []
        let rescan = FSEventStreamEventFlags(kFSEventStreamEventFlagMustScanSubDirs | kFSEventStreamEventFlagRootChanged)
        var relevant: [String] = []
        for index in 0..<min(count, list.count) {
            // A dropped or coalesced batch names a directory, not the files in it.
            if flags[index] & rescan != 0 || isRelevant(path: list[index]) {
                relevant.append(list[index])
            }
        }
        watcher.receive(relevant)
    }

    /// Runs on `queue`, where FSEvents delivers. The first change of a burst sets the deadline, so a run that
    /// keeps writing still gets reported every `debounce` seconds.
    private func receive(_ paths: [String]) {
        guard !paths.isEmpty, stream != nil else { return }
        pending.append(contentsOf: paths)
        guard flush == nil else { return }
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.flush = nil
            let paths = self.pending
            self.pending = []
            if !paths.isEmpty { self.onChange(paths) }
        }
        flush = work
        queue.asyncAfter(deadline: .now() + debounce, execute: work)
    }
}
