import SwiftUI
import WololoKit

/// An active run in the widget: the status dot, the title with how long ago it changed, the project beside a thin
/// progress bar with `n/8`, and the activity line. Clicking it opens the run's detail; the button on the right goes
/// to its terminal.
struct WidgetRow: View {
    let run: Run
    let now: TimeInterval
    let open: () -> Void
    let goToTerminal: () -> Void

    @State private var isHovered = false

    var body: some View {
        let status = effectiveStatus(run, now: now)
        let progress = RunProgress(run, now: now)
        HStack(alignment: .top, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                Circle()
                    .fill(Theme.dot(status))
                    .frame(width: 8, height: 8)
                    .padding(.top, 5)
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(run.displayTitle)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.text)
                            .lineLimit(1)
                            .truncationMode(.tail)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Text(shortAgo(run.updatedAt, now: now, lang: run.lang))
                            .font(.system(size: 11.5).monospacedDigit())
                            .foregroundStyle(Theme.faint)
                            .fixedSize()
                    }
                    HStack(spacing: 8) {
                        CappedWidth(width: 130) {
                            Text(run.project.display)
                                .font(.system(size: 11).monospaced())
                                .foregroundStyle(Theme.muted)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                        .layoutPriority(1)
                        .help(run.project.branch ?? run.project.display)
                        ProgressBarView(
                            progress: progress,
                            height: 3,
                            caption: .short,
                            captionFont: .system(size: 11).monospacedDigit(),
                            spacing: 8
                        )
                    }
                    let activity = activityLine(run, now: now)
                    if !activity.isEmpty {
                        Text(activity)
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.style(status).activity)
                            .lineLimit(1)
                            .truncationMode(.tail)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .selectable(
                label: run.displayTitle,
                value: accessibilityValue(status, progress: progress),
                isSelected: false,
                cornerRadius: 6,
                action: open
            )

            Button(action: goToTerminal) {
                Image(systemName: "terminal")
                    .font(.system(size: 13, weight: .medium))
                    .frame(width: 28, height: 28)
                    .contentShape(RoundedRectangle(cornerRadius: 6))
            }
            .buttonStyle(WidgetIconButtonStyle(color: Theme.muted))
            .help(TerminalPlan(run, now: now).triesFocus
                ? "Traer al frente la terminal de la sesión"
                : "Abrir una terminal en la carpeta del run")
            .accessibilityLabel("Ir a la terminal")
        }
        .padding(.leading, 14)
        .padding(.trailing, 12)
        .padding(.vertical, 11)
        .background(isHovered ? Theme.widgetHover : Color.clear)
        .onHover { isHovered = $0 }
    }

    /// What VoiceOver reads after the title: status, project, stage, activity and when it changed.
    private func accessibilityValue(_ status: RunStatus, progress: RunProgress) -> String {
        let parts = [
            status.label(run.lang),
            run.project.display,
            progress.accessibilityLabel,
            activityLine(run, now: now),
            ago(run.updatedAt, now: now, lang: run.lang),
        ]
        return parts.filter { !$0.isEmpty }.joined(separator: ", ")
    }
}

/// Its one view at its own width, but never wider than `width`: a short project name keeps its size, a long one
/// truncates and leaves the progress bar its room.
private struct CappedWidth: Layout {
    let width: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let capped = min(proposal.width ?? width, width)
        return subviews.first?.sizeThatFits(ProposedViewSize(width: capped, height: proposal.height)) ?? .zero
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        subviews.first?.place(at: bounds.origin, proposal: ProposedViewSize(bounds.size))
    }
}

/// The widget's square icon buttons: the glyph alone, with a rounded background under the pointer or while pressed.
struct WidgetIconButtonStyle: ButtonStyle {
    var color: Color = Theme.secondary

    func makeBody(configuration: Configuration) -> some View {
        HoverBackground(isPressed: configuration.isPressed) {
            configuration.label
                .foregroundStyle(color)
        }
    }

    private struct HoverBackground<Label: View>: View {
        let isPressed: Bool
        @ViewBuilder let label: () -> Label
        @State private var isHovered = false

        var body: some View {
            label()
                .background(
                    isPressed ? Theme.hoverBorder : (isHovered ? Theme.border : Color.clear),
                    in: RoundedRectangle(cornerRadius: 6)
                )
                .onHover { isHovered = $0 }
        }
    }
}
