import SwiftUI
import WololoKit

/// What Planificación shows beside its sidebar: the chosen goal's canvas, or how to get one.
struct PlanningView: View {
    let state: AppState

    @Environment(\.theme) private var theme

    var body: some View {
        if let goal = state.selectedGoal {
            GoalCanvas(state: state, goalID: goal.id)
                .id(goal.id)
        } else {
            Text(state.projects.isEmpty
                 ? "Creá un proyecto con + para empezar a planificar"
                 : "Elegí un objetivo, o creá uno con + Objetivo")
                .font(theme.font(.body, size: 14))
                .foregroundStyle(theme.faint)
                .multilineTextAlignment(.center)
                .padding(24)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}
