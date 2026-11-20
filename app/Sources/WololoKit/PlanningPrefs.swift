import Foundation

/// The two tabs at the top of the window's sidebar.
public enum PlanningTab: String, Equatable, Sendable, CaseIterable {
    case operation
    case planning
}

/// Where the person left the window, kept in `UserDefaults` across launches: the tab, how the board groups its runs,
/// the chosen project and goal, and how far each goal's canvas was zoomed and panned. Reads tolerate anything another version (or a hand
/// edit) left under these keys; with `persists: false` (snapshots) nothing is written.
public struct PlanningPrefs {
    public enum Key {
        public static let tab = "planning.tab"
        public static let boardMode = "board.mode"
        public static let gridColumns = "board.gridColumns"
        public static let projectID = "planning.selectedProjectID"
        public static let goalID = "planning.selectedGoalID"
        /// A dictionary from goal id to the JSON of its `Viewport`.
        public static let viewports = "planning.viewports"
    }

    private let defaults: UserDefaults
    public let persists: Bool

    public init(defaults: UserDefaults, persists: Bool) {
        self.defaults = defaults
        self.persists = persists
    }

    /// Operación unless Planificación was saved.
    public var tab: PlanningTab {
        get { (defaults.object(forKey: Key.tab) as? String).flatMap(PlanningTab.init(rawValue:)) ?? .operation }
        nonmutating set { write(newValue.rawValue, forKey: Key.tab) }
    }

    /// Por estado unless another view was saved.
    public var boardMode: BoardMode {
        get { (defaults.object(forKey: Key.boardMode) as? String).flatMap(BoardMode.init(rawValue:)) ?? .byStatus }
        nonmutating set { write(newValue.rawValue, forKey: Key.boardMode) }
    }

    /// The grid's cards per row, from 1 to `maxGridColumns`; 0 (or anything else saved) is as many as fit.
    public var gridColumns: Int {
        get {
            let value = defaults.object(forKey: Key.gridColumns) as? Int ?? 0
            return (0...Self.maxGridColumns).contains(value) ? value : 0
        }
        nonmutating set {
            guard persists else { return }
            if newValue > 0, newValue <= Self.maxGridColumns {
                defaults.set(newValue, forKey: Key.gridColumns)
            } else {
                defaults.removeObject(forKey: Key.gridColumns)
            }
        }
    }

    public static let maxGridColumns = 6

    public var selectedProjectID: String? {
        get { string(Key.projectID) }
        nonmutating set { write(newValue, forKey: Key.projectID) }
    }

    public var selectedGoalID: String? {
        get { string(Key.goalID) }
        nonmutating set { write(newValue, forKey: Key.goalID) }
    }

    /// The goal's saved viewport, or nil when none was saved or what was saved can't be read.
    public func viewport(forGoal id: String) -> Viewport? {
        guard let data = storedViewports()[id] as? Data,
              let viewport = try? JSONDecoder().decode(Viewport.self, from: data),
              viewport.offset.x.isFinite, viewport.offset.y.isFinite
        else { return nil }
        return viewport
    }

    /// Saves the goal's viewport. One that is not finite (a pan that ran away) is not written, so the saved one stays.
    public func setViewport(_ viewport: Viewport, forGoal id: String) {
        guard persists, viewport.offset.x.isFinite, viewport.offset.y.isFinite, viewport.zoom.isFinite,
              let data = try? JSONEncoder().encode(viewport)
        else { return }
        var all = storedViewports()
        all[id] = data
        defaults.set(all, forKey: Key.viewports)
    }

    /// Forgets the viewport of a goal that was deleted.
    public func removeViewport(forGoal id: String) {
        guard persists else { return }
        var all = storedViewports()
        guard all.removeValue(forKey: id) != nil else { return }
        defaults.set(all, forKey: Key.viewports)
    }

    private func storedViewports() -> [String: Any] {
        defaults.dictionary(forKey: Key.viewports) ?? [:]
    }

    private func string(_ key: String) -> String? {
        guard let value = defaults.object(forKey: key) as? String, !value.isEmpty else { return nil }
        return value
    }

    private func write(_ value: String?, forKey key: String) {
        guard persists else { return }
        if let value, !value.isEmpty {
            defaults.set(value, forKey: key)
        } else {
            defaults.removeObject(forKey: key)
        }
    }
}
