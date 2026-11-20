import SwiftUI
import WololoKit

/// A step on the canvas, at its canvas size (`GoalNodeMetrics.stepSize`) times `scale`: the status in small caps with
/// its mark, the title and the mono meta line. A blocked step is dashed and dimmer, so what can start stands out.
/// The canvas draws it at its largest zoom and scales it down, since a view scaled up is a stretched picture of itself
/// and blurs, while one scaled down stays sharp.
struct NodeCard: View {
    let node: GoalNode
    let status: NodeStatus?
    let meta: String
    let isSelected: Bool
    /// Lit while a new arrow is dragged over it and would be accepted.
    let isDropTarget: Bool
    var scale: CGFloat = 1

    @Environment(\.theme) private var theme

    var body: some View {
        let state = status?.state ?? .pending
        let isBlocked: Bool = {
            if case .blocked = state { return true }
            return false
        }()
        let color = NodeColors.color(of: state, theme: theme)
        let k = scale
        let shape = RoundedRectangle(cornerRadius: theme.r(10) * k)
        VStack(alignment: .leading, spacing: 4 * k) {
            HStack(spacing: 6 * k) {
                NodeMark(state: state, color: color, scale: k)
                Text(state.cardLabel.uppercased())
                    .font(theme.font(.body, size: 10.5 * k, weight: .bold))
                    .tracking(0.3 * k)
                    .minimumScaleFactor(0.8)
                    .foregroundStyle(color)
            }
            Text(node.title.isEmpty ? "Sin título" : node.title)
                .font(theme.font(.display, size: 13.5 * k, weight: .semibold))
                .tracking(theme.tracking(.display, size: 13.5 * k))
                .foregroundStyle(isBlocked ? theme.secondary : theme.text)
            Text(meta)
                .font(theme.font(.mono, size: 11 * k))
                .foregroundStyle(theme.muted)
        }
        .lineLimit(1)
        .truncationMode(.tail)
        .padding(.horizontal, 12 * k)
        .padding(.vertical, 10 * k)
        .frame(width: GoalNodeMetrics.stepSize.width * k, height: GoalNodeMetrics.stepSize.height * k, alignment: .topLeading)
        .background(isBlocked ? theme.ground : theme.surface, in: shape)
        .overlay {
            shape.strokeBorder(isBlocked ? color.opacity(0.4) : theme.border,
                               style: StrokeStyle(lineWidth: 1 * k, dash: isBlocked ? [4 * k, 3 * k] : []))
        }
        .opacity(isBlocked ? 0.85 : 1)
        .overlay {
            if isSelected || isDropTarget {
                RoundedRectangle(cornerRadius: (theme.r(10) + 2) * k)
                    .strokeBorder(theme.focus, lineWidth: 2 * k)
                    .padding(-2 * k)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// The goal itself, drawn last as a pill (`GoalNodeMetrics.finalSize`): "Objetivo" over its title. It takes the done
/// color once everything that reaches it is done.
struct FinalNodeCard: View {
    let title: String
    let isDone: Bool
    let isSelected: Bool
    let isDropTarget: Bool
    /// As `NodeCard.scale`.
    var scale: CGFloat = 1

    @Environment(\.theme) private var theme

    var body: some View {
        let k = scale
        let pill = RoundedRectangle(cornerRadius: GoalNodeMetrics.finalSize.height / 2 * k, style: .circular)
        VStack(spacing: 5 * k) {
            Text("OBJETIVO")
                .font(theme.font(.body, size: 10 * k, weight: .bold))
                .tracking(0.8 * k)
                .foregroundStyle(isDone ? theme.style(.done).color : theme.muted)
            Text(title.isEmpty ? "Sin título" : title)
                .font(theme.font(.display, size: 13 * k, weight: .semibold))
                .tracking(theme.tracking(.display, size: 13 * k))
                .foregroundStyle(theme.title)
                .multilineTextAlignment(.center)
                .lineLimit(2)
        }
        .padding(.horizontal, 14 * k)
        .padding(.vertical, 10 * k)
        .frame(width: GoalNodeMetrics.finalSize.width * k, height: GoalNodeMetrics.finalSize.height * k)
        .background(theme.surfaceHover, in: pill)
        .overlay { pill.strokeBorder(isDone ? theme.style(.done).color : theme.borderHover, lineWidth: 1 * k) }
        .overlay {
            if isSelected || isDropTarget {
                RoundedRectangle(cornerRadius: (GoalNodeMetrics.finalSize.height / 2 + 2) * k, style: .circular)
                    .strokeBorder(theme.focus, lineWidth: 2 * k)
                    .padding(-2 * k)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// The colors a node's state takes, from the statuses the board already paints (spec 19): in progress like a running
/// run, in review, done and blocked like theirs; pending and ready stay neutral.
enum NodeColors {
    static func color(of state: NodeState, theme: AppTheme) -> Color {
        switch state {
        case .doing: return theme.style(.running).color
        case .review: return theme.style(.inReview).color
        case .done: return theme.style(.done).color
        case .blocked: return theme.style(.blocked).color
        case .ready: return theme.secondary
        case .pending: return theme.muted
        }
    }
}

/// The mark before the status label: a check when done, a play triangle when ready, a lock when blocked, and a dot
/// otherwise.
private struct NodeMark: View {
    let state: NodeState
    let color: Color
    let scale: CGFloat

    var body: some View {
        let k = scale
        Group {
            switch state {
            case .done:
                Image(systemName: "checkmark").font(.system(size: 8.5 * k, weight: .heavy))
            case .ready:
                Image(systemName: "play.fill").font(.system(size: 7.5 * k))
            case .blocked:
                Image(systemName: "lock").font(.system(size: 8.5 * k, weight: .bold))
            case .pending:
                Circle().strokeBorder(color, lineWidth: 1.5 * k).frame(width: 7 * k, height: 7 * k)
            case .doing, .review:
                Circle().fill(color).frame(width: 7 * k, height: 7 * k)
            }
        }
        .foregroundStyle(color)
        .frame(width: 11 * k, height: 11 * k)
    }
}
