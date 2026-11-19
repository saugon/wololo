import AppKit
import SwiftUI
import WololoKit

/// An active run in the widget: the status dot, the title with how long ago it changed, the project beside a thin
/// PR's link and a progress bar with `n/8`, and the activity line. Clicking it opens the run's detail; the button on the right goes
/// to its terminal.
struct WidgetRow: View {
    let run: Run
    let now: TimeInterval
    let open: () -> Void
    let goToTerminal: () -> Void

    @State private var isHovered = false
    @Environment(\.theme) private var theme

    var body: some View {
        let status = effectiveStatus(run, now: now)
        let progress = RunProgress(run, now: now)
        HStack(alignment: .top, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                Circle()
                    .fill(theme.dot(status))
                    .frame(width: 8, height: 8)
                    .padding(.top, 5)
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(run.displayTitle)
                            .font(theme.font(.display, size: 13, weight: .semibold))
                            .tracking(theme.tracking(.display, size: 13))
                            .foregroundStyle(theme.text)
                            .lineLimit(1)
                            .truncationMode(.tail)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Text(shortAgo(run.updatedAt, now: now, lang: run.lang))
                            .font(theme.font(.body, size: 11.5).monospacedDigit())
                            .foregroundStyle(theme.faint)
                            .fixedSize()
                    }
                    HStack(spacing: 8) {
                        CappedWidth(width: 130) {
                            Text(run.project.display)
                                .font(theme.font(.mono, size: 11))
                                .foregroundStyle(theme.muted)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                        .layoutPriority(1)
                        .help(run.project.branch ?? run.project.display)
                        if let pr = prLink {
                            Link(pr.text, destination: pr.url)
                                .font(theme.font(.mono, size: 11, weight: .semibold))
                                .foregroundStyle(theme.accent)
                                .lineLimit(1)
                                .fixedSize()
                                .help("Abrir el PR en el navegador: \(pr.url.absoluteString)")
                        }
                        ProgressBarView(
                            progress: progress,
                            height: 3,
                            caption: .short,
                            captionFont: theme.font(.body, size: 11).monospacedDigit(),
                            spacing: 8
                        )
                    }
                    let activity = activityLine(run, now: now)
                    if !activity.isEmpty {
                        Text(activity)
                            .font(theme.font(.body, size: 12))
                            .foregroundStyle(theme.style(status).activity)
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
                cornerRadius: theme.r(6),
                action: open
            )
            // The row reads as one button to VoiceOver, so the PR is one of its actions.
            .accessibilityAction(named: "Abrir el PR") {
                if let pr = prLink { NSWorkspace.shared.open(pr.url) }
            }

            Button(action: goToTerminal) {
                Image(systemName: "terminal")
                    .font(.system(size: 13, weight: .medium))
                    .frame(width: 28, height: 28)
                    .contentShape(RoundedRectangle(cornerRadius: theme.r(6)))
            }
            .buttonStyle(WidgetIconButtonStyle(color: theme.muted))
            .help(TerminalPlan(run, now: now).triesFocus
                ? "Traer al frente la terminal de la sesión"
                : "Abrir una terminal en la carpeta del run")
            .accessibilityLabel("Ir a la terminal")
        }
        .padding(.leading, 14)
        .padding(.trailing, 12)
        .padding(.vertical, 11)
        .background(isHovered ? theme.widgetHover : Color.clear)
        .onHover { isHovered = $0 }
    }

    /// "PR #4873" and where it lives, once the run opened one with a URL.
    private var prLink: (text: String, url: URL)? {
        guard let url = prURL(run) else { return nil }
        return (prChip(run)?.text ?? "PR", url)
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
    /// The theme's secondary text color when nil.
    var color: Color?

    func makeBody(configuration: Configuration) -> some View {
        HoverBackground(isPressed: configuration.isPressed, color: color) {
            configuration.label
        }
    }

    private struct HoverBackground<Label: View>: View {
        let isPressed: Bool
        let color: Color?
        @ViewBuilder let label: () -> Label
        @State private var isHovered = false
        @Environment(\.theme) private var theme

        var body: some View {
            label()
                .foregroundStyle(color ?? theme.secondary)
                .background(
                    isPressed ? theme.borderHover : (isHovered ? theme.border : Color.clear),
                    in: RoundedRectangle(cornerRadius: theme.r(6))
                )
                .onHover { isHovered = $0 }
        }
    }
}
