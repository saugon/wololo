import SwiftUI
import WololoKit

/// A run on the board, as the reference draws it: the status icon and the title, the repo, the status and what the
/// run is doing, the stage with the PR, agents and age, and the progress bar along the bottom edge.
struct RunCard: View {
    let run: Run
    let now: TimeInterval
    let isSelected: Bool
    let select: () -> Void

    @State private var isHovered = false
    @Environment(\.theme) private var theme

    var body: some View {
        let status = effectiveStatus(run, now: now)
        let style = theme.style(status)
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 9) {
                HStack(alignment: .top, spacing: 8) {
                    statusIcon(status, color: style.color)
                    Text(run.displayTitle)
                        .font(theme.font(.body, size: 15, weight: .semibold))
                        .foregroundStyle(theme.title)
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                Text(originLabel(run))
                    .font(theme.font(.mono, size: 12))
                    .foregroundStyle(theme.muted)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .help(run.project.branch ?? run.project.display)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 7) {
                        bullet(style.color)
                        Text(status.label(run.lang))
                            .font(theme.font(.body, size: 13, weight: .bold))
                            .foregroundStyle(style.color)
                            .lineLimit(1)
                    }
                    let activity = activityLine(run, now: now, prefixed: false)
                    if !activity.isEmpty {
                        Text(activity)
                            .font(theme.font(.body, size: 14))
                            .foregroundStyle(style.activity)
                            .lineSpacing(2)
                            .lineLimit(2)
                            .truncationMode(.tail)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                meta
            }
            .padding(.horizontal, 10)
            .padding(.top, 9)
            .padding(.bottom, 8)

            progressBar
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .themeFrame(theme, fill: isHovered ? theme.surfaceHover : theme.surface) { card in
            card
                .background(isHovered ? theme.surfaceHover : theme.surface)
                .clipShape(RoundedRectangle(cornerRadius: theme.r(10)))
                .overlay(
                    RoundedRectangle(cornerRadius: theme.r(10))
                        .strokeBorder(border, lineWidth: isSelected ? 1.5 : 1)
                )
        }
        .overlay {
            // In a frame the border is the theme's image; the chosen card is outlined over it.
            if theme.frameImage != nil && isSelected {
                Rectangle().strokeBorder(theme.focus, lineWidth: 2)
            }
        }
        .onHover { isHovered = $0 }
        .selectable(
            label: run.displayTitle,
            value: accessibilityValue(status),
            isSelected: isSelected,
            cornerRadius: theme.r(10),
            action: select
        )
    }

    /// What VoiceOver reads after the title, since the card is a single button: status, stage, the items, agents and
    /// PR in full, the activity with its prefix and when it changed.
    private func accessibilityValue(_ status: RunStatus) -> String {
        let parts: [String?] = [
            status.label(run.lang),
            RunProgress(run, now: now).accessibilityLabel,
            itemsChip(run)?.title,
            agentsChip(run, now: now)?.title,
            prChip(run)?.title,
            activityLine(run, now: now),
            ago(run.updatedAt, now: now, lang: run.lang),
        ]
        return parts.compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")
    }

    private var border: Color {
        if isSelected { return theme.focus }
        return isHovered ? theme.borderHover : theme.border
    }

    /// The icon left of the title: a dot centered on its first line, or a hood or the theme's image beside it.
    @ViewBuilder
    private func statusIcon(_ status: RunStatus, color: Color) -> some View {
        switch theme.spec.shapes.statusIcon {
        case .hood:
            HoodIcon(color: Color(theme.spec.hood(status)), face: theme.field)
                .frame(width: 17, height: 19)
        case .image(let asset):
            if let image = theme.image(asset) {
                Image(nsImage: image)
                    .resizable()
                    .interpolation(.high)
                    .scaledToFit()
                    .frame(width: 17, height: 19)
                    .accessibilityHidden(true)
            } else {
                dot(color)
            }
        case .dot:
            dot(color)
        }
    }

    private func dot(_ color: Color) -> some View {
        Circle()
            .fill(color)
            .frame(width: 8, height: 8)
            .frame(height: 18)
    }

    @ViewBuilder
    private func bullet(_ color: Color) -> some View {
        switch theme.spec.shapes.bullet {
        case .gem:
            Gem(color: color)
        case .dot:
            Circle()
                .fill(color)
                .frame(width: 7, height: 7)
                .frame(width: 8, height: 8)
        }
    }

    /// The stage and the PR on the left, the agents and the age on the right; when both do not fit on one line, the
    /// right side moves to a second line.
    private var meta: some View {
        let left = HStack(spacing: 8) {
            Text(RunProgress(run, now: now).metaText)
                .font(theme.font(.body, size: 13, weight: .semibold))
                .lineLimit(1)
                .truncationMode(.tail)
            if let pr = prLabel(run) {
                Text(pr).lineLimit(1).fixedSize()
            }
        }
        let right = HStack(spacing: 8) {
            if let agents = agentsLabel(run, now: now) {
                Text(agents).lineLimit(1).fixedSize()
            }
            Text(shortAgo(run.updatedAt, now: now, lang: run.lang))
                .lineLimit(1)
                .fixedSize()
        }
        return ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) {
                left.fixedSize()
                Spacer(minLength: 0)
                right
            }
            VStack(alignment: .trailing, spacing: 2) {
                left.frame(maxWidth: .infinity, alignment: .leading)
                right
            }
        }
        .font(theme.font(.body, size: 13))
        .foregroundStyle(theme.muted)
    }

    @ViewBuilder
    private var progressBar: some View {
        let progress = RunProgress(run, now: now)
        switch theme.spec.shapes.bar {
        case .blocks:
            ProgressBlocksView(progress: progress)
        case .continuous:
            ProgressBarView(progress: progress, height: 4, caption: .none)
        }
    }
}

/// The status pill of the run detail: the label in the run's language, on the status color.
struct StatusBadge: View {
    let status: RunStatus
    let lang: Lang

    @Environment(\.theme) private var theme

    var body: some View {
        let style = theme.style(status)
        Text(status.label(lang))
            .font(theme.font(.body, size: 11.5, weight: .semibold))
            .foregroundStyle(style.badgeText)
            .lineLimit(1)
            .fixedSize()
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(style.badge, in: Capsule())
    }
}

/// A row or card that selects a run: clickable, reachable from the keyboard (Space or Return selects it) and, for
/// VoiceOver, a single button named after the run.
private struct Selectable: ViewModifier {
    let label: String
    let value: String
    let isSelected: Bool
    let cornerRadius: CGFloat
    let action: () -> Void

    @FocusState private var isFocused: Bool
    @Environment(\.theme) private var theme

    func body(content: Content) -> some View {
        content
            .contentShape(RoundedRectangle(cornerRadius: cornerRadius))
            .onTapGesture(perform: action)
            .focusable(interactions: .activate)
            .focused($isFocused)
            .focusEffectDisabled()
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius)
                    .strokeBorder(theme.focus, lineWidth: 2)
                    .opacity(isFocused ? 1 : 0)
            )
            .onKeyPress(keys: [.space, .return]) { _ in
                action()
                return .handled
            }
            .help(label)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(label)
            .accessibilityValue(value)
            .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
            .accessibilityAction(.default, action)
    }
}

extension View {
    func selectable(label: String, value: String, isSelected: Bool, cornerRadius: CGFloat, action: @escaping () -> Void) -> some View {
        modifier(Selectable(label: label, value: value, isSelected: isSelected, cornerRadius: cornerRadius, action: action))
    }
}

extension Run {
    /// The title, or the id while the run has none yet.
    var displayTitle: String { title.isEmpty ? id : title }
}
