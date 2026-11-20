import Foundation

/// A GitHub issue a node points at, parsed from whatever the person typed or pasted.
public struct IssueRef: Equatable, Hashable, Sendable {
    /// `owner/name`; nil when the text named only a number and there was no default repo to fill in.
    public var repo: String?
    public var number: Int

    public init(repo: String?, number: Int) {
        self.repo = repo
        self.number = number
    }

    /// Reads `131`, `#131`, `owner/repo#12` or a GitHub issue or pull URL. A bare number belongs to
    /// `defaultRepo` (the project's repo). Anything else is not an issue, so it gives nil rather than a guess.
    public static func parse(_ raw: String, defaultRepo: String?) -> IssueRef? {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if let ref = parseURL(text) { return ref }
        guard let hash = text.lastIndex(of: "#") else {
            return number(text).map { IssueRef(repo: defaultRepo, number: $0) }
        }
        guard let number = number(String(text[text.index(after: hash)...])) else { return nil }
        let prefix = String(text[..<hash])
        if prefix.isEmpty { return IssueRef(repo: defaultRepo, number: number) }
        guard let repo = repoName(prefix) else { return nil }
        return IssueRef(repo: repo, number: number)
    }

    /// Whether this issue lives in `repo`. GitHub treats owner and name case-insensitively, and so do we.
    public func isIn(repo other: String?) -> Bool {
        guard let repo, let other else { return false }
        return repo.lowercased() == other.lowercased()
    }

    /// How the meta line names the issue: `#12` inside the project's repo, `owner/repo#12` outside it, so a
    /// step from another repo doesn't read as if it were the project's.
    public func label(defaultRepo: String?) -> String {
        guard let repo, !isIn(repo: defaultRepo) else { return "#\(number)" }
        return "\(repo)#\(number)"
    }

    /// The issue's page on GitHub, for "Abrir en GitHub"; nil without a repo to put in it.
    public var url: String? {
        repo.map { "https://github.com/\($0)/issues/\(number)" }
    }

    private static func parseURL(_ text: String) -> IssueRef? {
        var rest = Substring(text)
        for scheme in ["https://", "http://"] where rest.lowercased().hasPrefix(scheme) {
            rest = rest.dropFirst(scheme.count)
        }
        if rest.lowercased().hasPrefix("www.") { rest = rest.dropFirst(4) }
        guard rest.lowercased().hasPrefix("github.com/") else { return nil }
        rest = rest.dropFirst("github.com/".count)
        if let end = rest.firstIndex(where: { $0 == "?" || $0 == "#" }) { rest = rest[..<end] }
        let parts = rest.split(separator: "/").map(String.init)
        guard parts.count >= 4, parts[2] == "issues" || parts[2] == "pull",
              let repo = repoName("\(parts[0])/\(parts[1])"), let number = number(parts[3]) else { return nil }
        return IssueRef(repo: repo, number: number)
    }

    private static func number(_ text: String) -> Int? {
        guard !text.isEmpty, text.allSatisfy({ $0.isASCII && $0.isNumber }), let value = Int(text), value > 0
        else { return nil }
        return value
    }

    private static func repoName(_ text: String) -> String? {
        let parts = text.split(separator: "/", omittingEmptySubsequences: false)
        guard parts.count == 2,
              parts.allSatisfy({ !$0.isEmpty && !$0.contains { $0.isWhitespace || $0 == "#" } }) else { return nil }
        return text
    }
}

/// The `owner/name` repo a project key (`owner__name`) stands for. A repo without a remote gets a
/// `local__<name>-<hash>` key, which names no GitHub repo, so it gives nil like a key without `__`.
public func repo(fromProjectKey key: String) -> String? {
    guard !key.hasPrefix("local__"), let range = key.range(of: "__") else { return nil }
    let repo = key.replacingCharacters(in: range, with: "/")
    return repo.hasPrefix("/") || repo.hasSuffix("/") ? nil : repo
}

/// The issue a run works. Repo and number come from the same source so they can't mix: the issue URL when it
/// parses, otherwise the ref, whose bare number belongs to the repo of the project key the run was started under.
public func runIssue(_ run: Run) -> IssueRef? {
    if let url = run.source.url, let issue = IssueRef.parse(url, defaultRepo: nil), issue.repo != nil {
        return issue
    }
    return IssueRef.parse(run.source.ref, defaultRepo: repo(fromProjectKey: run.project.key))
}

/// The `owner/name` repo whose issue a run works, as `runIssue` reads it.
public func runRepo(_ run: Run) -> String? {
    runIssue(run)?.repo
}

/// The runs that work GitHub issues, looked up by issue. Built once per tick of the runs model so every node
/// of every goal finds its run without walking all runs again.
public struct RunIndex: Equatable, Sendable {
    private struct Key: Hashable, Sendable {
        let repo: String
        let number: Int
    }

    private var runs: [Key: Run] = [:]
    private var byNode: [Run.NodeLink: Run] = [:]

    /// Keeps, for each issue and for each goal node, the run created last: an issue retried after a failure shows
    /// the retry, not the failure. Only `github_issue` runs count for an issue; any run Wololo launched from a
    /// node (`--node`) counts for that node, which is how a node without an issue finds its text run.
    public init(runs: [Run]) {
        for run in runs {
            guard let node = run.node else { continue }
            if let current = byNode[node], !Self.isNewer(run, than: current) { continue }
            byNode[node] = run
        }
        for run in runs where run.source.kind == "github_issue" {
            guard let issue = runIssue(run), let repo = issue.repo else { continue }
            let key = Key(repo: repo.lowercased(), number: issue.number)
            if let current = self.runs[key], !Self.isNewer(run, than: current) { continue }
            self.runs[key] = run
        }
    }

    /// The latest run on `issue`, or nil when it names no repo or no run works it.
    public func run(for issue: IssueRef) -> Run? {
        guard let repo = issue.repo else { return nil }
        return runs[Key(repo: repo.lowercased(), number: issue.number)]
    }

    /// The latest run launched from node `node` of goal `goal`.
    public func run(goal: String, node: String) -> Run? {
        byNode[Run.NodeLink(goal: goal, id: node)]
    }

    private static func isNewer(_ run: Run, than other: Run) -> Bool {
        if run.createdAt != other.createdAt { return run.createdAt > other.createdAt }
        if run.updatedAt != other.updatedAt { return run.updatedAt > other.updatedAt }
        return run.id > other.id
    }
}

/// The state a node's chip shows. The associated values carry what that chip and the meta line need.
public enum NodeState: Equatable, Sendable {
    case pending
    /// Pending with nothing left to wait for: the next thing to start.
    case ready
    /// `stage` is the run's current stage id, nil when the person set "En curso" by hand without a run.
    case doing(stage: String?)
    case review(prNumber: Int?, ci: String?)
    case done(prNumber: Int?)
    /// `by` is how many predecessors are not done yet.
    case blocked(by: Int)

    public var isDone: Bool {
        if case .done = self { return true }
        return false
    }
}

/// Why a pending node deserves a second look: its last run ended without getting the work done.
public enum NodeWarning: Equatable, Sendable {
    case lastRunFailed
    case lastRunCancelled
}

/// What the drawer's action button does for a node (spec 21).
public enum NodeAction: Equatable, Sendable {
    case start
    case viewRun(id: String)
    case openPR(url: String, number: Int?)
    /// Disabled, saying how many nodes it waits on; "Arrancar igual" stays in the context menu.
    case blocked(by: Int)
    case none
}

/// Everything the canvas and drawer show about one node, derived from the goal and the runs.
public struct NodeStatus: Equatable, Sendable {
    public var state: NodeState
    /// The state before blocked and ready were worked out, so a blocked node can still say it has a run going.
    public var baseState: NodeState
    /// Set when the person picked the state by hand and it won over the runs.
    public var isManual: Bool
    public var warning: NodeWarning?
    public var issue: IssueRef?
    public var runID: String?
    /// The issue's title as the matched run knows it.
    public var runTitle: String?
    public var prURL: String?
    public var prNumber: Int?
    public var ci: String?
    /// Whether the matched run is still going (live or in review), so starting another would duplicate it.
    public var runIsLive: Bool
    /// The goal's final node: it is the goal, not something to run.
    public var isFinal: Bool

    public init(state: NodeState, baseState: NodeState? = nil, isManual: Bool = false, warning: NodeWarning? = nil,
                issue: IssueRef? = nil, runID: String? = nil, runTitle: String? = nil, prURL: String? = nil,
                prNumber: Int? = nil, ci: String? = nil, runIsLive: Bool = false, isFinal: Bool = false) {
        self.state = state
        self.baseState = baseState ?? state
        self.isManual = isManual
        self.warning = warning
        self.issue = issue
        self.runID = runID
        self.runTitle = runTitle
        self.prURL = prURL
        self.prNumber = prNumber
        self.ci = ci
        self.runIsLive = runIsLive
        self.isFinal = isFinal
    }

    public var blockerCount: Int {
        if case .blocked(let count) = state { return count }
        return 0
    }

    /// The action button for a step. The final node has none: it is the goal, not something to run.
    public var action: NodeAction {
        if isFinal { return .none }
        switch state {
        case .pending, .ready:
            if runIsLive, let runID { return .viewRun(id: runID) }
            return .start
        case .blocked(let count):
            return .blocked(by: count)
        case .doing:
            return runID.map { .viewRun(id: $0) } ?? .none
        case .review:
            if let prURL, !prURL.isEmpty { return .openPR(url: prURL, number: prNumber) }
            return runID.map { .viewRun(id: $0) } ?? .none
        case .done:
            if let prURL, !prURL.isEmpty { return .openPR(url: prURL, number: prNumber) }
            return .none
        }
    }
}

/// How an arrow is drawn (spec 15).
public enum EdgeKind: Equatable, Sendable {
    /// The origin is done: solid and grey.
    case satisfied
    /// The origin is not done and holds up a step: dashed and red.
    case blocking
    /// The origin is not done and leads to the goal itself: dashed and grey.
    case pendingToGoal
}

/// The derived state of a whole goal at one moment: every node, every arrow and the progress.
public struct GoalStatus: Equatable, Sendable {
    public var nodes: [String: NodeStatus]
    public var edges: [GoalEdge: EdgeKind]
    public var doneIDs: Set<String>
    public var done: Int
    public var total: Int
    public var fraction: Double

    public func status(of id: String) -> NodeStatus? { nodes[id] }

    public func kind(of edge: GoalEdge) -> EdgeKind? { edges[edge] }

    public func blockerCount(of id: String) -> Int { nodes[id]?.blockerCount ?? 0 }
}

extension Goal {
    /// Derives every node's state from the runs. `defaultRepo` is the project's repo, which bare issue numbers
    /// belong to; `now` decides whether a run whose session went quiet is still alive.
    public func status(defaultRepo: String?, runs: RunIndex, now: TimeInterval) -> GoalStatus {
        var base: [String: NodeStatus] = [:]
        for node in steps {
            base[node.id] = Self.baseStatus(of: node, goalID: id, defaultRepo: defaultRepo, runs: runs, now: now)
        }
        let doneIDs = Set(base.filter { $0.value.state.isDone }.map(\.key))

        var nodes: [String: NodeStatus] = [:]
        for node in steps {
            guard var status = base[node.id] else { continue }
            let waitingOn = predecessors(of: node.id).filter { !doneIDs.contains($0) }.count
            if !status.state.isDone, waitingOn > 0 {
                status.state = .blocked(by: waitingOn)
            } else if status.state == .pending {
                status.state = .ready
            }
            nodes[node.id] = status
        }

        let finalPredecessors = predecessors(of: Self.finalID)
        let finalDone = !finalPredecessors.isEmpty && finalPredecessors.allSatisfy(doneIDs.contains)
        nodes[Self.finalID] = NodeStatus(state: finalDone ? .done(prNumber: nil) : .pending, isFinal: true)

        var edgeKinds: [GoalEdge: EdgeKind] = [:]
        for edge in edges {
            if doneIDs.contains(edge.from) {
                edgeKinds[edge] = .satisfied
            } else {
                edgeKinds[edge] = Self.isFinal(edge.to) ? .pendingToGoal : .blocking
            }
        }

        let progress = progress(doneIDs: doneIDs)
        return GoalStatus(nodes: nodes, edges: edgeKinds, doneIDs: doneIDs, done: progress.done,
                          total: progress.total, fraction: progress.fraction)
    }

    /// The spec 17 table, rule by rule in its order, with the manual state on top. The run's PR and CI stay
    /// in the status whatever wins, so the meta line keeps showing them. The node's run is the newer of the one
    /// launched from it and the one working its issue.
    static func baseStatus(of node: GoalNode, goalID: String, defaultRepo: String?, runs: RunIndex,
                           now: TimeInterval) -> NodeStatus {
        let issue = node.issue.flatMap { IssueRef.parse($0, defaultRepo: defaultRepo) }
        let launched = runs.run(goal: goalID, node: node.id)
        let worked = issue.flatMap(runs.run(for:))
        let latest = [launched, worked].compactMap { $0 }.max { $0.createdAt < $1.createdAt }
        guard let run = latest else {
            return NodeStatus(state: manualState(node.manualState, run: nil), isManual: node.manualState != nil,
                              issue: issue)
        }

        var status = NodeStatus(state: .pending, issue: issue, runID: run.id, runTitle: run.title,
                                prURL: run.pr?.url, prNumber: run.pr?.number, ci: run.pr?.ci)
        let effective = effectiveStatus(run, now: now)
        status.runIsLive = !effective.isTerminal
        if run.pr?.state == "merged" || run.outcome == "done" {
            status.state = .done(prNumber: run.pr?.number)
        } else if run.pr?.state == "ready" || effective == .inReview {
            status.state = .review(prNumber: run.pr?.number, ci: run.pr?.ci)
        } else if !effective.isTerminal {
            status.state = .doing(stage: run.stage?.id)
        } else if effective == .failed {
            status.warning = .lastRunFailed
        } else if effective == .cancelled {
            status.warning = .lastRunCancelled
        }

        if let manual = node.manualState {
            status.state = manualState(manual, run: run)
            status.isManual = true
            status.warning = nil
        }
        status.baseState = status.state
        return status
    }

    private static func manualState(_ manual: ManualState?, run: Run?) -> NodeState {
        switch manual {
        case .doing: return .doing(stage: run?.stage?.id)
        case .done: return .done(prNumber: run?.pr?.number)
        case .pending, nil: return .pending
        }
    }
}
