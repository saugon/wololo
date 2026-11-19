import Foundation

/// What the run is doing now. `prefixed` names a permission request, a block or a pause ("Bloqueado: …"), for places
/// that do not show the status next to it, such as the widget; the card shows it on its own line and drops it.
public func activityLine(_ run: Run, now: TimeInterval, prefixed: Bool = true) -> String {
    let status = effectiveStatus(run, now: now)
    if status == .orphaned {
        let silence = elapsed(now - run.owner.heartbeatAt, lang: run.lang)
        return run.lang == .es ? "sin señal hace \(silence)" : "no signal for \(silence)"
    }
    // The mod's run.finished leaves blocked, paused and the current item behind, so they would be stale here.
    if status.isTerminal { return run.summary ?? "" }
    let es = run.lang == .es
    // In review the plan is done, so the last item would be stale; the run waits on its reviewers.
    if status == .inReview {
        if let text = run.doing?.text, !text.isEmpty { return text }
        return es ? "Esperando revisión del PR" : "Waiting for the PR's review"
    }
    // A bare dot in the widget does not tell a permission request, a block or a pause apart, so the line says it.
    let permission = run.waiting?.on == "permission" ? (es ? "Pide permiso" : "Needs permission") : nil
    let candidates: [(prefix: String?, text: String?)] = [
        (permission, run.waiting?.question),
        (es ? "Bloqueado" : "Blocked", run.blocked?.reason),
        (nil, run.doing?.text),
        (es ? "En pausa" : "Paused", run.paused?.note),
    ]
    for candidate in candidates {
        guard let text = candidate.text, !text.isEmpty else { continue }
        guard prefixed, let prefix = candidate.prefix else { return text }
        return "\(prefix): \(text)"
    }
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

/// "45s", "12m", "3 d": `ago` without the "hace", for the widget's rows, where the corner is narrower.
public func shortAgo(_ time: TimeInterval, now: TimeInterval, lang: Lang) -> String {
    elapsed(now - time, lang: lang)
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
    return MetaChip(text: "\(live.count)", title: "\(agentsLabel(live.count, lang: run.lang) ?? ""): \(names.joined(separator: ", "))")
}

/// "1 agente", "2 agentes" ("agent", "agents"); nil for none.
public func agentsLabel(_ count: Int, lang: Lang) -> String? {
    guard count > 0 else { return nil }
    let noun = lang == .es ? (count == 1 ? "agente" : "agentes") : (count == 1 ? "agent" : "agents")
    return "\(count) \(noun)"
}

/// The card's "2 agentes": nil when no agent is running, or once the run ended or lost its session, as `agentsChip`.
public func agentsLabel(_ run: Run, now: TimeInterval) -> String? {
    agentsChip(run, now: now) == nil ? nil : agentsLabel(liveAgents(run).count, lang: run.lang)
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
    let number = prNumber(pr)
    let text = number.map { "#\($0)" } ?? "PR"
    let es = run.lang == .es
    var title = prLabel(run) ?? "PR"
    title += " " + prStateLabel(pr.state, lang: run.lang, short: true)
    switch ciRole(run) {
    case .pending: title += es ? ", CI pendiente" : ", CI pending"
    case .passing: title += es ? ", CI en verde" : ", CI passing"
    case .failing: title += es ? ", CI en rojo" : ", CI failing"
    case nil: break
    }
    return MetaChip(text: text, title: title)
}

/// The card's "PR #120", or "PR" when its number is not known.
public func prLabel(_ run: Run) -> String? {
    guard let pr = run.pr else { return nil }
    return prNumber(pr).map { "PR #\($0)" } ?? "PR"
}

/// The PR's page, once the run opened one with a web URL; nil otherwise, so the label shows without a link.
public func prURL(_ run: Run) -> URL? {
    guard let pr = run.pr, let url = URL(string: pr.url), url.scheme?.hasPrefix("http") == true else { return nil }
    return url
}

/// The PR's state in words: `draft`, `merged` and `closed` as the mod sets them, and any other state (`ready`) as
/// ready, as before the mod knew merges. `short` is the chip's "listo", where "PR #12 listo" already says what is.
public func prStateLabel(_ state: String, lang: Lang, short: Bool = false) -> String {
    let es = lang == .es
    switch state {
    case "draft": return "draft"
    case "merged": return es ? "mergeado" : "merged"
    case "closed": return es ? "cerrado" : "closed"
    default: return short ? (es ? "listo" : "ready") : (es ? "listo para revisar" : "ready for review")
    }
}

private func prNumber(_ pr: Run.PullRequest) -> Int? {
    pr.number ?? Int((pr.url as NSString).lastPathComponent)
}

/// The card's origin in the reference layout, "acme/web #4312": the project and its source, without a separator.
/// "acme/web #4312" for an issue; just the repo when the run came from text or a file, as the card shows it.
public func originLabel(_ run: Run) -> String {
    run.source.kind == "github_issue" ? "\(run.project.display) \(sourceLabel(run))" : run.project.display
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
