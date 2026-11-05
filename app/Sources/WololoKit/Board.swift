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
    /// Finished runs older than the finished window, newest first. Kept in both modes.
    public let archive: [Run]

    public var archiveCount: Int { archive.count }

    public init(runs: [Run], now: TimeInterval, mode: BoardMode) {
        let finished = runs.filter { StatusGroup($0, now: now) == .finished }
        let recent = finished.filter { now - finishedTime($0) <= finishedWindowSeconds }
        let recentIDs = Set(recent.map(\.id))
        archive = byRecentUpdate(finished.filter { !recentIDs.contains($0.id) })

        switch mode {
        case .byStatus:
            columns = StatusGroup.allCases.map { group in
                let members = group == .finished ? recent : runs.filter { StatusGroup($0, now: now) == group }
                return BoardColumn(id: group.rawValue, es: group.label(.es), en: group.label(.en), runs: byRecentUpdate(members))
            }
        case .byStage:
            let active = runs.filter { StatusGroup($0, now: now) != .finished }
            columns = Stage.all.enumerated().map { index, stage in
                let members = active.filter { stageIndex($0) == index }
                return BoardColumn(id: stage.id, es: stage.label(.es), en: stage.label(.en), runs: byRecentUpdate(members))
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

/// Active runs for the widget: the ones waiting on the person first, then the most recently updated.
public func widgetRuns(_ runs: [Run], now: TimeInterval) -> [Run] {
    let active = byRecentUpdate(runs.filter { isActive($0, now: now) })
    return active.filter { isWaitingOnPerson($0, now: now) } + active.filter { !isWaitingOnPerson($0, now: now) }
}

public func lastFinished(_ runs: [Run], now: TimeInterval) -> Run? {
    runs.filter { !isActive($0, now: now) }.max { finishedTime($0) < finishedTime($1) }
}

public func menuBarCount(_ runs: [Run], now: TimeInterval) -> Int {
    runs.filter { isWaitingOnPerson($0, now: now) }.count
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

func byRecentUpdate(_ runs: [Run]) -> [Run] {
    runs.sorted { $0.updatedAt != $1.updatedAt ? $0.updatedAt > $1.updatedAt : $0.id < $1.id }
}
