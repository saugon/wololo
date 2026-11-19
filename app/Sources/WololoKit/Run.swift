import Foundation

public struct Run: Equatable, Sendable {
    public var id: String
    public var title: String
    public var source: Source
    /// The goal node Wololo Desk launched the run from (`--node`); nil for a run started by hand.
    public var node: NodeLink?
    public var project: Project
    public var mode: String
    public var risk: String
    public var lang: Lang
    public var stage: CurrentStage?
    public var stages: [StageEntry]
    public var gates: [String: Gate]
    public var status: RunStatus
    public var waiting: Waiting?
    public var blocked: Blocked?
    public var doing: Doing?
    public var paused: Paused?
    public var prReview: PRReview?
    public var agents: [Agent]
    public var tasks: [TaskEntry]
    public var items: Items
    public var counts: Counts
    public var pr: PullRequest?
    public var screenshots: [Screenshot]
    public var owner: Owner
    public var createdAt: TimeInterval
    public var updatedAt: TimeInterval
    public var finishedAt: TimeInterval?
    public var outcome: String?
    public var summary: String?
    public var usage: [String: StageUsage]
    public var time: [String: StageTime]

    public static func decode(from data: Data) throws -> Run {
        try JSONDecoder().decode(Run.self, from: data)
    }
}

extension Run: Decodable {
    private enum Keys: String, CodingKey {
        case id, title, source, node, project, mode, risk, lang, stage, stages, gates, status, waiting, blocked, doing,
            paused, agents, tasks, items, counts, pr, screenshots, owner, outcome, summary, usage, time
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case finishedAt = "finished_at"
        // Not `review`: that top-level key already says where the change is approved ("local" or "pr").
        case prReview = "pr_review"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        id = try c.decode(String.self, forKey: .id)
        if id.isEmpty {
            throw DecodingError.dataCorruptedError(forKey: .id, in: c, debugDescription: "A run needs an id")
        }
        title = c.value(.title, or: "")
        source = c.value(.source, or: Source())
        node = c.optional(.node)
        project = c.value(.project, or: Project())
        mode = c.value(.mode, or: "")
        risk = c.value(.risk, or: "unknown")
        lang = c.value(.lang, or: .es)
        stage = c.optional(.stage)
        stages = c.list(.stages)
        gates = c.value(.gates, or: [:])
        status = c.value(.status, or: .unknown(""))
        waiting = c.optional(.waiting)
        blocked = c.optional(.blocked)
        doing = c.optional(.doing)
        paused = c.optional(.paused)
        prReview = c.optional(.prReview)
        agents = c.list(.agents)
        tasks = c.list(.tasks)
        items = c.value(.items, or: Items())
        counts = c.value(.counts, or: Counts())
        pr = c.optional(.pr)
        screenshots = c.list(.screenshots)
        owner = c.value(.owner, or: Owner())
        createdAt = c.value(.createdAt, or: 0)
        updatedAt = c.value(.updatedAt, or: 0)
        finishedAt = c.optional(.finishedAt)
        outcome = c.optional(.outcome)
        summary = c.optional(.summary)
        usage = c.value(.usage, or: [:])
        time = c.value(.time, or: [:])
    }
}

extension Run {
    public struct NodeLink: Equatable, Hashable, Sendable, Decodable {
        public var goal: String
        public var id: String

        public init(goal: String, id: String) {
            self.goal = goal
            self.id = id
        }
    }

    public struct Source: Equatable, Sendable, Decodable {
        public var kind = "text"
        public var ref = ""
        public var url: String?

        init() {}

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: AnyKey.self)
            kind = c.value("kind", or: kind)
            ref = c.value("ref", or: ref)
            url = c.optional("url")
        }
    }

    public struct Project: Equatable, Sendable, Decodable {
        public var key = ""
        public var path = ""
        public var worktree: String?
        public var branch: String?
        public var base: String?

        init() {}

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: AnyKey.self)
            key = c.value("key", or: key)
            path = c.value("path", or: path)
            worktree = c.optional("worktree")
            branch = c.optional("branch")
            base = c.optional("base")
        }
    }

    public struct CurrentStage: Equatable, Sendable, Decodable {
        public var id: String
        public var index: Int
        public var total: Int
        public var since: TimeInterval

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: AnyKey.self)
            id = c.value("id", or: "")
            index = c.value("index", or: Stage.index(of: id) ?? 0)
            total = c.value("total", or: Stage.all.count)
            since = c.value("since", or: 0)
        }
    }

    public struct StageEntry: Equatable, Sendable, Decodable {
        public var id: String
        public var startedAt: TimeInterval
        public var finishedAt: TimeInterval?

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: AnyKey.self)
            id = c.value("id", or: "")
            startedAt = c.value("started_at", or: 0)
            finishedAt = c.optional("finished_at")
        }
    }

    public struct Gate: Equatable, Sendable, Decodable {
        public var requestedAt: TimeInterval
        public var resolvedAt: TimeInterval?
        public var outcome: String?
        public var by: String?

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: AnyKey.self)
            requestedAt = c.value("requested_at", or: 0)
            resolvedAt = c.optional("resolved_at")
            outcome = c.optional("outcome")
            by = c.optional("by")
        }
    }

    public struct Waiting: Equatable, Sendable, Decodable {
        public var on: String
        public var question: String
        public var since: TimeInterval

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: AnyKey.self)
            on = c.value("on", or: "user")
            question = c.value("question", or: "")
            since = c.value("since", or: 0)
        }
    }

    public struct Blocked: Equatable, Sendable, Decodable {
        public var reason: String
        public var since: TimeInterval

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: AnyKey.self)
            reason = c.value("reason", or: "")
            since = c.value("since", or: 0)
        }
    }

    public struct Doing: Equatable, Sendable, Decodable {
        public var text: String
        public var since: TimeInterval

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: AnyKey.self)
            text = c.value("text", or: "")
            since = c.value("since", or: 0)
        }
    }

    public struct Paused: Equatable, Sendable, Decodable {
        public var note: String
        public var since: TimeInterval

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: AnyKey.self)
            note = c.value("note", or: "")
            since = c.value("since", or: 0)
        }
    }

    /// When the run's PR went into review: set while the run waits on its reviewers.
    public struct PRReview: Equatable, Sendable, Decodable {
        public var since: TimeInterval

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: AnyKey.self)
            since = c.value("since", or: 0)
        }
    }

    public struct Agent: Equatable, Sendable, Decodable {
        public var id: String
        public var role: String
        public var description: String
        public var model: String?
        public var status: String
        public var startedAt: TimeInterval
        public var finishedAt: TimeInterval?

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: AnyKey.self)
            id = c.value("id", or: "")
            role = c.value("role", or: "other")
            description = c.value("description", or: "")
            model = c.optional("model")
            status = c.value("status", or: "running")
            startedAt = c.value("started_at", or: 0)
            finishedAt = c.optional("finished_at")
        }
    }

    public struct TaskEntry: Equatable, Sendable, Decodable {
        public var id: String
        public var label: String
        public var kind: String
        public var startedAt: TimeInterval
        public var finishedAt: TimeInterval?
        public var status: String?

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: AnyKey.self)
            id = c.value("id", or: "")
            label = c.value("label", or: "")
            kind = c.value("kind", or: "other")
            startedAt = c.value("started_at", or: 0)
            finishedAt = c.optional("finished_at")
            status = c.optional("status")
        }
    }

    public struct Items: Equatable, Sendable, Decodable {
        public var done = 0
        public var total = 0
        public var current: CurrentItem?
        public var list: [ItemEntry] = []

        init() {}

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: AnyKey.self)
            done = c.value("done", or: done)
            total = c.value("total", or: total)
            current = c.optional("current")
            list = c.list("list")
        }
    }

    public struct CurrentItem: Equatable, Sendable, Decodable {
        public var n: Int
        public var title: String
        public var since: TimeInterval?

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: AnyKey.self)
            n = c.value("n", or: 0)
            title = c.value("title", or: "")
            since = c.optional("since")
        }
    }

    public struct ItemEntry: Equatable, Sendable, Decodable {
        public var n: Int
        public var title: String
        public var state: String
        public var sha: String?

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: AnyKey.self)
            n = c.value("n", or: 0)
            title = c.value("title", or: "")
            state = c.value("state", or: "pending")
            sha = c.optional("sha")
        }
    }

    public struct Counts: Equatable, Sendable, Decodable {
        public var assumptions = 0
        public var decisions = 0
        public var corrections = 0
        public var debateTurns = 0
        public var attempts = 0
        public var reversals = 0
        public var nudges = 0
        public var unsigned = 0
        public var ciFailures = 0

        init() {}

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: AnyKey.self)
            assumptions = c.value("assumptions", or: 0)
            decisions = c.value("decisions", or: 0)
            corrections = c.value("corrections", or: 0)
            debateTurns = c.value("debate_turns", or: 0)
            attempts = c.value("attempts", or: 0)
            reversals = c.value("reversals", or: 0)
            nudges = c.value("nudges", or: 0)
            unsigned = c.value("unsigned", or: 0)
            ciFailures = c.value("ci_failures", or: 0)
        }
    }

    public struct PullRequest: Equatable, Sendable, Decodable {
        public var url: String
        public var number: Int?
        public var state: String
        public var ci: String?

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: AnyKey.self)
            url = c.value("url", or: "")
            number = c.optional("number")
            state = c.value("state", or: "draft")
            ci = c.optional("ci")
        }
    }

    public struct Screenshot: Equatable, Sendable, Decodable {
        public var file: String
        public var caption: String

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: AnyKey.self)
            file = c.value("file", or: "")
            caption = c.value("caption", or: "")
        }
    }

    public struct Owner: Equatable, Sendable, Decodable {
        public var sessionID = ""
        public var cwd = ""
        public var heartbeatAt: TimeInterval = 0

        init() {}

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: AnyKey.self)
            sessionID = c.value("session_id", or: sessionID)
            cwd = c.value("cwd", or: cwd)
            heartbeatAt = c.value("heartbeat_at", or: heartbeatAt)
        }
    }

    public struct StageUsage: Equatable, Sendable, Decodable {
        public var input: Int
        public var output: Int
        public var cacheRead: Int
        public var cacheWrite: Int
        public var usd: Double
        public var roles: [String: RoleUsage]

        public var tokens: Int { input + output + cacheRead + cacheWrite }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: AnyKey.self)
            input = c.value("input", or: 0)
            output = c.value("output", or: 0)
            cacheRead = c.value("cache_read", or: 0)
            cacheWrite = c.value("cache_write", or: 0)
            usd = c.value("usd", or: 0)
            roles = c.value("roles", or: [:])
        }
    }

    public struct RoleUsage: Equatable, Sendable, Decodable {
        public var usd: Double
        public var tokens: Int

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: AnyKey.self)
            usd = c.value("usd", or: 0)
            tokens = c.value("tokens", or: 0)
        }
    }

    public struct StageTime: Equatable, Sendable, Decodable {
        public var work: TimeInterval
        public var agents: TimeInterval
        public var tests: TimeInterval
        public var you: TimeInterval
        public var paused: TimeInterval
        public var roles: [String: TimeInterval]

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: AnyKey.self)
            work = c.value("work", or: 0)
            agents = c.value("agents", or: 0)
            tests = c.value("tests", or: 0)
            you = c.value("you", or: 0)
            paused = c.value("paused", or: 0)
            roles = c.value("roles", or: [:])
        }
    }
}

struct AnyKey: CodingKey, ExpressibleByStringLiteral {
    let stringValue: String
    var intValue: Int? { nil }

    init(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { nil }
    init(stringLiteral value: String) { stringValue = value }
}

private struct Lossy<T: Decodable>: Decodable {
    let value: T?

    init(from decoder: Decoder) throws {
        value = try? T(from: decoder)
    }
}

extension KeyedDecodingContainer {
    func value<T: Decodable>(_ key: Key, or fallback: T) -> T {
        (try? decodeIfPresent(T.self, forKey: key)) ?? fallback
    }

    func optional<T: Decodable>(_ key: Key) -> T? {
        try? decodeIfPresent(T.self, forKey: key)
    }

    func list<T: Decodable>(_ key: Key) -> [T] {
        let items = try? decodeIfPresent([Lossy<T>].self, forKey: key)
        return items?.compactMap(\.value) ?? []
    }
}
