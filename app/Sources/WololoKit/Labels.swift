import Foundation

public enum Lang: String, Sendable, CaseIterable {
    case es
    case en
}

extension Lang: Decodable {
    public init(from decoder: Decoder) throws {
        let raw = try? decoder.singleValueContainer().decode(String.self)
        self = raw.flatMap(Lang.init(rawValue:)) ?? .es
    }
}

public struct Stage: Equatable, Sendable {
    public let id: String
    public let isGate: Bool
    private let es: String
    private let en: String

    public func label(_ lang: Lang) -> String {
        lang == .es ? es : en
    }

    public static let all: [Stage] = [
        Stage(id: "context", isGate: false, es: "Contexto", en: "Context"),
        Stage(id: "definition", isGate: false, es: "Definición", en: "Definition"),
        Stage(id: "mockup", isGate: false, es: "Mockup", en: "Mockup"),
        Stage(id: "gate_a", isGate: true, es: "Aprobar spec", en: "Approve spec"),
        Stage(id: "plan", isGate: false, es: "Plan", en: "Plan"),
        Stage(id: "implement", isGate: false, es: "Implementación", en: "Implementation"),
        Stage(id: "evidence", isGate: false, es: "Evidencia", en: "Evidence"),
        Stage(id: "gate_b", isGate: true, es: "Aprobar PR", en: "Approve PR"),
        Stage(id: "pr", isGate: false, es: "PR", en: "PR"),
    ]

    public static func index(of id: String) -> Int? {
        all.firstIndex { $0.id == id }
    }

    public static func label(of id: String, _ lang: Lang) -> String {
        all.first { $0.id == id }?.label(lang) ?? id
    }
}

extension RunStatus {
    public func label(_ lang: Lang) -> String {
        switch (self, lang) {
        case (.running, .es): return "Trabajando"
        case (.running, .en): return "Working"
        case (.waitingUser, .es): return "Te espera"
        case (.waitingUser, .en): return "Waiting for you"
        case (.waitingPermission, .es): return "Pide permiso"
        case (.waitingPermission, .en): return "Needs permission"
        case (.waitingAgents, .es): return "Agentes trabajando"
        case (.waitingAgents, .en): return "Agents working"
        case (.waitingCI, .es): return "Esperando CI"
        case (.waitingCI, .en): return "Waiting for CI"
        case (.waitingTests, .es): return "Corriendo tests"
        case (.waitingTests, .en): return "Running tests"
        case (.blocked, .es): return "Bloqueado"
        case (.blocked, .en): return "Blocked"
        case (.stalled, .es): return "Detenido"
        case (.stalled, .en): return "Stopped"
        case (.pausing, .es): return "Pausando"
        case (.pausing, .en): return "Pausing"
        case (.paused, .es): return "En pausa"
        case (.paused, .en): return "Paused"
        case (.inReview, .es): return "En revisión"
        case (.inReview, .en): return "In review"
        case (.orphaned, .es): return "Huérfano"
        case (.orphaned, .en): return "Orphaned"
        case (.done, .es): return "Listo"
        case (.done, .en): return "Done"
        case (.failed, .es): return "Falló"
        case (.failed, .en): return "Failed"
        case (.cancelled, .es): return "Cancelado"
        case (.cancelled, .en): return "Cancelled"
        case (.unknown, .es): return "desconocido"
        case (.unknown, .en): return "unknown"
        }
    }
}

public func duration(_ seconds: TimeInterval) -> String {
    let rounded = seconds.rounded(.toNearestOrAwayFromZero)
    let s = rounded.isFinite ? Int(min(max(0, rounded), Double(Int32.max))) : 0
    if s < 60 { return "\(s)s" }
    let m = s / 60
    if m < 60 { return "\(m)m" }
    return "\(m / 60)h" + String(format: "%02d", m % 60)
}

/// The run's risk in words: `low`, `high` and `unknown` as the mod sets them; anything else as it came.
public func riskLabel(_ risk: String, lang: Lang) -> String {
    switch (risk, lang) {
    case ("low", .es): return "bajo"
    case ("high", .es): return "alto"
    case ("unknown", .es): return "sin evaluar"
    case ("low", .en): return "low"
    case ("high", .en): return "high"
    case ("unknown", .en): return "unassessed"
    default: return risk
    }
}
