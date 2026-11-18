import SwiftUI
import WololoKit

/// What Planificación shows beside its sidebar: the chosen goal's canvas, how to get one, or with no projects at all a
/// "Nuevo proyecto" button.
struct PlanningView: View {
    let state: AppState

    @Environment(\.theme) private var theme

    var body: some View {
        if let goal = state.selectedGoal {
            GoalCanvas(state: state, goalID: goal.id)
                .id(goal.id)
        } else if state.projects.isEmpty {
            VStack(spacing: 14) {
                Text("Todavía no hay proyectos")
                    .font(theme.font(.display, size: 16, weight: .semibold))
                    .tracking(theme.tracking(.display, size: 16))
                    .foregroundStyle(theme.title)
                Text("Un proyecto es una carpeta con su repo. Creá uno para armar sus objetivos, "
                     + "o arrancá un run y aparece solo.")
                    .font(theme.font(.body, size: 13))
                    .foregroundStyle(theme.muted)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 360)
                Button {
                    state.projectSheet = .create
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "plus").font(.system(size: 11, weight: .bold))
                        Text("Nuevo proyecto").font(theme.font(.body, size: 13, weight: .semibold))
                    }
                    .foregroundStyle(theme.ground)
                    .padding(.horizontal, 14)
                    .frame(height: 32)
                    .background(theme.accent, in: RoundedRectangle(cornerRadius: theme.r(8)))
                    .contentShape(RoundedRectangle(cornerRadius: theme.r(8)))
                }
                .buttonStyle(.plain)
            }
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            Text("Elegí un objetivo, o creá uno con + Objetivo")
                .font(theme.font(.body, size: 14))
                .foregroundStyle(theme.faint)
                .multilineTextAlignment(.center)
                .padding(24)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}
