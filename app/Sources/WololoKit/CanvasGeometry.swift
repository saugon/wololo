import Foundation

/// A size in canvas (or screen) units. WololoKit stays free of CoreGraphics, so the canvas math has its own
/// small value types that the view converts at the edge.
public struct CanvasSize: Equatable, Sendable {
    public var width: Double
    public var height: Double

    public init(width: Double, height: Double) {
        self.width = width
        self.height = height
    }
}

/// An axis-aligned rectangle; `x`/`y` is its top-left corner, matching how node positions are stored.
public struct CanvasRect: Equatable, Sendable {
    public var x: Double
    public var y: Double
    public var width: Double
    public var height: Double

    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }

    public init(origin: CanvasPoint, size: CanvasSize) {
        self.init(x: origin.x, y: origin.y, width: size.width, height: size.height)
    }

    public var minX: Double { x }
    public var minY: Double { y }
    public var maxX: Double { x + width }
    public var maxY: Double { y + height }
    public var midX: Double { x + width / 2 }
    public var midY: Double { y + height / 2 }
    public var origin: CanvasPoint { CanvasPoint(x: x, y: y) }
    public var size: CanvasSize { CanvasSize(width: width, height: height) }

    /// Edges count as inside, so a click right on a node's border still lands on it.
    public func contains(_ point: CanvasPoint) -> Bool {
        point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY
    }

    /// Whether `other` lies entirely within this rectangle.
    public func contains(_ other: CanvasRect) -> Bool {
        other.minX >= minX && other.maxX <= maxX && other.minY >= minY && other.maxY <= maxY
    }

    /// Rectangles that only touch along an edge don't intersect, so nodes can sit flush against each other.
    public func intersects(_ other: CanvasRect) -> Bool {
        minX < other.maxX && other.minX < maxX && minY < other.maxY && other.minY < maxY
    }

    public func union(_ other: CanvasRect) -> CanvasRect {
        let left = min(minX, other.minX), top = min(minY, other.minY)
        return CanvasRect(x: left, y: top, width: max(maxX, other.maxX) - left, height: max(maxY, other.maxY) - top)
    }

    /// Grows the rectangle by `amount` on every side (shrinks it when negative).
    public func expanded(by amount: Double) -> CanvasRect {
        CanvasRect(x: x - amount, y: y - amount, width: width + 2 * amount, height: height + 2 * amount)
    }
}

/// How the canvas is shown on screen: `screen = canvas × zoom + offset`. Kept per goal so reopening a goal
/// shows it where the person left it.
public struct Viewport: Equatable, Sendable, Codable {
    /// The zoom range the spec allows (25 % to 200 %): beyond it nodes are unreadable or a single node fills
    /// the window.
    public static let minZoom = 0.25
    public static let maxZoom = 2.0
    public static let identity = Viewport(offset: .zero, zoom: 1)

    /// Where the canvas origin lands on screen.
    public var offset: CanvasPoint
    public private(set) var zoom: Double

    public init(offset: CanvasPoint = .zero, zoom: Double = 1) {
        self.offset = offset
        self.zoom = Self.clamp(zoom)
    }

    public static func clamp(_ zoom: Double) -> Double {
        guard zoom.isFinite else { return 1 }
        return min(max(zoom, minZoom), maxZoom)
    }

    public mutating func setZoom(_ zoom: Double) {
        self.zoom = Self.clamp(zoom)
    }

    public func toScreen(_ point: CanvasPoint) -> CanvasPoint {
        CanvasPoint(x: point.x * zoom + offset.x, y: point.y * zoom + offset.y)
    }

    public func toCanvas(_ point: CanvasPoint) -> CanvasPoint {
        CanvasPoint(x: (point.x - offset.x) / zoom, y: (point.y - offset.y) / zoom)
    }

    /// Zooms by `factor` around `anchor` (a screen point, e.g. the pinch center or the view's middle), so
    /// whatever is under the anchor stays under it instead of sliding away.
    public func zoomed(by factor: Double, anchor: CanvasPoint) -> Viewport {
        let pinned = toCanvas(anchor)
        let newZoom = Self.clamp(zoom * factor)
        let newOffset = CanvasPoint(x: anchor.x - pinned.x * newZoom, y: anchor.y - pinned.y * newZoom)
        return Viewport(offset: newOffset, zoom: newZoom)
    }

    /// The viewport "Ajustar" jumps to: `rect` centered in a view of `size`, as large as fits inside
    /// `padding`, within the zoom range. A rect too big for the minimum zoom stays centered but overflows.
    public static func fitting(_ rect: CanvasRect, in size: CanvasSize, padding: Double = 40) -> Viewport {
        let availableWidth = max(1, size.width - 2 * padding)
        let availableHeight = max(1, size.height - 2 * padding)
        let scaleX = rect.width > 0 ? availableWidth / rect.width : maxZoom
        let scaleY = rect.height > 0 ? availableHeight / rect.height : maxZoom
        let zoom = clamp(min(scaleX, scaleY))
        let offset = CanvasPoint(x: size.width / 2 - rect.midX * zoom, y: size.height / 2 - rect.midY * zoom)
        return Viewport(offset: offset, zoom: zoom)
    }

    /// The part of the canvas a view of `size` shows, used to drop new nodes where the person can see them.
    public func visibleRect(in size: CanvasSize) -> CanvasRect {
        CanvasRect(origin: toCanvas(.zero), size: CanvasSize(width: size.width / zoom, height: size.height / zoom))
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        offset = c.value("offset", or: .zero)
        zoom = Self.clamp(c.value("zoom", or: 1))
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: AnyKey.self)
        try c.encode(offset, forKey: "offset")
        try c.encode(zoom, forKey: "zoom")
    }
}

/// An arrow drawn as a cubic Bézier curve, in canvas coordinates.
public struct EdgeCurve: Equatable, Sendable {
    public var start: CanvasPoint
    public var control1: CanvasPoint
    public var control2: CanvasPoint
    public var end: CanvasPoint

    public init(start: CanvasPoint, control1: CanvasPoint, control2: CanvasPoint, end: CanvasPoint) {
        self.start = start
        self.control1 = control1
        self.control2 = control2
        self.end = end
    }

    /// The point at `t` (0…1) along the curve.
    public func point(at t: Double) -> CanvasPoint {
        let u = 1 - t
        let a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t
        return CanvasPoint(x: a * start.x + b * control1.x + c * control2.x + d * end.x,
                           y: a * start.y + b * control1.y + c * control2.y + d * end.y)
    }
}

/// The curve of an arrow from the right-middle of `source` to the left-middle of `target`. Horizontal
/// tangents make arrows read left to right like the layered layout; the minimum pull of 40 keeps an arrow to
/// a node right above or behind its source from collapsing into a kink.
public func edgeCurve(from source: CanvasRect, to target: CanvasRect) -> EdgeCurve {
    let start = CanvasPoint(x: source.maxX, y: source.midY)
    let end = CanvasPoint(x: target.minX, y: target.midY)
    let dx = max(40, abs(end.x - start.x) / 2)
    return EdgeCurve(start: start, control1: CanvasPoint(x: start.x + dx, y: start.y),
                     control2: CanvasPoint(x: end.x - dx, y: end.y), end: end)
}

/// The distance from `point` to `curve`, approximated by `segments` straight pieces. An exact answer means
/// solving a quintic; at hit-test tolerances the polyline is indistinguishable.
public func distance(from point: CanvasPoint, toCurve curve: EdgeCurve, segments: Int = 24) -> Double {
    let count = max(1, segments)
    var best = Double.infinity
    var previous = curve.start
    for index in 1...count {
        let next = curve.point(at: Double(index) / Double(count))
        best = min(best, distance(from: point, toSegment: previous, next))
        previous = next
    }
    return best
}

private func distance(from p: CanvasPoint, toSegment a: CanvasPoint, _ b: CanvasPoint) -> Double {
    let dx = b.x - a.x, dy = b.y - a.y
    let lengthSquared = dx * dx + dy * dy
    let t = lengthSquared == 0 ? 0 : min(1, max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared))
    let x = a.x + t * dx - p.x, y = a.y + t * dy - p.y
    return (x * x + y * y).squareRoot()
}
