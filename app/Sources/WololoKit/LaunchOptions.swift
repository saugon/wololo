import Foundation

/// What the app shows at launch, from `WOLOLO_DESK_*`. Used to draw one view to a PNG and quit, so the UI can be
/// checked without screen recording.
public struct LaunchOptions: Equatable, Sendable {
    public enum DetailTab: String, CaseIterable, Sendable {
        case timeline
        case documents
        case screenshots
        case cost
    }

    public enum Target: Equatable, Sendable {
        case window
        case widget
        case settings
        case run(id: String, tab: DetailTab?)
        /// The window on the Planificación tab, on whatever goal was chosen.
        case planning
        /// The window on the Planificación tab, showing the goal with this id.
        case goal(id: String)
        /// The window on the Planificación tab with the "Nuevo proyecto" sheet open, so a snapshot can draw it.
        case newProject
    }

    public var open: Target?
    public var search: String?
    public var project: String?
    public var columns: BoardMode?
    /// The grid's cards per row (`WOLOLO_DESK_GRID_COLUMNS`, 0 for as many as fit).
    public var gridColumns: Int?
    public var snapshotURL: URL?
    /// A theme key to use for this launch only: the saved choice stays as it was.
    public var theme: String?
    /// Where to look for the user's themes instead of Application Support.
    public var themesDirectory: URL?
    /// Where to keep the goals instead of Application Support, in any mode (`WOLOLO_DESK_GOALS_DIR`).
    public var goalsDirectory: URL?
    /// The node to select on the goal `open` shows (`WOLOLO_DESK_NODE`), so a snapshot can show a selection.
    public var node: String?

    public init(open: Target? = nil, search: String? = nil, project: String? = nil, columns: BoardMode? = nil, snapshotURL: URL? = nil,
                theme: String? = nil, themesDirectory: URL? = nil, goalsDirectory: URL? = nil,
                node: String? = nil) {
        self.open = open
        self.search = search
        self.project = project
        self.columns = columns
        self.snapshotURL = snapshotURL
        self.theme = theme
        self.themesDirectory = themesDirectory
        self.goalsDirectory = goalsDirectory
        self.node = node
    }

    public init(environment: [String: String] = ProcessInfo.processInfo.environment) {
        open = Self.value(environment["WOLOLO_DESK_OPEN"]).flatMap(Self.target)
        search = Self.value(environment["WOLOLO_DESK_SEARCH"])
        project = Self.value(environment["WOLOLO_DESK_PROJECT"])
        switch Self.value(environment["WOLOLO_DESK_COLUMNS"]) {
        case "status": columns = .byStatus
        case "stage": columns = .byStage
        case "grid": columns = .grid
        default: columns = nil
        }
        gridColumns = Self.value(environment["WOLOLO_DESK_GRID_COLUMNS"]).flatMap(Int.init)
            .flatMap { (0...PlanningPrefs.maxGridColumns).contains($0) ? $0 : nil }
        snapshotURL = Self.value(environment["WOLOLO_DESK_SNAPSHOT"]).map(Self.fileURL)
        theme = Self.value(environment["WOLOLO_DESK_THEME"])
        themesDirectory = Self.value(environment["WOLOLO_DESK_THEMES_DIR"]).map(Self.fileURL)
        goalsDirectory = Self.value(environment[GoalStore.directoryEnvironmentKey]).map(Self.fileURL)
        node = Self.value(environment["WOLOLO_DESK_NODE"])
    }

    private static func fileURL(_ path: String) -> URL {
        URL(fileURLWithPath: (path as NSString).expandingTildeInPath)
    }

    private static func value(_ raw: String?) -> String? {
        guard let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else { return nil }
        return trimmed
    }

    /// `window`, `widget`, `settings`, `planning`, `new-project`, `goal:<id>` or `run:<id>[:<tab>]`; an unknown tab
    /// opens the run on its default tab.
    private static func target(_ raw: String) -> Target? {
        switch raw {
        case "window": return .window
        case "widget": return .widget
        case "settings": return .settings
        case "planning": return .planning
        case "new-project": return .newProject
        default:
            if raw.hasPrefix("goal:") {
                let id = String(raw.dropFirst("goal:".count))
                return id.isEmpty ? nil : .goal(id: id)
            }
            let parts = raw.split(separator: ":", maxSplits: 2, omittingEmptySubsequences: false).map(String.init)
            guard parts.count >= 2, parts[0] == "run", !parts[1].isEmpty else { return nil }
            return .run(id: parts[1], tab: parts.count == 3 ? DetailTab(rawValue: parts[2]) : nil)
        }
    }
}
