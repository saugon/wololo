import SwiftUI
import WololoKit

/// A run on the board: title, project and source, progress, the status badge with items, agents and PR as icons
/// with numbers, and the activity line under a divider.
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
            VStack(alignment: .leading, spacing: 12) {
                Text(run.displayTitle)
                    .font(theme.font(.display, size: 15, weight: .semibold))
                    .tracking(theme.tracking(.display, size: 15))
                    .foregroundStyle(theme.text)
                    .lineSpacing(2)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
                origin
                ProgressBarView(progress: RunProgress(run, now: now), height: 4)
                meta(status: status)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 16)

            theme.cardDivider.frame(height: 1)

            HStack(spacing: 12) {
                Text(activityLine(run, now: now))
                    .font(theme.font(.body, size: 13))
                    .foregroundStyle(style.activity)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text(ago(run.updatedAt, now: now, lang: run.lang))
                    .font(theme.font(.body, size: 12.5))
                    .foregroundStyle(theme.faint)
                    .fixedSize()
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 13)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(isHovered ? theme.surfaceHover : theme.surface, in: RoundedRectangle(cornerRadius: theme.r(10)))
        .overlay(
            RoundedRectangle(cornerRadius: theme.r(10))
                .strokeBorder(border, lineWidth: isSelected ? 1.5 : 1)
        )
        .onHover { isHovered = $0 }
        .selectable(
            label: run.displayTitle,
            value: accessibilityValue(status),
            isSelected: isSelected,
            cornerRadius: theme.r(10),
            action: select
        )
    }

    /// What VoiceOver reads after the title, since the card is a single button: status, stage, the icons' full
    /// wording, the activity and when it changed.
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

    private var origin: some View {
        HStack(spacing: 8) {
            Image(systemName: "arrow.triangle.branch")
                .font(.system(size: 11, weight: .medium))
                .frame(width: 14, height: 14)
            Text("\(run.project.display) · \(sourceLabel(run))")
                .font(theme.font(.mono, size: 12))
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .foregroundStyle(theme.muted)
        .help(run.project.branch ?? run.project.display)
    }

    /// The badge with the icons on its right; when a long badge leaves no room, the icons wrap below it.
    private func meta(status: RunStatus) -> some View {
        MetaRowLayout(spacing: 14, lineSpacing: 10) {
            StatusBadge(status: status, lang: run.lang)
            metaIcons
        }
    }

    private var metaIcons: some View {
        HStack(spacing: 14) {
            if let items = itemsChip(run) {
                MetaIcon(symbol: "checklist", chip: items, color: theme.secondary)
            }
            if let agents = agentsChip(run, now: now) {
                MetaIcon(symbol: "cpu", chip: agents, color: theme.agent)
            }
            if let pr = prChip(run) {
                MetaIcon(symbol: "arrow.triangle.pull", chip: pr, color: theme.secondary, dot: theme.ci(ciRole(run)))
            }
        }
    }
}

/// The status pill: the label in the run's language, on the status color.
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

/// An icon with its number; the tooltip and the accessibility label carry the full wording, as
/// "2 agentes: implementer, verifier".
struct MetaIcon: View {
    let symbol: String
    let chip: MetaChip
    let color: Color
    var dot: Color?

    @Environment(\.theme) private var theme

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: symbol)
                .font(.system(size: 11.5, weight: .medium))
                .frame(width: 14, height: 14)
            Text(chip.text)
                .font(theme.font(.body, size: 12).monospacedDigit())
            if let dot {
                Circle()
                    .fill(dot)
                    .frame(width: 7, height: 7)
            }
        }
        .foregroundStyle(color)
        .fixedSize()
        .contentShape(Rectangle())
        .help(chip.title)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(chip.title)
    }
}

/// The card's meta row: the badge on the left and the icons on the right of the same line, or under the badge when
/// both do not fit. Never wider than what the card offers.
struct MetaRowLayout: Layout {
    var spacing: CGFloat
    var lineSpacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let sizes = subviews.map { $0.sizeThatFits(.unspecified) }
        let oneLine = sizes.map(\.width).reduce(0, +) + spacing * CGFloat(max(sizes.count - 1, 0))
        let width = proposal.width ?? oneLine
        if fitsOnOneLine(sizes, width: width) {
            return CGSize(width: width, height: sizes.map(\.height).max() ?? 0)
        }
        let height = sizes.map(\.height).reduce(0, +) + lineSpacing * CGFloat(max(sizes.count - 1, 0))
        return CGSize(width: width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let sizes = subviews.map { $0.sizeThatFits(.unspecified) }
        if fitsOnOneLine(sizes, width: bounds.width) {
            let height = sizes.map(\.height).max() ?? 0
            for (index, subview) in subviews.enumerated() {
                // The first view (the badge) hugs the left edge; the rest line up from the right edge.
                let x: CGFloat
                if index == 0 {
                    x = bounds.minX
                } else {
                    let trailing = sizes[index...].map(\.width).reduce(0, +) + spacing * CGFloat(sizes.count - 1 - index)
                    x = bounds.maxX - trailing
                }
                subview.place(
                    at: CGPoint(x: x, y: bounds.minY + (height - sizes[index].height) / 2),
                    proposal: ProposedViewSize(sizes[index])
                )
            }
        } else {
            var y = bounds.minY
            for (index, subview) in subviews.enumerated() {
                let width = min(sizes[index].width, bounds.width)
                subview.place(at: CGPoint(x: bounds.minX, y: y), proposal: ProposedViewSize(width: width, height: sizes[index].height))
                y += sizes[index].height + lineSpacing
            }
        }
    }

    private func fitsOnOneLine(_ sizes: [CGSize], width: CGFloat) -> Bool {
        sizes.map(\.width).reduce(0, +) + spacing * CGFloat(max(sizes.count - 1, 0)) <= width
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
