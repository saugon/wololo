import SwiftUI
import WololoKit

/// What Planificación shows beside its sidebar until the canvas is drawn: the chosen goal's title and progress, or how
/// to get one.
struct PlanningPlaceholder: View {
    let state: AppState

    @Environment(\.theme) private var theme

    var body: some View {
        if let goal = state.selectedGoal {
            let project = state.project(id: goal.projectID)
            let status = goal.status(defaultRepo: project.flatMap(defaultRepo(for:)),
                                     runs: RunIndex(runs: state.model.runs), now: state.model.now)
            VStack(spacing: 0) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(goal.title.isEmpty ? "Sin título" : goal.title)
                        .font(theme.font(.display, size: 18, weight: .semibold))
                        .tracking(theme.tracking(.display, size: 18))
                        .foregroundStyle(theme.title)
                        .lineLimit(1)
                        .accessibilityAddTraits(.isHeader)
                    Text(subtitle(project, done: status.done, total: status.total))
                        .font(theme.font(.body, size: 12))
                        .foregroundStyle(theme.muted)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 20)
                .padding(.top, MainView.titleBarHeight)
                .padding(.bottom, 12)
                .background(WindowDragArea())
                ThemeBand()
                message("El canvas llega en el próximo paso")
            }
        } else {
            message(state.projects.isEmpty
                    ? "Creá un proyecto con + para empezar a planificar"
                    : "Elegí un objetivo, o creá uno con + Objetivo")
        }
    }

    /// "shop · acme/shop · 2 de 7 pasos hechos".
    private func subtitle(_ project: PlanningProject?, done: Int, total: Int) -> String {
        var parts: [String] = []
        if let project {
            parts.append(project.name)
            if let repo = defaultRepo(for: project) { parts.append(repo) }
        }
        parts.append("\(done) de \(total) \(total == 1 ? "paso hecho" : "pasos hechos")")
        return parts.joined(separator: " · ")
    }

    private func message(_ text: String) -> some View {
        Text(text)
            .font(theme.font(.body, size: 14))
            .foregroundStyle(theme.faint)
            .multilineTextAlignment(.center)
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
