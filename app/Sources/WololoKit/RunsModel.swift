import Foundation
import Observation

/// The live run list: FSEvents on `runs/`, a 2 s mtime poll for what FSEvents drops, and a 1 s tick so
/// `orphaned` and the "X ago" texts move on their own.
@MainActor
@Observable
public final class RunsModel {
    public private(set) var runs: [Run] = []
    public private(set) var now: TimeInterval
    public private(set) var state: StoreState = .ok
    /// Bumped when an `events*.jsonl` changes, so an open timeline knows to read on.
    public private(set) var eventsRevision = 0

    public let dataDirectory: DataDirectory

    @ObservationIgnored private let store: RunStore
    @ObservationIgnored private let titles: RunTitles?
    @ObservationIgnored private let clock: () -> TimeInterval
    @ObservationIgnored private let refreshInterval: TimeInterval?
    @ObservationIgnored private let tickInterval: TimeInterval?
    @ObservationIgnored private let watches: Bool
    // Unsafe so deinit, which is not on the main actor, can tear them down; every other access is on the main actor.
    @ObservationIgnored nonisolated(unsafe) private var watcher: StoreWatcher?
    @ObservationIgnored nonisolated(unsafe) private var timers: [Timer] = []
    @ObservationIgnored public private(set) var isStarted = false

    /// Pass nil intervals and `watch: false` to drive the model only through `reload()`, `refresh()` and `tick()`.
    public init(
        dataDirectory: DataDirectory,
        clock: @escaping () -> TimeInterval = { Date().timeIntervalSince1970 },
        refreshInterval: TimeInterval? = 2,
        tickInterval: TimeInterval? = 1,
        watch: Bool = true,
        titles: RunTitles? = nil
    ) {
        self.titles = titles
        self.dataDirectory = dataDirectory
        self.clock = clock
        self.refreshInterval = refreshInterval
        self.tickInterval = tickInterval
        self.watches = watch
        store = RunStore(runsURL: dataDirectory.runsURL)
        now = clock()
    }

    deinit {
        timers.forEach { $0.invalidate() }
        watcher?.stop()
    }

    public func start() {
        guard !isStarted else { return }
        isStarted = true
        reload()
        if let refreshInterval { timers.append(schedule(every: refreshInterval) { $0.refresh() }) }
        if let tickInterval { timers.append(schedule(every: tickInterval) { $0.tick() }) }
    }

    public func stop() {
        isStarted = false
        timers.forEach { $0.invalidate() }
        timers = []
        watcher?.stop()
        watcher = nil
    }

    /// Reads every `run.json` again.
    public func reload() {
        store.scan()
        publish()
    }

    /// Reads the `run.json` files that changed on disk.
    public func refresh() {
        store.refresh()
        publish()
    }

    /// Gives the run a title of the person's in the app; nil or blank goes back to its own.
    public func rename(_ id: String, to title: String?) {
        guard let titles, let run = runs.first(where: { $0.id == id }) else { return }
        titles.set(title, for: id, original: run.originalTitle)
        publish()
    }

    public func tick() {
        now = clock()
    }

    private func publish() {
        now = clock()
        if state != store.state { state = store.state }
        let custom = titles?.all ?? [:]
        let next = custom.isEmpty ? store.runs : store.runs.map { run in
            var run = run
            run.customTitle = custom[run.id]
            return run
        }
        if next != runs { runs = next }
        updateWatcher()
    }

    /// `runs/` may appear after launch, with the first run; FSEvents needs the directory to exist.
    private func updateWatcher() {
        guard watches, isStarted else { return }
        if state == .missingRunsDirectory {
            watcher?.stop()
            watcher = nil
        } else if watcher == nil {
            let watcher = StoreWatcher(url: store.runsURL) { [weak self] paths in
                MainActor.assumeIsolated { self?.changed(paths) }
            }
            if watcher.start() { self.watcher = watcher }
        }
    }

    /// Anything but a snapshot may be an event log: a rescan batch from FSEvents names only the directory.
    func changed(_ paths: [String]) {
        if paths.contains(where: { ($0 as NSString).lastPathComponent != "run.json" }) {
            eventsRevision += 1
        }
        refresh()
    }

    private func schedule(every interval: TimeInterval, _ action: @escaping (RunsModel) -> Void) -> Timer {
        let timer = Timer(timeInterval: interval, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                action(self)
            }
        }
        timer.tolerance = interval / 10
        RunLoop.main.add(timer, forMode: .common)
        return timer
    }
}
