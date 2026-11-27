import Foundation

/// A timeline line: the event in words, at its time.
public struct TimelineEntry: Equatable, Sendable, Identifiable {
    /// The event's position in the list `timeline` was given. Not the seq: concurrent hooks can share one.
    public let id: Int
    public let seq: Int
    public let ts: TimeInterval
    public let type: String
    public let text: String
    public let isMinor: Bool
}

/// The run's events in order, worded for the person. Minor events only when `includeMinor`.
public func timeline(_ events: [RunEvent], lang: Lang, includeMinor: Bool) -> [TimelineEntry] {
    events.enumerated().compactMap { position, event in
        let minor = isMinorEvent(event.type)
        if minor && !includeMinor { return nil }
        return TimelineEntry(id: position, seq: event.seq, ts: event.ts, type: event.type,
                             text: eventLine(event, lang: lang), isMinor: minor)
    }
}

/// Events hidden behind the timeline's switch. The spec names `usage`, `time`, `agent.*` and `task.*`: bookkeeping
/// that comes by the dozen. `doing` and `permission.*` join them: `doing` is rewritten every few steps and is already
/// the activity line, and every tool approval asks permission. What the run decided, asked or produced stays visible.
public func isMinorEvent(_ type: String) -> Bool {
    if type == "usage" || type == "time" || type == "doing" { return true }
    return type.hasPrefix("agent.") || type.hasPrefix("task.") || type.hasPrefix("permission.")
}

/// The event as one line in the run's language, following the mod's `history.ts` and the mockup's wording.
/// An event type the app does not know gets a generic line.
public func eventLine(_ event: RunEvent, lang: Lang) -> String {
    let es = lang == .es
    let d = event.data
    let s = event.text
    switch event.type {
    case "run.started":
        let mode = s("mode")
        if mode.isEmpty { return es ? "Arrancó el run" : "Run started" }
        return es ? "Arrancó el run · modo \(mode)" : "Run started · \(mode) mode"
    case "owner.changed":
        return es ? "Retomado en otra sesión" : "Resumed in another session"
    case "risk.set":
        return "\(es ? "Riesgo" : "Risk"): \(s("risk"))" + suffix(" · ", s("reason"))
    case "stage.entered":
        let back = s("reason").isEmpty ? "" : " (\(es ? "vuelve" : "back"): \(s("reason")))"
        return "\(es ? "Entró a" : "Entered") \(Stage.label(of: s("stage"), lang))" + back
    case "stage.completed":
        return "\(es ? "Terminó" : "Finished") \(Stage.label(of: s("stage"), lang))" + suffix(": ", s("note"))
    case "gate.requested":
        return es ? "Pidió aprobar \(gateNoun(s("gate"), lang))" : "Asked to approve \(gateNoun(s("gate"), lang))"
    case "gate.resolved":
        return gateResolvedLine(gate: s("gate"), outcome: s("outcome"), by: s("by"), lang: lang)
    case "question.asked":
        return s("question")
    case "question.answered":
        return answerLine(event, lang: lang)
    case "permission.asked":
        return "\(es ? "Pidió permiso" : "Asked permission"): " + permissionSubject(event)
    case "permission.resolved":
        let what = permissionSubject(event)
        switch s("outcome") {
        case "approved": return "\(es ? "Permiso concedido" : "Permission granted"): \(what)"
        case "denied": return "\(es ? "Permiso denegado" : "Permission denied"): \(what)"
        case "not_run": return "\(es ? "Permiso no concedido" : "Permission not granted"): \(what)"
        default: return "\(es ? "Permiso resuelto" : "Permission resolved"): \(what)"
        }
    case "agent.started":
        return "\(es ? "Arrancó" : "Started") \(roleName(s("role"), lang))" + suffix(": ", s("description"))
    case "agent.finished":
        let role = s("role").isEmpty ? (es ? "un agente" : "an agent") : roleName(s("role"), lang)
        return "\(es ? "Terminó" : "Finished") \(role)" + (s("status").isEmpty ? "" : " (\(s("status")))")
    case "task.started":
        return s("label").isEmpty ? (es ? "Arrancó una tarea" : "Task started") : s("label")
    case "task.finished":
        let label = s("label").isEmpty ? s("id") : s("label")
        return label + (s("status").isEmpty ? "" : " (\(s("status")))")
    case "plan.ready":
        let total = d["items"]?.array.map { String($0.count) } ?? s("total")
        return es ? "Plan listo: \(total) ítems" : "Plan ready: \(total) items"
    case "item.started":
        let redesign = d["reversal"]?.bool == true ? (es ? " (rediseño)" : " (redesign)") : ""
        return "\(es ? "Ítem" : "Item") \(s("n")): \(s("title"))" + redesign
    case "item.verified":
        return "\(es ? "Ítem" : "Item") \(s("n")): tests \(s("result"))"
    case "item.reviewed":
        let review = es ? "revisión" : "review"
        let findings = s("findings").isEmpty ? "" : " (\(s("findings")) \(es ? "hallazgos" : "findings"))"
        return "\(es ? "Ítem" : "Item") \(s("n")): \(review) \(s("verdict"))" + findings
    case "item.committed":
        let sha = shortSHA(s("sha"))
        return "\(es ? "Ítem" : "Item") \(s("n")) \(es ? "commiteado" : "committed")" + suffix(" · ", sha) + suffix(": ", s("title"))
    case "debate.turn":
        return "Debate \(Stage.label(of: s("stage"), lang)): \(s("role")) \(es ? "ronda" : "round") \(s("round")) → \(s("verdict"))"
    case "assumption":
        return "\(es ? "Supuesto" : "Assumption"): \(s("text"))"
    case "decision":
        return "\(es ? "Decisión" : "Decision") (\(byWhom(s("by"), lang))): \(s("text"))"
    case "corrected":
        return "\(es ? "Corregido" : "Corrected"): \(s("text"))"
    case "doing":
        return s("text")
    case "blocked":
        return "\(es ? "Bloqueado" : "Blocked"): \(s("reason"))"
    case "unblocked":
        switch s("by") {
        case "answer": return es ? "Desbloqueado con tu respuesta" : "Unblocked by your answer"
        case "message": return es ? "Desbloqueado con tu mensaje" : "Unblocked by your message"
        default: return es ? "Desbloqueado" : "Unblocked"
        }
    case "stalled":
        return es ? "Se detuvo sin nada pendiente; se lo reactivó" : "Stopped with nothing pending; woken up"
    case "pause.requested":
        return es ? "Pausa pedida" : "Pause requested"
    case "paused":
        return (es ? "Pausado" : "Paused") + suffix(": ", s("note"))
    case "resumed":
        return es ? "Retomado" : "Resumed"
    case "ci.updated":
        switch s("state") {
        case "passing": return es ? "CI en verde" : "CI passing"
        case "failing": return es ? "CI en rojo" : "CI failing"
        case "pending": return es ? "CI pendiente" : "CI pending"
        default: return "CI \(s("state"))"
        }
    case "pr.opened":
        let draft = d["draft"]?.bool == false ? "" : " (draft)"
        guard let number = d["number"]?.int else { return "PR \(es ? "abierto" : "opened"): \(s("url"))" }
        return "PR #\(number) \(es ? "abierto" : "opened")" + draft
    case "pr.ready":
        return es ? "PR listo para revisión" : "PR ready for review"
    case "review.waiting":
        return es ? "PR listo, en revisión" : "PR ready, in review"
    case "pr.merged":
        return es ? "PR mergeado" : "PR merged"
    case "pr.review_state":
        guard case .object(let fields)? = d["review"] else { return es ? "PR: review actualizado" : "PR: review updated" }
        return "PR: " + reviewBadge(Run.Review(json: fields), lang: es ? .es : .en).title
    case "pr.merge_state":
        var parts: [String] = []
        if d["conflicts"]?.bool == true { parts.append(es ? "tiene conflictos con la base" : "conflicts with its base") }
        if d["conflicts"]?.bool == false, d["was_conflicting"]?.bool == true {
            parts.append(es ? "ya no tiene conflictos" : "no longer conflicts")
        }
        if case .object(let queue)? = d["queue"] {
            let place = queue["position"]?.int.map { es ? " (\($0).º)" : " (#\($0))" } ?? ""
            parts.append((es ? "en la merge queue" : "in the merge queue") + place)
        } else if d["was_queued"]?.bool == true {
            parts.append(es ? "salió de la merge queue" : "left the merge queue")
        }
        return "PR " + parts.joined(separator: " · ")
    case "pr.closed":
        return es ? "PR cerrado sin mergear" : "PR closed without merging"
    case "signing.deferred":
        return es
            ? "Ítem \(s("n")) commiteado sin firma (se firma antes del push)" + suffix(" · ", shortSHA(s("sha")))
            : "Item \(s("n")) committed unsigned (signed before the push)" + suffix(" · ", shortSHA(s("sha")))
    case "signing.done":
        return "\(es ? "Commits firmados" : "Commits signed"): \(s("count"))"
    case "github.published":
        let summary = s("mode") == "summary" ? (es ? " (resumen)" : " (summary)") : ""
        return "GitHub \(s("kind"))\(summary): \(s("url"))"
    case "adapter.ran":
        let failed = d["ok"]?.bool == false
        let result = [s("state"), s("message")].first { !$0.isEmpty } ?? (failed ? "error" : "ok")
        return "\(es ? "Adaptador" : "Adapter") \(s("point")): \(result)"
    case "adapter.started":
        return "\(es ? "Adaptador" : "Adapter") \(s("point")): \(es ? "corre en segundo plano" : "runs in the background")"
    case "mockup.published":
        let files = d["files"]?.array?.compactMap(\.string).joined(separator: ", ") ?? ""
        return "Mockup: " + (s("url").isEmpty ? files : s("url"))
    case "screenshot.saved":
        return "\(es ? "Captura" : "Screenshot"): \(s("caption"))"
    case "usage":
        return usageLine(event, lang: lang)
    case "time":
        return timeLine(event, lang: lang)
    case "run.finished":
        let outcome = s("outcome").isEmpty ? "done" : s("outcome")
        let words = RunStatus(rawValue: outcome).label(lang).lowercased()
        return "\(es ? "Run terminado" : "Run finished"): \(words)" + suffix(". ", s("summary"))
    default:
        let detail = ["text", "message", "reason", "note"].lazy.map(s).first { !$0.isEmpty } ?? ""
        return "\(es ? "Evento" : "Event") \(event.type)" + suffix(": ", detail)
    }
}

/// The gate outcome under a gate's stage row: "aprobado por vos", "pasó solo", "cambios pedidos", "te espera".
public func gateNote(_ gate: Run.Gate, lang: Lang) -> String {
    outcomeNote(gate.outcome, by: gate.by, lang: lang)
}

private func outcomeNote(_ outcome: String?, by: String?, lang: Lang) -> String {
    let es = lang == .es
    switch outcome {
    case "approved"?:
        if isAutomatic(by) { return es ? "pasó solo" : "passed on its own" }
        return es ? "aprobado por vos" : "approved by you"
    case "changes"?: return es ? "cambios pedidos" : "changes requested"
    case "rejected"?: return es ? "rechazado" : "rejected"
    case let other?: return other
    case nil: return es ? "te espera" : "waiting for you"
    }
}

/// `$1.25`, or `<$0.01` for a cost that rounds to nothing.
public func usdText(_ usd: Double) -> String {
    if usd > 0 && usd < 0.005 { return "<$0.01" }
    return String(format: "$%.2f", usd)
}

/// `812`, `42.7k`, `1.7M`.
public func tokensText(_ tokens: Int) -> String {
    if tokens < 1000 { return "\(tokens)" }
    if tokens < 1_000_000 { return compact(Double(tokens) / 1000) + "k" }
    return compact(Double(tokens) / 1_000_000) + "M"
}

private func compact(_ value: Double) -> String {
    let text = String(format: "%.1f", value)
    return text.hasSuffix(".0") ? String(text.dropLast(2)) : text
}

private func suffix(_ separator: String, _ text: String) -> String {
    text.isEmpty ? "" : separator + text
}

private func shortSHA(_ sha: String) -> String {
    String(sha.prefix(7))
}

private func isAutomatic(_ by: String?) -> Bool {
    by == "auto" || by == "claude"
}

private func byWhom(_ by: String, _ lang: Lang) -> String {
    if isAutomatic(by) { return lang == .es ? "automático" : "automatic" }
    return lang == .es ? "vos" : "you"
}

private func gateNoun(_ gate: String, _ lang: Lang) -> String {
    switch gate {
    case "gate_a": return lang == .es ? "el spec" : "the spec"
    case "gate_b": return lang == .es ? "el PR" : "the PR"
    default: return gate
    }
}

private func gateResolvedLine(gate: String, outcome rawOutcome: String, by: String, lang: Lang) -> String {
    let es = lang == .es
    let outcome = rawOutcome.isEmpty ? "approved" : rawOutcome
    let noun = gateNoun(gate, lang)
    if isAutomatic(by) {
        if outcome == "approved" {
            return es ? "\(capitalized(noun)) pasó solo" : "\(capitalized(noun)) passed on its own"
        }
        return "\(Stage.label(of: gate, lang)): \(outcomeNote(outcome, by: by, lang: lang)) (\(byWhom(by, lang)))"
    }
    switch outcome {
    case "approved": return es ? "Aprobaste \(noun)" : "You approved \(noun)"
    case "changes": return es ? "Pediste cambios en \(noun)" : "You asked for changes to \(noun)"
    case "rejected": return es ? "Rechazaste \(noun)" : "You rejected \(noun)"
    default: return "\(Stage.label(of: gate, lang)): \(outcome)"
    }
}

private func capitalized(_ text: String) -> String {
    text.prefix(1).uppercased() + text.dropFirst()
}

private func answerLine(_ event: RunEvent, lang: Lang) -> String {
    let es = lang == .es
    if event.data["answered"]?.bool == false {
        return es ? "Cerraste la pregunta sin responder" : "You dismissed the question"
    }
    var parts: [String] = (event.data["pairs"]?.array ?? []).map { pair in
        let header = pair["header"]?.text ?? ""
        let answer = pair["answer"]?.text ?? ""
        let shown = answer.isEmpty ? (es ? "(sin respuesta)" : "(no answer)") : answer
        return (header.isEmpty ? "" : "\(header): ") + "\(pair["question"]?.text ?? "") → \(shown)"
    }
    let response = event.text("response")
    if !response.isEmpty { parts.append("\(es ? "Respuesta libre" : "Free answer"): \(response)") }
    return parts.isEmpty ? (es ? "Respondiste" : "You answered") : parts.joined(separator: " · ")
}

private func permissionSubject(_ event: RunEvent) -> String {
    event.text("tool") + suffix(" · ", event.text("what"))
}

private func usageLine(_ event: RunEvent, lang: Lang) -> String {
    let es = lang == .es
    let tokens = ["input", "output", "cache_read", "cache_write"].compactMap { event.data[$0]?.number }.reduce(0, +)
    let usd = event.data["usd"]?.number ?? 0
    let role = event.text("role")
    let who = role.isEmpty || role == "main" ? "" : " (\(roleName(role, lang)))"
    let stage = event.text("stage").isEmpty ? "" : " \(es ? "en" : "in") \(Stage.label(of: event.text("stage"), lang))"
    return "\(es ? "Uso" : "Usage")\(stage)\(who): \(tokensText(Int(tokens))) tokens · \(usdText(usd))"
}

private func timeLine(_ event: RunEvent, lang: Lang) -> String {
    let es = lang == .es
    let kind: String
    switch event.text("kind") {
    case "work": kind = es ? "de trabajo" : "working"
    case "agents": kind = es ? "de agentes" : "in agents"
    case "tests": kind = es ? "de tests" : "in tests"
    case "ci": kind = es ? "esperando el CI" : "waiting on CI"
    case "you": kind = es ? "esperándote" : "waiting for you"
    case "paused": kind = es ? "en pausa" : "paused"
    case let other: kind = other
    }
    let stage = event.text("stage").isEmpty ? "" : " \(es ? "en" : "in") \(Stage.label(of: event.text("stage"), lang))"
    let seconds = event.data["seconds"]?.number ?? 0
    return "\(es ? "Tiempo" : "Time") \(kind)\(stage): \(duration(seconds))"
}

/// The mod's `roleName` for one agent.
func roleName(_ role: String, _ lang: Lang) -> String {
    let names: [String: (es: String, en: String)] = [
        "explorer": ("explorador", "explorer"),
        "architect": ("arquitecto", "architect"),
        "critic": ("crítico", "critic"),
        "implementer": ("implementador", "implementer"),
        "verifier": ("verificador", "verifier"),
        "reviewer": ("revisor", "reviewer"),
        "main": ("orquestador", "orchestrator"),
        "other": ("otro agente", "other agent"),
    ]
    guard let name = names[role] else { return role }
    return lang == .es ? name.es : name.en
}
