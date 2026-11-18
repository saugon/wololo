import Foundation

/// What a press on a goal's canvas lands on, and where an arrow dragged out of a node ends. Points are on screen (the
/// canvas view's own coordinates), so the slack around the handle and the arrows stays the same at every zoom.
public enum CanvasPress {
    /// The radius, in screen points, around the connect handle that picks it up.
    public static let handleRadius = 9.0
    /// How close, in screen points, a press must land to an arrow to take it.
    public static let edgeTolerance = 6.0

    public enum Target: Equatable, Sendable {
        /// The connect handle of the selected step, which starts an arrow.
        case handle(nodeID: String)
        case node(String)
        case edge(GoalEdge)
        case background
    }

    /// What is under `point`, from the top of what is drawn down: the selected step's handle (it sits half over the
    /// node), then a node, then an arrow, then the ground. The final node has no handle: nothing can depend on it.
    public static func target(goal: Goal, viewport: Viewport, selectedNodeID: String?, point: CanvasPoint) -> Target {
        if let id = selectedNodeID, !Goal.isFinal(id), let handle = goal.handlePoint(of: id) {
            let screen = viewport.toScreen(handle)
            if hypot(screen.x - point.x, screen.y - point.y) <= handleRadius {
                return .handle(nodeID: id)
            }
        }
        let canvas = viewport.toCanvas(point)
        if let id = goal.hitNode(at: canvas) {
            return .node(id)
        }
        if let edge = goal.hitEdge(at: canvas, tolerance: edgeTolerance / viewport.zoom) {
            return .edge(edge)
        }
        return .background
    }

    /// The node an arrow dropped at `point` lands on; nil on empty space.
    public static func dropTarget(goal: Goal, point: CanvasPoint, viewport: Viewport) -> String? {
        goal.hitNode(at: viewport.toCanvas(point))
    }

    /// What connecting `from` to the node under `point` would give; nil when the arrow is dropped on empty space.
    public static func dropResult(goal: Goal, from: String, point: CanvasPoint, viewport: Viewport) -> ConnectResult? {
        dropTarget(goal: goal, point: point, viewport: viewport).map { goal.canConnect(from: from, to: $0) }
    }
}
