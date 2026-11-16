import AppKit
import SwiftUI
import WololoKit

// MARK: Shapes

/// The villager's hood, AoE's status icon: the outline of `viewBox="0 0 20 22"`, fitted into the rect as an SVG is.
struct Hood: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: 10, y: 1))
        path.addCurve(to: CGPoint(x: 2, y: 10), control1: CGPoint(x: 5, y: 1), control2: CGPoint(x: 2, y: 5))
        path.addLine(to: CGPoint(x: 2, y: 21))
        path.addLine(to: CGPoint(x: 18, y: 21))
        path.addLine(to: CGPoint(x: 18, y: 10))
        path.addCurve(to: CGPoint(x: 10, y: 1), control1: CGPoint(x: 18, y: 5), control2: CGPoint(x: 15, y: 1))
        path.closeSubpath()
        return path.fitted(viewBox: CGSize(width: 20, height: 22), in: rect)
    }
}

/// The face inside the hood, in the same view box.
struct HoodFace: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: 10, y: 6))
        path.addCurve(to: CGPoint(x: 6, y: 10.5), control1: CGPoint(x: 7.5, y: 6), control2: CGPoint(x: 6, y: 8))
        path.addCurve(to: CGPoint(x: 10, y: 15), control1: CGPoint(x: 6, y: 13), control2: CGPoint(x: 8, y: 15))
        path.addCurve(to: CGPoint(x: 14, y: 10.5), control1: CGPoint(x: 12, y: 15), control2: CGPoint(x: 14, y: 13))
        path.addCurve(to: CGPoint(x: 10, y: 6), control1: CGPoint(x: 14, y: 8), control2: CGPoint(x: 12.5, y: 6))
        path.closeSubpath()
        return path.fitted(viewBox: CGSize(width: 20, height: 22), in: rect)
    }
}

/// The hood in `color` with its face in `face`, or a plain silhouette without one.
struct HoodIcon: View {
    let color: Color
    var face: Color?

    var body: some View {
        ZStack {
            Hood().fill(color)
            if let face {
                HoodFace().fill(face)
            }
        }
        .accessibilityHidden(true)
    }
}

/// A square standing on a corner, the bullet of themes that ask for `gem`.
struct Gem: View {
    let color: Color

    var body: some View {
        Rectangle()
            .fill(color)
            .frame(width: 8, height: 8)
            .rotationEffect(.degrees(45))
            .frame(width: 8, height: 8)
            .accessibilityHidden(true)
    }
}

/// The icons a theme names as `builtin:<name>`: AoE's column icons and its castle, outlines in a 22 pt view box.
struct BuiltinIcon: Shape {
    enum Name: String {
        case resisting
        case converting
        case researching
        case idle
        case unitReady
        case castle
    }

    let name: Name

    /// Nil for a name the app does not draw.
    init?(_ name: String) {
        guard let name = Name(rawValue: name) else { return nil }
        self.name = name
    }

    /// The stroke's width in the view box: scale it with the icon.
    var lineWidth: CGFloat { name == .castle ? 1.7 : 1.8 }

    func path(in rect: CGRect) -> Path {
        var path = Path()
        func line(_ points: (CGFloat, CGFloat)...) {
            path.move(to: CGPoint(x: points[0].0, y: points[0].1))
            for point in points.dropFirst() {
                path.addLine(to: CGPoint(x: point.0, y: point.1))
            }
        }
        let ring = CGRect(x: 2.5, y: 2.5, width: 17, height: 17)
        switch name {
        case .resisting:
            path.addEllipse(in: ring)
            line((5, 5), (17, 17))
        case .converting:
            path.move(to: CGPoint(x: 19, y: 8))
            path.addSVGArc(to: CGPoint(x: 5, y: 5), radius: 8, sweep: false)
            path.addLine(to: CGPoint(x: 3, y: 7))
            line((3, 3), (3, 7), (7, 7))
            path.move(to: CGPoint(x: 3, y: 14))
            path.addSVGArc(to: CGPoint(x: 17, y: 17), radius: 8, sweep: false)
            path.addLine(to: CGPoint(x: 19, y: 15))
            line((19, 19), (19, 15), (15, 15))
        case .researching:
            // An hourglass: the run waits on others' time, the reviewers'.
            line((5, 2), (17, 2))
            line((5, 20), (17, 20))
            line((6, 2), (6, 5), (11, 11), (16, 5), (16, 2))
            line((6, 20), (6, 17), (11, 11), (16, 17), (16, 20))
        case .idle:
            path.addEllipse(in: ring)
            line((8.5, 7.5), (8.5, 14.5))
            line((13.5, 7.5), (13.5, 14.5))
        case .unitReady:
            path.move(to: CGPoint(x: 3, y: 2))
            path.addLine(to: CGPoint(x: 19, y: 2))
            path.addLine(to: CGPoint(x: 19, y: 11))
            path.addCurve(to: CGPoint(x: 11, y: 20), control1: CGPoint(x: 19, y: 16), control2: CGPoint(x: 15, y: 18))
            path.addCurve(to: CGPoint(x: 3, y: 11), control1: CGPoint(x: 7, y: 18), control2: CGPoint(x: 3, y: 16))
            path.closeSubpath()
            line((7, 10), (10, 13), (15, 7))
        case .castle:
            line((3, 20), (3, 4), (6, 4), (6, 6), (9, 6), (9, 4), (13, 4), (13, 6), (16, 6), (16, 4), (19, 4), (19, 20))
            path.closeSubpath()
            path.move(to: CGPoint(x: 9, y: 20))
            path.addLine(to: CGPoint(x: 9, y: 15))
            path.addSVGArc(to: CGPoint(x: 13, y: 15), radius: 2, sweep: true)
            path.addLine(to: CGPoint(x: 13, y: 20))
        }
        return path.fitted(viewBox: CGSize(width: 22, height: 22), in: rect)
    }
}

private extension Path {
    /// The path, drawn in a `viewBox` of this size, scaled evenly and centered in `rect`: SVG's default
    /// `preserveAspectRatio`.
    func fitted(viewBox: CGSize, in rect: CGRect) -> Path {
        let scale = min(rect.width / viewBox.width, rect.height / viewBox.height)
        let x = rect.midX - viewBox.width * scale / 2
        let y = rect.midY - viewBox.height * scale / 2
        return applying(CGAffineTransform(a: scale, b: 0, c: 0, d: scale, tx: x, ty: y))
    }

    /// SVG's `A r r 0 0 sweep x y`: a circular arc of less than half a turn from the current point to `end`, with
    /// `sweep` true going the way the angles grow (clockwise on screen).
    mutating func addSVGArc(to end: CGPoint, radius: CGFloat, sweep: Bool) {
        guard let start = currentPoint else { return }
        let halfX = (start.x - end.x) / 2
        let halfY = (start.y - end.y) / 2
        let half = halfX * halfX + halfY * halfY
        guard half > 0 else { return }
        let sign: CGFloat = sweep ? 1 : -1
        let factor = sign * (max(radius * radius - half, 0) / half).squareRoot()
        let center = CGPoint(x: factor * halfY + (start.x + end.x) / 2, y: -factor * halfX + (start.y + end.y) / 2)
        addArc(
            center: center,
            radius: radius,
            startAngle: .radians(atan2(start.y - center.y, start.x - center.x)),
            endAngle: .radians(atan2(end.y - center.y, end.x - center.x)),
            clockwise: !sweep
        )
    }
}

// MARK: Images

/// The window's ground: the theme's color and, over it, its texture tiled from the top left corner. It goes once
/// behind a whole window, never per card.
struct ThemeGround: View {
    /// The theme's ground when nil.
    var color: Color?

    @Environment(\.theme) private var theme

    var body: some View {
        ZStack {
            color ?? theme.ground
            if let tile = theme.backgroundTile {
                Image(nsImage: tile)
                    .resizable(resizingMode: .tile)
            }
        }
        .accessibilityHidden(true)
    }
}

/// Between the sidebar and the board: the theme's divider image repeated down, or nothing when it has none (the
/// sidebar then draws its 1 pt line).
struct ThemeRod: View {
    @Environment(\.theme) private var theme

    var body: some View {
        if let rod = theme.dividerTile {
            Image(nsImage: rod.image)
                .resizable(resizingMode: .tile)
                .frame(width: rod.width)
                .frame(maxHeight: .infinity)
                .accessibilityHidden(true)
        }
    }
}

/// Under the board header and above the archive: the theme's band repeated across, or its 1 pt divider.
struct ThemeBand: View {
    @Environment(\.theme) private var theme

    var body: some View {
        if let band = theme.bandTile {
            Image(nsImage: band.image)
                .resizable(resizingMode: .tile)
                .frame(height: band.height)
                .accessibilityHidden(true)
        } else {
            theme.divider.frame(height: 1)
        }
    }
}

extension View {
    /// The box on `fill` inside the theme's 9-slice frame, as CSS `border-image` with `background-clip:
    /// padding-box`: the frame adds its width on every side. Without a frame, `otherwise` draws the box.
    @ViewBuilder
    func themeFrame<Framed: View>(_ theme: AppTheme, fill: Color, otherwise: (Self) -> Framed) -> some View {
        if let frame = theme.frameImage {
            self
                .background(fill)
                .padding(frame.width)
                .background {
                    Image(nsImage: frame.image)
                        .resizable(capInsets: EdgeInsets(top: frame.width, leading: frame.width, bottom: frame.width,
                                                         trailing: frame.width),
                                   resizingMode: .tile)
                }
        } else {
            otherwise(self)
        }
    }
}
