import Foundation

/// A place on a goal's canvas, in canvas coordinates (not screen points), so it survives zoom and pan.
public struct CanvasPoint: Equatable, Sendable, Codable {
    public var x: Double
    public var y: Double

    public init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }

    public static let zero = CanvasPoint(x: 0, y: 0)

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        x = c.value("x", or: 0)
        y = c.value("y", or: 0)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: AnyKey.self)
        try c.encode(x, forKey: "x")
        try c.encode(y, forKey: "y")
    }
}

/// The state a person sets on a node by hand. It wins over whatever the node's runs say until it is cleared.
public enum ManualState: String, Equatable, Sendable, Codable, CaseIterable {
    case pending, doing, done
}

/// A project the planning view groups goals under: a local folder and, optionally, the GitHub repo it pushes to.
public struct PlanningProject: Equatable, Sendable, Codable, Identifiable {
    public var id: String
    public var name: String
    public var path: String
    /// `owner/name` on GitHub; nil when the folder has no GitHub remote.
    public var repo: String?
    /// The `owner__name` key runs use for this project, so runs started later land under it.
    public var key: String?

    /// The key runs use for a project pushed to `repo` (`owner/name` → `owner__name`).
    public static func key(forRepo repo: String) -> String {
        repo.replacingOccurrences(of: "/", with: "__")
    }

    /// The key to match runs against: the stored one, or the one derived from the repo when none was stored.
    public var effectiveKey: String? {
        key ?? repo.map(Self.key(forRepo:))
    }

    public init(id: String, name: String, path: String, repo: String? = nil, key: String? = nil) {
        self.id = id
        self.name = name
        self.path = path
        self.repo = repo
        self.key = key
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        id = c.value("id", or: "")
        if id.isEmpty {
            throw DecodingError.dataCorruptedError(forKey: "id", in: c, debugDescription: "A project needs an id")
        }
        name = c.value("name", or: id)
        path = c.value("path", or: "")
        repo = Self.nonEmpty(c.optional("repo"))
        key = Self.nonEmpty(c.optional("key"))
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: AnyKey.self)
        try c.encode(id, forKey: "id")
        try c.encode(name, forKey: "name")
        try c.encode(path, forKey: "path")
        try c.encodeIfPresent(repo, forKey: "repo")
        try c.encodeIfPresent(key, forKey: "key")
    }

    private static func nonEmpty(_ value: String?) -> String? {
        value?.isEmpty == false ? value : nil
    }
}

/// The contents of `projects.json`: every project the person created or gave a goal to.
public struct PlanningProjectsFile: Equatable, Sendable, Codable {
    public static let currentSchemaVersion = 1
    /// Every file in the goals folder carries an id; this one is a singleton, so its id is fixed.
    public static let fileID = "projects"

    public var schemaVersion: Int
    /// Seconds since the epoch, kept as a plain number like runs do so it round-trips exactly.
    public var updatedAt: TimeInterval
    public var projects: [PlanningProject]

    public init(updatedAt: TimeInterval, projects: [PlanningProject]) {
        schemaVersion = Self.currentSchemaVersion
        self.updatedAt = updatedAt
        self.projects = projects
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        schemaVersion = c.value("schema_version", or: Self.currentSchemaVersion)
        if schemaVersion > Self.currentSchemaVersion {
            throw DecodingError.dataCorruptedError(forKey: "schema_version", in: c,
                                                   debugDescription: "Written by a newer version of the app")
        }
        updatedAt = c.value("updated_at", or: 0)
        projects = c.list("projects")
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: AnyKey.self)
        try c.encode(schemaVersion, forKey: "schema_version")
        try c.encode(Self.fileID, forKey: "id")
        try c.encode(updatedAt, forKey: "updated_at")
        try c.encode(projects, forKey: "projects")
    }

    public static func decode(from data: Data) throws -> PlanningProjectsFile {
        try JSONDecoder().decode(PlanningProjectsFile.self, from: data)
    }

    public func encoded() throws -> Data {
        try GoalJSON.encoder.encode(self)
    }
}

/// One step of a goal: something to get done, optionally tied to a GitHub issue.
public struct GoalNode: Equatable, Sendable, Codable, Identifiable {
    public var id: String
    public var title: String
    public var description: String
    /// The issue as the person typed it ("131", "#131", "owner/repo#12" or the issue URL). Kept raw so the
    /// field shows back exactly what was entered; it is parsed when the state is derived.
    public var issue: String?
    public var manualState: ManualState?
    public var position: CanvasPoint

    public init(id: String, title: String = "", description: String = "", issue: String? = nil,
                manualState: ManualState? = nil, position: CanvasPoint = .zero) {
        self.id = id
        self.title = title
        self.description = description
        self.issue = Self.cleanIssue(issue)
        self.manualState = manualState
        self.position = position
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        id = c.value("id", or: "")
        if id.isEmpty || id == Goal.finalID {
            throw DecodingError.dataCorruptedError(forKey: "id", in: c,
                                                   debugDescription: "A node needs an id other than the final one")
        }
        title = c.value("title", or: "")
        description = c.value("description", or: "")
        issue = Self.cleanIssue(c.optional("issue"))
        manualState = c.optional("manual_state")
        position = c.value("position", or: .zero)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: AnyKey.self)
        try c.encode(id, forKey: "id")
        try c.encode(title, forKey: "title")
        try c.encode(description, forKey: "description")
        try c.encodeIfPresent(issue, forKey: "issue")
        try c.encodeIfPresent(manualState, forKey: "manual_state")
        try c.encode(position, forKey: "position")
    }

    /// Stray spaces or newlines around a pasted issue would break parsing it later; a blank one is no issue.
    private static func cleanIssue(_ issue: String?) -> String? {
        let trimmed = issue?.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed?.isEmpty == false ? trimmed : nil
    }
}

/// An arrow `from → to`: `to` depends on `from`. `to` may be `Goal.finalID`; `from` never is.
public struct GoalEdge: Equatable, Hashable, Sendable, Codable {
    public var from: String
    public var to: String

    public init(from: String, to: String) {
        self.from = from
        self.to = to
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        from = c.value("from", or: "")
        to = c.value("to", or: "")
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: AnyKey.self)
        try c.encode(from, forKey: "from")
        try c.encode(to, forKey: "to")
    }
}

/// A goal inside a project, drawn as a graph of steps that ends in the goal itself (the final node).
public struct Goal: Equatable, Sendable, Codable, Identifiable {
    public static let currentSchemaVersion = 1
    /// The final node is not stored in `nodes`: it is the goal itself, so it can't be deleted or point anywhere.
    /// Edges reach it through this reserved id.
    public static let finalID = "final"

    public var schemaVersion: Int
    public var id: String
    public var projectID: String
    public var title: String
    public var description: String
    public var nodes: [GoalNode]
    public var edges: [GoalEdge]
    public var finalPosition: CanvasPoint
    /// Seconds since the epoch, set by whoever saves the goal; graph operations leave it alone so they stay pure.
    public var updatedAt: TimeInterval

    /// Goal ids name their files (`<id>.json`), so an id must be a plain file name that can't clash with
    /// `projects.json`, hide itself or reach outside the goals folder.
    public static func isValidID(_ id: String) -> Bool {
        !id.isEmpty && id != PlanningProjectsFile.fileID && !id.hasPrefix(".")
            && !id.contains { $0 == "/" || $0 == "\\" || $0 == ":" }
    }

    public init(id: String, projectID: String, title: String, description: String = "", nodes: [GoalNode] = [],
                edges: [GoalEdge] = [], finalPosition: CanvasPoint = .zero, updatedAt: TimeInterval) {
        schemaVersion = Self.currentSchemaVersion
        self.id = id
        self.projectID = projectID
        self.title = title
        self.description = description
        self.nodes = nodes
        self.edges = edges
        self.finalPosition = finalPosition
        self.updatedAt = updatedAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        id = c.value("id", or: "")
        if !Self.isValidID(id) {
            throw DecodingError.dataCorruptedError(forKey: "id", in: c,
                                                   debugDescription: "A goal needs an id that can name its file")
        }
        schemaVersion = c.value("schema_version", or: Self.currentSchemaVersion)
        if schemaVersion > Self.currentSchemaVersion {
            throw DecodingError.dataCorruptedError(forKey: "schema_version", in: c,
                                                   debugDescription: "Written by a newer version of the app")
        }
        projectID = c.value("project_id", or: "")
        if projectID.isEmpty {
            throw DecodingError.dataCorruptedError(forKey: "project_id", in: c,
                                                   debugDescription: "A goal needs a project")
        }
        title = c.value("title", or: "")
        description = c.value("description", or: "")
        finalPosition = c.value("final_position", or: .zero)
        updatedAt = c.value("updated_at", or: 0)
        nodes = Self.uniqueNodes(c.list("nodes"))
        edges = Self.validEdges(c.list("edges"), nodes: nodes)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: AnyKey.self)
        try c.encode(schemaVersion, forKey: "schema_version")
        try c.encode(id, forKey: "id")
        try c.encode(projectID, forKey: "project_id")
        try c.encode(title, forKey: "title")
        try c.encode(description, forKey: "description")
        try c.encode(nodes, forKey: "nodes")
        try c.encode(edges, forKey: "edges")
        try c.encode(finalPosition, forKey: "final_position")
        try c.encode(updatedAt, forKey: "updated_at")
    }

    public static func decode(from data: Data) throws -> Goal {
        try JSONDecoder().decode(Goal.self, from: data)
    }

    public func encoded() throws -> Data {
        try GoalJSON.encoder.encode(self)
    }

    /// A hand-edited or half-written file may repeat a node; the first one wins so ids stay unique.
    private static func uniqueNodes(_ nodes: [GoalNode]) -> [GoalNode] {
        var seen = Set<String>()
        return nodes.filter { seen.insert($0.id).inserted }
    }

    /// Drops edges that `connect` would never have made (dangling, out of the final node, self loops,
    /// repeats or closing a cycle), so the rest of the app can trust the graph it loads.
    private static func validEdges(_ edges: [GoalEdge], nodes: [GoalNode]) -> [GoalEdge] {
        var goal = Goal(id: "-", projectID: "", title: "", nodes: nodes, updatedAt: 0)
        for edge in edges {
            goal.connect(from: edge.from, to: edge.to)
        }
        return goal.edges
    }
}

/// Goal files are pretty-printed with sorted keys so they read well and diff cleanly.
enum GoalJSON {
    static var encoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return encoder
    }
}
