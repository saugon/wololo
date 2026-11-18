import SwiftUI
import WololoKit

/// The canvas's arrows, drawn in screen points so lines and dashes keep their width at any zoom: satisfied ones solid
/// and grey, blocking ones dashed and red, pending ones into the goal dashed and grey (spec 15). The selected arrow is
/// drawn in the focus color, and so is the arrow being dragged out of a node.
struct EdgeLayer: View {
    let goal: Goal
    let status: GoalStatus
    let viewport: Viewport
    let selected: GoalEdge?
    /// The arrow being dragged: from the handle to the pointer, in screen points.
    let pending: (from: CGPoint, to: CGPoint)?

    @Environment(\.theme) private var theme

    var body: some View {
        Canvas { context, _ in
            for edge in goal.edges {
                guard let source = goal.rect(of: edge.from), let target = goal.rect(of: edge.to) else { continue }
                let curve = edgeCurve(from: source, to: target)
                let points = [curve.start, curve.control1, curve.control2, curve.end].map(screen)
                let isSelected = edge == selected
                let kind = status.kind(of: edge) ?? .pendingToGoal
                let color = isSelected ? theme.focus : color(of: kind)
                let dash: [CGFloat] = kind == .satisfied || isSelected ? [] : [5, 5]
                draw(points, color: color, width: isSelected ? 2.5 : 1.75, dash: dash, in: &context)
            }
            if let pending {
                let dx = max(40 * viewport.zoom, abs(pending.to.x - pending.from.x) / 2)
                let points = [pending.from, CGPoint(x: pending.from.x + dx, y: pending.from.y),
                              CGPoint(x: pending.to.x - dx, y: pending.to.y), pending.to]
                draw(points, color: theme.focus, width: 1.75, dash: [], in: &context)
            }
        }
        .allowsHitTesting(false)
    }

    private func color(of kind: EdgeKind) -> Color {
        switch kind {
        case .satisfied: return theme.pendingMark
        case .blocking: return theme.style(.blocked).color
        case .pendingToGoal: return theme.pendingMark.opacity(0.75)
        }
    }

    private func screen(_ point: CanvasPoint) -> CGPoint {
        let p = viewport.toScreen(point)
        return CGPoint(x: p.x, y: p.y)
    }

    /// A cubic curve through the four points, ending in an arrowhead whose tip is the last point.
    private func draw(_ points: [CGPoint], color: Color, width: CGFloat, dash: [CGFloat], in context: inout GraphicsContext) {
        let head: CGFloat = 9
        let start = points[0], control1 = points[1], control2 = points[2], end = points[3]
        let dx = end.x - control2.x, dy = end.y - control2.y
        let length = max((dx * dx + dy * dy).squareRoot(), 0.001)
        let ux = dx / length, uy = dy / length
        // The line stops at the arrowhead's base, so its round cap doesn't poke past the tip.
        let base = CGPoint(x: end.x - ux * (head - 1), y: end.y - uy * (head - 1))
        var line = Path()
        line.move(to: start)
        line.addCurve(to: base, control1: control1, control2: control2)
        context.stroke(line, with: .color(color), style: StrokeStyle(lineWidth: width, lineCap: .round, dash: dash))

        var arrow = Path()
        arrow.move(to: end)
        arrow.addLine(to: CGPoint(x: end.x - ux * head - uy * head / 2, y: end.y - uy * head + ux * head / 2))
        arrow.addLine(to: CGPoint(x: end.x - ux * head + uy * head / 2, y: end.y - uy * head - ux * head / 2))
        arrow.closeSubpath()
        context.fill(arrow, with: .color(color))
    }
}

/// The canvas's dotted ground: a dot every 20 canvas units, moving and scaling with the viewport. When zoomed out so
/// far that the dots would crowd, it draws every other one.
struct DotGrid: View {
    let viewport: Viewport

    @Environment(\.theme) private var theme

    var body: some View {
        Canvas { context, size in
            var spacing = 20 * viewport.zoom
            while spacing < 10 { spacing *= 2 }
            let radius = max(0.75, min(1.25, viewport.zoom))
            let startX = viewport.offset.x.truncatingRemainder(dividingBy: spacing) - spacing
            let startY = viewport.offset.y.truncatingRemainder(dividingBy: spacing) - spacing
            var dots = Path()
            var y = startY
            while y <= size.height + spacing {
                var x = startX
                while x <= size.width + spacing {
                    dots.addEllipse(in: CGRect(x: x - radius, y: y - radius, width: radius * 2, height: radius * 2))
                    x += spacing
                }
                y += spacing
            }
            context.fill(dots, with: .color(theme.divider))
        }
        .allowsHitTesting(false)
    }
}
