import Foundation

public func activityLine(_ run: Run, now: TimeInterval) -> String {
    let status = effectiveStatus(run, now: now)
    if status == .orphaned {
        let silence = elapsed(now - run.owner.heartbeatAt, lang: run.lang)
        return run.lang == .es ? "sin señal hace \(silence)" : "no signal for \(silence)"
    }
    // The mod's run.finished leaves blocked, paused and the current item behind, so they would be stale here.
    if status.isTerminal { return run.summary ?? "" }
    let candidates = [run.waiting?.question, run.blocked?.reason, run.doing?.text, run.paused?.note]
    if let text = candidates.compactMap({ $0 }).first(where: { !$0.isEmpty }) { return text }
    if let item = run.items.current {
        return "\(run.lang == .es ? "Ítem" : "Item") \(item.n): \(item.title)"
    }
    return ""
}

/// "hace 45s", "hace 12m", "hace 5h", "hace 3 d": one unit, compact enough for a card's corner.
public func ago(_ time: TimeInterval, now: TimeInterval, lang: Lang) -> String {
    let span = elapsed(now - time, lang: lang)
    return lang == .es ? "hace \(span)" : "\(span) ago"
}

/// The largest whole unit of a span: "45s", "12m", "5h", "3 d" ("3d" in English).
func elapsed(_ span: TimeInterval, lang: Lang) -> String {
    let seconds = span.isFinite ? Int(min(max(0, span.rounded()), Double(Int32.max))) : 0
    switch seconds {
    case ..<60: return "\(seconds)s"
    case ..<3600: return "\(seconds / 60)m"
    case ..<86400: return "\(seconds / 3600)h"
    default: return lang == .es ? "\(seconds / 86400) d" : "\(seconds / 86400)d"
    }
}

public struct MetaChip: Equatable, Sendable {
    public let text: String
    /// Full wording for the tooltip and the accessibility label.
    public let title: String
}

public func itemsChip(_ run: Run) -> MetaChip? {
    let items = run.items
    guard items.total > 0 else { return nil }
    let title = run.lang == .es
        ? "\(items.done) de \(items.total) ítems hechos"
        : "\(items.done) of \(items.total) items done"
    return MetaChip(text: "\(items.done)/\(items.total)", title: title)
}

/// Agents still running, as the mod's `liveAgents`: the ones without `finished_at`.
public func liveAgents(_ run: Run) -> [Run.Agent] {
    run.agents.filter { $0.finishedAt == nil }
}

/// Nil once the run ended or lost its session: nothing closes the agents it left open.
public func agentsChip(_ run: Run, now: TimeInterval) -> MetaChip? {
    let status = effectiveStatus(run, now: now)
    if status.isTerminal || status == .orphaned { return nil }
    let live = liveAgents(run)
    guard !live.isEmpty else { return nil }
    var roles: [String] = []
    var counts: [String: Int] = [:]
    for agent in live {
        if counts[agent.role] == nil { roles.append(agent.role) }
        counts[agent.role, default: 0] += 1
    }
    let names = roles.map { role in counts[role] == 1 ? role : "\(role) ×\(counts[role] ?? 0)" }
    let noun = run.lang == .es ? (live.count == 1 ? "agente" : "agentes") : (live.count == 1 ? "agent" : "agents")
    return MetaChip(text: "\(live.count)", title: "\(live.count) \(noun): \(names.joined(separator: ", "))")
}

public enum CIRole: String, Sendable {
    case pending
    case passing
    case failing
}

public func ciRole(_ run: Run) -> CIRole? {
    run.pr?.ci.flatMap(CIRole.init(rawValue:))
}

public func prChip(_ run: Run) -> MetaChip? {
    guard let pr = run.pr else { return nil }
    let number = pr.number ?? Int((pr.url as NSString).lastPathComponent)
    let text = number.map { "#\($0)" } ?? "PR"
    let es = run.lang == .es
    var title = number.map { "PR #\($0)" } ?? "PR"
    title += pr.state == "draft" ? " draft" : (es ? " listo" : " ready")
    switch ciRole(run) {
    case .pending: title += es ? ", CI pendiente" : ", CI pending"
    case .passing: title += es ? ", CI en verde" : ", CI passing"
    case .failing: title += es ? ", CI en rojo" : ", CI failing"
    case nil: break
    }
    return MetaChip(text: text, title: title)
}

public func sourceLabel(_ run: Run) -> String {
    let ref = run.source.ref
    switch run.source.kind {
    case "github_issue":
        return ref.hasPrefix("#") ? ref : "#\(ref)"
    case "file":
        let name = (ref as NSString).lastPathComponent
        if !name.isEmpty { return name }
    default:
        break
    }
    return run.lang == .es ? "texto" : "text"
}
