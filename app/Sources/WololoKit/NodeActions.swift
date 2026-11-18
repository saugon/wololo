import Foundation

/// The drawer's action button for a node (spec 21): what it says, whether it can be pressed, the line under it and
/// what it does. Fixed in Spanish, like the rest of the planning view.
public struct NodeActionPresentation: Equatable, Sendable {
    public enum Kind: Equatable, Sendable {
        /// Runs `command` in a new terminal in `folder`.
        case start(command: String, folder: String)
        case viewRun(id: String)
        case openPR(url: String)
        /// Nothing to press: a disabled button ("Bloqueado por 2 nodos", a start without a folder) or the word "Hecho".
        case none
    }

    public var kind: Kind
    public var label: String
    public var isEnabled: Bool
    /// The small line under the button; nil for none.
    public var subline: String?
    /// Whether the line is the command itself, set in mono.
    public var sublineIsCommand: Bool
    /// Whether it is drawn as the primary button (only a start that can run).
    public var isPrimary: Bool
    /// Whether it is a plain word instead of a button ("Hecho" for a step done without a PR).
    public var isTextOnly: Bool

    public init(kind: Kind, label: String, isEnabled: Bool, subline: String? = nil, sublineIsCommand: Bool = false,
                isPrimary: Bool = false, isTextOnly: Bool = false) {
        self.kind = kind
        self.label = label
        self.isEnabled = isEnabled
        self.subline = subline
        self.sublineIsCommand = sublineIsCommand
        self.isPrimary = isPrimary
        self.isTextOnly = isTextOnly
    }

    /// The button for `status`, given the `/wololo` command and the folder "Arrancar run" would use. `home` turns the
    /// folder into `~/…` on the line under the button. Nil when there is nothing to show: the final node, or a step in
    /// progress by hand with no run to look at.
    public static func make(status: NodeStatus, command: String, folder: LaunchFolder,
                            home: String) -> NodeActionPresentation? {
        if status.isFinal { return nil }
        switch status.action {
        case .start:
            switch folder {
            case .folder(let path):
                return NodeActionPresentation(
                    kind: .start(command: command, folder: path), label: "▶ Arrancar run", isEnabled: true,
                    subline: "\(RunLaunch.shellLine(command: command)) en \(abbreviatingHome(path, home: home))",
                    sublineIsCommand: true, isPrimary: true)
            case .disabled(let reason):
                return NodeActionPresentation(kind: .none, label: "▶ Arrancar run", isEnabled: false, subline: reason)
            }
        case .viewRun(let id):
            return NodeActionPresentation(kind: .viewRun(id: id), label: "Ver run", isEnabled: true,
                                          subline: runSubline(status))
        case .openPR(let url, let number):
            return NodeActionPresentation(kind: .openPR(url: url), label: number.map { "Abrir PR #\($0)" } ?? "Abrir PR",
                                          isEnabled: true, subline: prSubline(status))
        case .blocked(let count):
            let subline = status.runIsLive ? "Hay un run trabajando en este issue"
                : "Podés arrancarlo igual desde el menú contextual"
            return NodeActionPresentation(kind: .none, label: "Bloqueado por \(count) \(count == 1 ? "nodo" : "nodos")",
                                          isEnabled: false, subline: subline)
        case .none:
            guard status.state.isDone else { return nil }
            return NodeActionPresentation(kind: .none, label: "Hecho", isEnabled: false, isTextOnly: true)
        }
    }

    /// `path` with the home folder written as `~`.
    public static func abbreviatingHome(_ path: String, home: String) -> String {
        let home = home.hasSuffix("/") ? String(home.dropLast()) : home
        guard !home.isEmpty else { return path }
        if path == home { return "~" }
        if path.hasPrefix(home + "/") { return "~" + path.dropFirst(home.count) }
        return path
    }

    private static func runSubline(_ status: NodeStatus) -> String? {
        if case .doing(let stage?) = status.baseState, !stage.isEmpty { return "En curso · \(stage)" }
        return status.runIsLive ? "Hay un run trabajando en este issue" : nil
    }

    private static func prSubline(_ status: NodeStatus) -> String? {
        switch status.state {
        case .review:
            guard let ci = ciWords(status.ci) else { return "En review" }
            return "En review · \(ci)"
        case .done: return "Hecho"
        default: return nil
        }
    }

    private static func ciWords(_ ci: String?) -> String? {
        guard let ci, !ci.isEmpty else { return nil }
        switch CIRole(rawValue: ci) {
        case .passing: return "CI en verde"
        case .failing: return "CI en rojo"
        case .pending: return "CI corriendo"
        case nil: return "CI \(ci)"
        }
    }
}

extension NodeStatus {
    /// The line under the drawer's "Estado" control (spec 17): whether the state comes from the run or the person, and
    /// what a step waits on.
    public var stateNote: String {
        if isFinal { return "Se completa solo cuando todo lo que llega a él está hecho." }
        if isManual {
            return runID == nil ? "Manual: no hay run que lo diga, lo marcaste vos."
                : "Manual: le gana al run hasta que vuelvas a Auto."
        }
        if case .blocked(let count) = state, !runIsLive {
            return count == 1 ? "Bloqueado: espera a 1 nodo. Se desbloquea solo cuando esté hecho."
                : "Bloqueado: espera a \(count) nodos. Se desbloquea solo cuando estén hechos."
        }
        switch warning {
        case .lastRunFailed: return "Automático: el último run falló. Podés arrancar otro."
        case .lastRunCancelled: return "Automático: el último run se canceló. Podés arrancar otro."
        case nil: break
        }
        if runID != nil { return "Automático: sale del run y su PR." }
        if state == .ready { return "Todo lo que lo precede está hecho: se puede arrancar." }
        return "Automático: sale del run y su PR cuando arranque uno."
    }
}

/// What the right-click menu offers for a node, beside "Borrar paso" (spec 13, 21).
public enum NodeMenuEntry: Equatable, Sendable {
    /// "Arrancar igual": starts a blocked step without waiting for what it depends on.
    case startAnyway
    /// "Ver run": a blocked step whose run is already going, where starting another would duplicate it.
    case viewRun(id: String)
    case delete

    public var title: String {
        switch self {
        case .startAnyway: return "Arrancar igual"
        case .viewRun: return "Ver run"
        case .delete: return "Borrar paso"
        }
    }

    /// The entries for a node, top to bottom. The final node is the goal: nothing to start or remove.
    public static func entries(for status: NodeStatus?, isFinal: Bool) -> [NodeMenuEntry] {
        if isFinal { return [] }
        guard let status, case .blocked = status.state else { return [.delete] }
        if status.runIsLive, let runID = status.runID { return [.viewRun(id: runID), .delete] }
        return [.startAnyway, .delete]
    }
}

/// The issue field's text as it is kept: trimmed, and nil when blank. `isValid` is false for text that names no issue,
/// so the drawer can say "No reconozco ese issue" while still keeping what was typed.
public func issueFieldValue(_ text: String, defaultRepo: String?) -> (value: String?, isValid: Bool) {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return (nil, true) }
    return (trimmed, IssueRef.parse(trimmed, defaultRepo: defaultRepo) != nil)
}
