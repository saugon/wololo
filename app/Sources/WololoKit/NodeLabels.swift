import Foundation

/// The canvas's words for a node and its goal (spec 19). The texts are fixed in Spanish, like the rest of the
/// planning view.
extension NodeState {
    /// The status label on a node card, before the theme puts it in small caps.
    public var label: String {
        switch self {
        case .pending: return "Pendiente"
        case .ready: return "Listo para arrancar"
        case .doing: return "En curso"
        case .review: return "En review"
        case .done: return "Hecho"
        case .blocked: return "Bloqueado"
        }
    }
}

extension NodeState {
    /// The status label as a card shows it: a step in progress adds its run's stage ("En curso · implement").
    public var cardLabel: String {
        if case .doing(let stage?) = self, !stage.isEmpty { return "\(label) · \(stage)" }
        return label
    }
}

extension NodeStatus {
    /// The mono line under a node's title (spec 19): `#n · PR #m · CI ✓`, or "sin issue", plus a warning when the
    /// last run failed or was cancelled (spec 17).
    public func metaLine(defaultRepo: String?) -> String {
        var parts = [issue?.label(defaultRepo: defaultRepo) ?? "sin issue"]
        if let prNumber { parts.append("PR #\(prNumber)") }
        if let ci = ciLabel(ci) { parts.append(ci) }
        if let warning {
            parts.append(warning == .lastRunFailed ? "el último run falló" : "el último run se canceló")
        }
        return parts.joined(separator: " · ")
    }

    private func ciLabel(_ ci: String?) -> String? {
        guard let ci, !ci.isEmpty else { return nil }
        switch CIRole(rawValue: ci) {
        case .passing: return "CI ✓"
        case .failing: return "CI ✗"
        case .pending: return "CI …"
        case nil: return "CI \(ci)"
        }
    }
}

/// The line under a goal's title: "web · acme/web · 2 de 7 pasos hechos".
public func goalSubtitle(projectName: String?, repo: String?, done: Int, total: Int) -> String {
    var parts: [String] = []
    if let projectName {
        parts.append(projectName)
        if let repo { parts.append(repo) }
    }
    parts.append("\(done) de \(total) \(total == 1 ? "paso hecho" : "pasos hechos")")
    return parts.joined(separator: " · ")
}
