import SwiftUI
import WololoKit

/// What the run is doing or waiting for: the status, the activity in large type, the other open notes (question,
/// block, current step, pause), and the agents and tasks still running.
struct NowView: View {
    let run: Run
    let now: TimeInterval

    @Environment(\.theme) private var theme

    var body: some View {
        let status = effectiveStatus(run, now: now)
        let activity = activityLine(run, now: now)
        let live = isLive(status)
        DetailCard(spacing: 12) {
            HStack(spacing: 10) {
                CardTitle("Ahora")
                    .frame(maxWidth: .infinity, alignment: .leading)
                StatusBadge(status: status, lang: run.lang, isQueued: theme.isQueued(status, run))
            }
            Text(activity.isEmpty ? "Sin actividad todavía." : activity)
                .font(theme.font(.body, size: 16, weight: .medium))
                .lineSpacing(3)
                .foregroundStyle(activity.isEmpty ? theme.faint : theme.style(status).activity)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
            if live {
                ForEach(notes(except: activity), id: \.label) { note in
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text(note.label)
                            .font(theme.font(.body, size: 12))
                            .foregroundStyle(theme.faint)
                            .frame(width: 64, alignment: .leading)
                        Text(note.text)
                            .font(theme.font(.body, size: 13))
                            .foregroundStyle(theme.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            if StatusGroup(status) == .waiting {
                Text("Se responde en la terminal de la sesión. La app solo muestra.")
                    .font(theme.font(.body, size: 13))
                    .foregroundStyle(theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if live {
                workers
            }
        }
    }

    /// Agents and tasks nothing will close once the run ended or lost its session, so they show only while it lives.
    private func isLive(_ status: RunStatus) -> Bool {
        !status.isTerminal && status != .orphaned
    }

    private struct Note {
        let label: String
        let text: String
    }

    /// The run's open notes other than the one already shown as the activity, which may carry a prefix such as
    /// "Bloqueado: ".
    private func notes(except activity: String) -> [Note] {
        [
            Note(label: "Pregunta", text: run.waiting?.question ?? ""),
            Note(label: "Bloqueo", text: run.blocked?.reason ?? ""),
            Note(label: "Haciendo", text: run.doing?.text ?? ""),
            Note(label: "Pausa", text: run.paused?.note ?? ""),
        ]
        .filter { !$0.text.isEmpty && $0.text != activity && !activity.hasSuffix(": \($0.text)") }
    }

    @ViewBuilder
    private var workers: some View {
        let agents = liveAgents(run)
        let tasks = run.tasks.filter { $0.finishedAt == nil }
        if !agents.isEmpty || !tasks.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(agents, id: \.id) { agent in
                    WorkerRow(
                        color: theme.agent,
                        name: agent.role,
                        detail: agent.model.map(shortModel),
                        since: ago(agent.startedAt, now: now, lang: run.lang),
                        help: agent.description
                    )
                }
                ForEach(tasks, id: \.id) { task in
                    WorkerRow(
                        color: theme.dot(.running),
                        name: task.label.isEmpty ? task.kind : task.label,
                        detail: task.kind,
                        since: ago(task.startedAt, now: now, lang: run.lang),
                        help: task.label
                    )
                }
            }
            .padding(.top, 12)
            .overlay(alignment: .top) {
                theme.cardDivider.frame(height: 1)
            }
        }
    }

    /// "claude-opus-5-5" reads as "opus-5-5": every model is Claude's.
    private func shortModel(_ model: String) -> String {
        model.hasPrefix("claude-") ? String(model.dropFirst("claude-".count)) : model
    }
}

private struct WorkerRow: View {
    let color: Color
    let name: String
    let detail: String?
    let since: String
    let help: String

    @Environment(\.theme) private var theme

    var body: some View {
        HStack(spacing: 10) {
            RoundedRectangle(cornerRadius: theme.r(2))
                .fill(color)
                .frame(width: 8, height: 8)
            Text(name)
                .font(theme.font(.body, size: 13))
                .foregroundStyle(theme.text)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let detail, !detail.isEmpty {
                Text(detail)
                    .font(theme.font(.mono, size: 11.5))
                    .foregroundStyle(theme.muted)
                    .lineLimit(1)
            }
            Text(since)
                .font(theme.font(.body, size: 12))
                .foregroundStyle(theme.faint)
                .lineLimit(1)
                .fixedSize()
        }
        .help(help)
        .accessibilityElement(children: .combine)
    }
}
