import SwiftUI
import WololoKit

/// The goal's header: its title, renamed in place (also from "Renombrar" in the sidebar), the "web · acme/web · 2 de 7
/// pasos hechos" line, and "Ordenar" and "+ Nodo". While the title is being edited, ⌫ and Escape are the field's, not
/// the canvas's.
struct GoalHeader: View {
    let state: AppState
    let goal: Goal
    let subtitle: String
    let arrange: () -> Void
    let addNode: () -> Void

    @Environment(\.theme) private var theme
    @FocusState private var isTitleFocused: Bool

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                TextField("Sin título", text: title)
                    .textFieldStyle(.plain)
                    .font(theme.font(.display, size: 18, weight: .semibold))
                    .tracking(theme.tracking(.display, size: 18))
                    .foregroundStyle(theme.title)
                    .focused($isTitleFocused)
                    .onSubmit { isTitleFocused = false }
                    .accessibilityLabel("Título del objetivo")
                    .accessibilityAddTraits(.isHeader)
                Text(subtitle)
                    .font(theme.font(.body, size: 12))
                    .foregroundStyle(theme.muted)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(WindowDragArea())
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            HeaderButton(title: "Ordenar", isAccent: false, action: arrange)
                .help("Acomodar los nodos por capas")
            HeaderButton(title: "Nodo", isAccent: true, action: addNode)
                .help("Agregar un paso en un lugar libre")
        }
        .padding(.horizontal, 20)
        .padding(.top, MainView.titleBarHeight)
        .padding(.bottom, 12)
        .onChange(of: isTitleFocused) { state.isTextFocused = isTitleFocused }
        .onAppear { takeRenameRequest() }
        .onChange(of: state.renameGoalRequest) { takeRenameRequest() }
        .onDisappear { if isTitleFocused { state.isTextFocused = false } }
    }

    /// "Renombrar" in the sidebar asked for this goal's title: the focus goes to it.
    private func takeRenameRequest() {
        guard state.renameGoalRequest == goal.id else { return }
        state.renameGoalRequest = nil
        DispatchQueue.main.async { isTitleFocused = true }
    }

    private var title: Binding<String> {
        Binding(
            get: { goal.title },
            set: { newValue in
                guard var latest = state.goal(id: goal.id), latest.title != newValue else { return }
                latest.title = newValue
                state.updateText(goal: latest)
            }
        )
    }
}

/// "Ordenar" (secondary) and "+ Nodo" (the accent).
private struct HeaderButton: View {
    let title: String
    let isAccent: Bool
    let action: () -> Void

    @Environment(\.theme) private var theme

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: theme.r(8))
        Button(action: action) {
            HStack(spacing: 6) {
                if isAccent {
                    Image(systemName: "plus").font(.system(size: 11, weight: .bold))
                }
                Text(title)
                    .font(theme.font(.body, size: 13, weight: isAccent ? .semibold : .regular))
            }
            .foregroundStyle(isAccent ? theme.ground : theme.secondary)
            .padding(.horizontal, 12)
            .frame(height: 30)
            .background(isAccent ? theme.accent : theme.field, in: shape)
            .overlay { if !isAccent { shape.strokeBorder(theme.border, lineWidth: 1) } }
            .contentShape(shape)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(isAccent ? "Agregar nodo" : title)
    }
}
