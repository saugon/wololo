import SwiftUI
import WololoKit

/// A card's title, which the person can rename in place: the pencil to its right (while the cursor is over the title) turns it into a field, Return keeps
/// the new title and Esc leaves it as it was; while editing, the arrow goes back to the run's own title when it has
/// one of the person's. The title is the app's alone: the run, its session and its PR keep theirs.
struct EditableTitle<Label: View>: View {
    let run: Run
    let isEditing: Binding<Bool>
    let font: Font
    let rename: (String?) -> Void
    @ViewBuilder let label: () -> Label

    @State private var text = ""
    @State private var isHovered = false
    @FocusState private var isFocused: Bool
    @Environment(\.theme) private var theme

    var body: some View {
        if isEditing.wrappedValue {
            HStack(spacing: 6) {
                TextField(run.originalTitle, text: $text)
                    .textFieldStyle(.plain)
                    .font(font)
                    .foregroundStyle(theme.title)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 3)
                    .background(theme.surfaceHover, in: RoundedRectangle(cornerRadius: theme.r(6)))
                    .overlay(RoundedRectangle(cornerRadius: theme.r(6)).strokeBorder(theme.focus, lineWidth: 1))
                    .focused($isFocused)
                    .onSubmit(commit)
                    .onExitCommand(perform: cancel)
                    .onChange(of: isFocused) { _, focused in
                        // A click elsewhere keeps what was typed, as Return does.
                        if !focused && isEditing.wrappedValue { commit() }
                    }
                if run.customTitle != nil {
                    Button(action: revert) {
                        Image(systemName: "arrow.counterclockwise")
                            .font(.system(size: 11, weight: .semibold))
                            .frame(width: 22, height: 22)
                            .contentShape(Circle())
                    }
                    .buttonStyle(WidgetIconButtonStyle(color: theme.muted))
                    .help("Volver al título del run: \(run.originalTitle)")
                    .accessibilityLabel("Volver al título del run")
                }
            }
            .onAppear {
                text = run.displayTitle
                isFocused = true
            }
        } else {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                label()
                RenameButton(run: run, isVisible: isHovered) { isEditing.wrappedValue = true }
                    .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + 4 }
            }
            .onHover { isHovered = $0 }
        }
    }

    private func commit() {
        isEditing.wrappedValue = false
        rename(text)
    }

    private func cancel() {
        isEditing.wrappedValue = false
    }

    private func revert() {
        isEditing.wrappedValue = false
        rename(nil)
    }
}

/// The pencil to the right of a card's title, shown while the cursor is over the title.
struct RenameButton: View {
    let run: Run
    let isVisible: Bool
    let action: () -> Void

    @Environment(\.theme) private var theme

    var body: some View {
        Button(action: action) {
            Image(systemName: "pencil")
                .font(.system(size: 11, weight: .medium))
                .frame(width: 20, height: 20)
                .contentShape(RoundedRectangle(cornerRadius: theme.r(6)))
        }
        .buttonStyle(WidgetIconButtonStyle(color: theme.muted))
        .help(run.customTitle == nil ? "Cambiar el título" : "Cambiar el título (el del run: \(run.originalTitle))")
        .opacity(isVisible ? 1 : 0)
        .accessibilityHidden(true)
    }
}
