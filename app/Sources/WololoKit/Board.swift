import Foundation

public let finishedWindowSeconds: TimeInterval = 24 * 3600

/// The board's status groups. `onHold` is not a column: its runs wait under the board, next to the archive.
public enum StatusGroup: String, CaseIterable, Sendable {
    case waiting
    case working
    case review
    case onHold
    case finished

    public init(_ status: RunStatus) {
        switch status {
        case .waitingUser, .waitingPermission, .blocked, .stalled: self = .waiting
        case .running, .waitingAgents, .waitingTests, .waitingCI, .pausing, .unknown: self = .working
        case .inReview: self = .review
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
        case (.review, .es): return "En revisión"
        case (.review, .en): return "In review"
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
    /// The active runs as a grid of large cards, each with the stages beside it.
    case grid
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
    /// The status groups that get a column in the by-status board, in order. Paused and orphaned runs need someone to
    /// pick them up, not watching, so they wait in `onHold` under the board instead.
    public static let statusColumns: [StatusGroup] = [.waiting, .working, .review, .finished]

    public let columns: [BoardColumn]
    /// Paused and orphaned runs, the last to stop first. Kept in both modes.
    public let onHold: [Run]
    /// Finished runs older than the finished window, and cancelled ones at once, newest first. Kept in both modes.
    public let archive: [Run]
    /// Runs finished in the last 24 h: the by-status board's last column and the grid's section under the active
    /// runs; the by-stage board hides them.
    public let recentlyFinished: [Run]

    public var onHoldCount: Int { onHold.count }
    public var archiveCount: Int { archive.count }

    public init(runs: [Run], now: TimeInterval, mode: BoardMode) {
        let finished = runs.filter { StatusGroup($0, now: now) == .finished }
        // A cancelled run, discarded from here or from its session, is not worth watching for a day: it goes straight to the archive.
        let recent = finished.filter {
            effectiveStatus($0, now: now) != .cancelled && now - finishedTime($0) <= finishedWindowSeconds
        }
        let recentIDs = Set(recent.map(\.id))
        archive = byFinish(finished.filter { !recentIDs.contains($0.id) })
        recentlyFinished = ordered(recent, in: .finished, now: now)
        onHold = ordered(runs.filter { StatusGroup($0, now: now) == .onHold }, in: .onHold, now: now)

        switch mode {
        case .byStatus:
            columns = Self.statusColumns.map { group in
                let members = group == .finished ? recent : runs.filter { StatusGroup($0, now: now) == group }
                return BoardColumn(id: group.rawValue, es: group.label(.es), en: group.label(.en), runs: ordered(members, in: group, now: now))
            }
        case .byStage:
            // A run in review is active, and stays in its stage (the PR's). One on hold waits under the board.
            let active = runs.filter { ![.finished, .onHold].contains(StatusGroup($0, now: now)) }
            columns = Stage.all.enumerated().map { index, stage in
                let members = active.filter { stageIndex($0) == index }
                return BoardColumn(id: stage.id, es: stage.label(.es), en: stage.label(.en), runs: byStart(members))
            }
        case .grid:
            // The active runs in the widget's order: what waits on the person first, then what works, then what is in
            // review. Under them, the runs finished in the last 24 h, as the by-status board's last column.
            let active = runs.filter { ![.finished, .onHold].contains(StatusGroup($0, now: now)) }
            columns = [
                BoardColumn(id: "active", es: "Activos", en: "Active", runs: widgetRuns(active, now: now)),
                BoardColumn(id: StatusGroup.finished.rawValue, es: StatusGroup.finished.label(.es),
                            en: StatusGroup.finished.label(.en), runs: recentlyFinished),
            ]
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
/// the order they started, and last the ones in review, which need nothing from anyone right now.
public func widgetRuns(_ runs: [Run], now: TimeInterval) -> [Run] {
    let active = runs.filter { isActive($0, now: now) }
    let waiting = active.filter { isWaitingOnPerson($0, now: now) }
    let rest = active.filter { !isWaitingOnPerson($0, now: now) }
    let inReview = rest.filter { StatusGroup($0, now: now) == .review }
    let others = rest.filter { StatusGroup($0, now: now) != .review }
    return byWait(waiting) + byStart(others) + byReview(inReview)
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
    case .review: return byReview(runs)
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

/// By who has to move, the person first, then Claude, the reviewers, CI and the merge queue; within each, the longest in
/// review first. A card moves only when its review changes hands, which the mod sees every few minutes.
func byReview(_ runs: [Run]) -> [Run] {
    let ball = Dictionary(runs.map { ($0.id, prReviewBadge($0)?.ball ?? .reviewer) }, uniquingKeysWith: { first, _ in first })
    return sorted(runs, newestFirst: false, by: reviewTime).enumerated()
        .sorted { lhs, rhs in
            let (a, b) = (ball[lhs.element.id] ?? .reviewer, ball[rhs.element.id] ?? .reviewer)
            return a != b ? a < b : lhs.offset < rhs.offset
        }
        .map(\.element)
}

/// The last to finish first.
func byFinish(_ runs: [Run]) -> [Run] {
    sorted(runs, newestFirst: true, by: finishedTime)
}

/// When the run started waiting on the person: its question or permission, else its block, else when it started.
func waitTime(_ run: Run) -> TimeInterval {
    [run.waiting?.since, run.blocked?.since].compactMap { $0 }.first { $0 > 0 } ?? run.createdAt
}

/// When the run went into review, else when it started.
func reviewTime(_ run: Run) -> TimeInterval {
    run.prReview.map(\.since).flatMap { $0 > 0 ? $0 : nil } ?? run.createdAt
}

/// When the run stopped: its pause, or for an orphan its last heartbeat.
public func holdTime(_ run: Run, now: TimeInterval) -> TimeInterval {
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
