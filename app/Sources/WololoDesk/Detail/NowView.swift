import SwiftUI
import WololoKit

/// What the run is doing or waiting for: the status, the activity in large type, the other open notes (question,
/// block, current step, pause), and the agents and tasks still running.
struct NowView: View {
    let run: Run
    let now: TimeInterval

    var body: some View {
        let status = effectiveStatus(run, now: now)
        let activity = activityLine(run, now: now)
        let live = isLive(status)
        DetailCard(spacing: 12) {
            HStack(spacing: 10) {
                CardTitle("Ahora")
                    .frame(maxWidth: .infinity, alignment: .leading)
                StatusBadge(status: status, lang: run.lang)
            }
            Text(activity.isEmpty ? "Sin actividad todavía." : activity)
                .font(.system(size: 16, weight: .medium))
                .lineSpacing(3)
                .foregroundStyle(activity.isEmpty ? Theme.faint : Theme.style(status).activity)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
            if live {
                ForEach(notes(except: activity), id: \.label) { note in
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text(note.label)
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.faint)
                            .frame(width: 64, alignment: .leading)
                        Text(note.text)
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            if StatusGroup(status) == .waiting {
                Text("Se responde en la terminal de la sesión. La app solo muestra.")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.muted)
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

    /// The run's open notes other than the one already shown as the activity.
    private func notes(except activity: String) -> [Note] {
        [
            Note(label: "Pregunta", text: run.waiting?.question ?? ""),
            Note(label: "Bloqueo", text: run.blocked?.reason ?? ""),
            Note(label: "Haciendo", text: run.doing?.text ?? ""),
            Note(label: "Pausa", text: run.paused?.note ?? ""),
        ]
        .filter { !$0.text.isEmpty && $0.text != activity }
    }

    @ViewBuilder
    private var workers: some View {
        let agents = liveAgents(run)
        let tasks = run.tasks.filter { $0.finishedAt == nil }
        if !agents.isEmpty || !tasks.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(agents, id: \.id) { agent in
                    WorkerRow(
                        color: Theme.agent,
                        name: agent.role,
                        detail: agent.model.map(shortModel),
                        since: ago(agent.startedAt, now: now, lang: run.lang),
                        help: agent.description
                    )
                }
                ForEach(tasks, id: \.id) { task in
                    WorkerRow(
                        color: Theme.blue,
                        name: task.label.isEmpty ? task.kind : task.label,
                        detail: task.kind,
                        since: ago(task.startedAt, now: now, lang: run.lang),
                        help: task.label
                    )
                }
            }
            .padding(.top, 12)
            .overlay(alignment: .top) {
                Theme.cardDivider.frame(height: 1)
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

    var body: some View {
        HStack(spacing: 10) {
            RoundedRectangle(cornerRadius: 2)
                .fill(color)
                .frame(width: 8, height: 8)
            Text(name)
                .font(.system(size: 13))
                .foregroundStyle(Theme.text)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let detail, !detail.isEmpty {
                Text(detail)
                    .font(.system(size: 11.5).monospaced())
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
            }
            Text(since)
                .font(.system(size: 12))
                .foregroundStyle(Theme.faint)
                .lineLimit(1)
                .fixedSize()
        }
        .help(help)
        .accessibilityElement(children: .combine)
    }
}
