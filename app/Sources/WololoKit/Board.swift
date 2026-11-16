import Foundation

public let finishedWindowSeconds: TimeInterval = 24 * 3600

public enum StatusGroup: String, CaseIterable, Sendable {
    case waiting
    case working
    case onHold
    case finished

    public init(_ status: RunStatus) {
        switch status {
        case .waitingUser, .waitingPermission, .blocked, .stalled: self = .waiting
        case .running, .waitingAgents, .waitingTests, .waitingCI, .pausing, .unknown: self = .working
        case .paused, .orphaned: self = .onHold
        case .done, .failed, .cancelled: self = .finished
        }
    }

    public init(_ run: Run, now: TimeInterval) {
        self.init(effectiveStatus(run, now: now))
    }

    public func label(_ lang: Lang) -> String {
        switch (self, lang) {
        case (.waiting, .es): return "Te espera"
        case (.waiting, .en): return "Waiting for you"
        case (.working, .es): return "Trabajando"
        case (.working, .en): return "Working"
        case (.onHold, .es): return "En pausa / huérfano"
        case (.onHold, .en): return "Paused / orphaned"
        case (.finished, .es): return "Terminado"
        case (.finished, .en): return "Finished"
        }
    }
}

public enum BoardMode: String, Sendable {
    case byStatus
    case byStage
}

public struct BoardColumn: Equatable, Sendable {
    public let id: String
    public let runs: [Run]
    private let es: String
    private let en: String

    public var count: Int { runs.count }

    public func label(_ lang: Lang) -> String {
        lang == .es ? es : en
    }

    init(id: String, es: String, en: String, runs: [Run]) {
        self.id = id
        self.es = es
        self.en = en
        self.runs = runs
    }
}

public struct Board: Equatable, Sendable {
    public let columns: [BoardColumn]
    /// Finished runs older than the finished window, and cancelled ones at once, newest first. Kept in both modes.
    public let archive: [Run]

    public var archiveCount: Int { archive.count }

    public init(runs: [Run], now: TimeInterval, mode: BoardMode) {
        let finished = runs.filter { StatusGroup($0, now: now) == .finished }
        // A cancelled run, discarded from here or from its session, is not worth watching for a day: it goes straight to the archive.
        let recent = finished.filter {
            effectiveStatus($0, now: now) != .cancelled && now - finishedTime($0) <= finishedWindowSeconds
        }
        let recentIDs = Set(recent.map(\.id))
        archive = byFinish(finished.filter { !recentIDs.contains($0.id) })

        switch mode {
        case .byStatus:
            columns = StatusGroup.allCases.map { group in
                let members = group == .finished ? recent : runs.filter { StatusGroup($0, now: now) == group }
                return BoardColumn(id: group.rawValue, es: group.label(.es), en: group.label(.en), runs: ordered(members, in: group, now: now))
            }
        case .byStage:
            let active = runs.filter { StatusGroup($0, now: now) != .finished }
            columns = Stage.all.enumerated().map { index, stage in
                let members = active.filter { stageIndex($0) == index }
                return BoardColumn(id: stage.id, es: stage.label(.es), en: stage.label(.en), runs: byStart(members))
            }
        }
    }
}

public func isActive(_ run: Run, now: TimeInterval) -> Bool {
    StatusGroup(run, now: now) != .finished
}

public func isWaitingOnPerson(_ run: Run, now: TimeInterval) -> Bool {
    effectiveStatus(run, now: now).isWaitingOnPerson
}

/// Active runs for the widget: the ones waiting on the person first, the longest waiting first, then the others in
/// the order they started.
public func widgetRuns(_ runs: [Run], now: TimeInterval) -> [Run] {
    let active = runs.filter { isActive($0, now: now) }
    return byWait(active.filter { isWaitingOnPerson($0, now: now) }) + byStart(active.filter { !isWaitingOnPerson($0, now: now) })
}

public func lastFinished(_ runs: [Run], now: TimeInterval) -> Run? {
    runs.filter { !isActive($0, now: now) }.max { finishedTime($0) < finishedTime($1) }
}

/// The board header's counters: active runs in the working group, and the runs waiting on the person (the same
/// rule as the menu bar's count).
public func boardCounters(_ runs: [Run], now: TimeInterval) -> (working: Int, waiting: Int) {
    (working: runs.filter { StatusGroup($0, now: now) == .working }.count,
     waiting: menuBarCount(runs, now: now))
}

public func menuBarCount(_ runs: [Run], now: TimeInterval) -> Int {
    runs.filter { isWaitingOnPerson($0, now: now) }.count
}

/// The header of the menu bar menu, "3 te esperan · 9 activos". Active runs include the ones waiting on the person.
public func menuBarHeader(_ runs: [Run], now: TimeInterval) -> String {
    let active = runs.filter { isActive($0, now: now) }.count
    return "\(waitingLabel(menuBarCount(runs, now: now))) · \(activeLabel(active))"
}

/// "1 te espera", "3 te esperan": the menu header and the widget's pill.
public func waitingLabel(_ count: Int) -> String {
    "\(count) \(count == 1 ? "te espera" : "te esperan")"
}

/// "1 activo", "9 activos": the menu header and the widget's footer.
public func activeLabel(_ count: Int) -> String {
    "\(count) \(count == 1 ? "activo" : "activos")"
}

public struct ProjectSummary: Equatable, Sendable {
    public let key: String
    public let display: String
    public let active: Int
    public let waiting: Int

    public var hasWaiting: Bool { waiting > 0 }
}

/// Every project with a run in the store, sorted by key so the sidebar does not reshuffle as runs update.
public func projectSummaries(_ runs: [Run], now: TimeInterval) -> [ProjectSummary] {
    Dictionary(grouping: runs, by: \.project.key)
        .map { key, members in
            ProjectSummary(
                key: key,
                display: members[0].project.display,
                active: members.filter { isActive($0, now: now) }.count,
                waiting: members.filter { isWaitingOnPerson($0, now: now) }.count
            )
        }
        .sorted { $0.key < $1.key }
}

extension Run.Project {
    public var display: String {
        if key.isEmpty { return (path as NSString).lastPathComponent }
        guard let range = key.range(of: "__") else { return key }
        return key.replacingCharacters(in: range, with: "/")
    }
}

func stageIndex(_ run: Run) -> Int {
    guard let stage = run.stage else { return 0 }
    let index = Stage.index(of: stage.id) ?? stage.index
    return min(max(index, 0), Stage.all.count - 1)
}

func finishedTime(_ run: Run) -> TimeInterval {
    run.finishedAt ?? run.updatedAt
}

// Each column orders its cards by a time that does not change while a card stays in it, so a card moves only when it
// changes column. updated_at, which every event of a run bumps, would reshuffle a column of busy runs every few seconds.
func ordered(_ runs: [Run], in group: StatusGroup, now: TimeInterval) -> [Run] {
    switch group {
    case .waiting: return byWait(runs)
    case .working: return byStart(runs)
    case .onHold: return sorted(runs, newestFirst: true) { holdTime($0, now: now) }
    case .finished: return byFinish(runs)
    }
}

/// The longest waiting first: a queue for the person, where a new wait joins at the end.
func byWait(_ runs: [Run]) -> [Run] {
    sorted(runs, newestFirst: false, by: waitTime)
}

/// In the order they started: a new run joins at the end.
func byStart(_ runs: [Run]) -> [Run] {
    sorted(runs, newestFirst: false) { $0.createdAt }
}

/// The last to finish first.
func byFinish(_ runs: [Run]) -> [Run] {
    sorted(runs, newestFirst: true, by: finishedTime)
}

/// When the run started waiting on the person: its question or permission, else its block, else when it started.
func waitTime(_ run: Run) -> TimeInterval {
    [run.waiting?.since, run.blocked?.since].compactMap { $0 }.first { $0 > 0 } ?? run.createdAt
}

/// When the run stopped: its pause, or for an orphan its last heartbeat.
func holdTime(_ run: Run, now: TimeInterval) -> TimeInterval {
    if effectiveStatus(run, now: now) == .orphaned { return run.owner.heartbeatAt }
    if let since = run.paused?.since, since > 0 { return since }
    return run.updatedAt
}

/// Ties go by id, so two runs with the same time never swap.
private func sorted(_ runs: [Run], newestFirst: Bool, by time: (Run) -> TimeInterval) -> [Run] {
    runs.sorted { lhs, rhs in
        let (a, b) = (time(lhs), time(rhs))
        if a != b { return newestFirst ? a > b : a < b }
        return lhs.id < rhs.id
    }
}
