import Foundation

/// The sizes nodes are drawn at. They live here, not in the view, because layout, hit-testing and the free
/// spot all need them and must agree with what is drawn.
public enum GoalNodeMetrics {
    public static let stepSize = CanvasSize(width: 168, height: 72)
    /// The final node is a pill, narrower and taller than a step so it reads as the goal, not one more task.
    public static let finalSize = CanvasSize(width: 128, height: 84)
    public static let columnPitch = 216.0
    public static let rowPitch = 170.0
}

/// Canvas geometry of a goal: where its nodes go when sorted, the space they take and what lies under a point.
extension Goal {
    public static func size(of id: String) -> CanvasSize {
        isFinal(id) ? GoalNodeMetrics.finalSize : GoalNodeMetrics.stepSize
    }

    /// The node's rectangle on the canvas; its stored position is the top-left corner.
    public func rect(of id: String) -> CanvasRect? {
        position(of: id).map { CanvasRect(origin: $0, size: Self.size(of: id)) }
    }

    /// Where the connect handle sits: the middle of the node's right edge, where arrows leave from.
    public func handlePoint(of id: String) -> CanvasPoint? {
        rect(of: id).map { CanvasPoint(x: $0.maxX, y: $0.midY) }
    }

    /// The rectangle every node fits in, the final node included, so "Ajustar" never leaves the goal out.
    public func bounds() -> CanvasRect {
        nodes.reduce(CanvasRect(origin: finalPosition, size: GoalNodeMetrics.finalSize)) { result, node in
            result.union(CanvasRect(origin: node.position, size: GoalNodeMetrics.stepSize))
        }
    }

    /// The positions "Ordenar" gives every node, keyed by id (the final node under `Goal.finalID`).
    ///
    /// A step's column is the length of the longest path reaching it from a step nothing depends on, so every
    /// arrow points rightwards; the final node takes the column after the last step. Within a column steps
    /// keep their current top-to-bottom order (ties by creation order), so sorting twice changes nothing and
    /// a person's rough arrangement survives. Columns are centered on the tallest one, and so is the final node.
    public func layeredLayout(origin: CanvasPoint = .zero, columnPitch: Double = GoalNodeMetrics.columnPitch,
                              rowPitch: Double = GoalNodeMetrics.rowPitch) -> [String: CanvasPoint] {
        let columns = stepColumns()
        let columnCount = (columns.values.max() ?? -1) + 1
        var byColumn = Array(repeating: [Int](), count: columnCount)
        for (index, node) in nodes.enumerated() {
            byColumn[columns[node.id] ?? 0].append(index)
        }
        let tallest = byColumn.map(\.count).max() ?? 0
        let stepHeight = GoalNodeMetrics.stepSize.height
        let centerY = origin.y + (tallest > 0 ? (Double(tallest - 1) * rowPitch + stepHeight) / 2
                                              : GoalNodeMetrics.finalSize.height / 2)

        var positions: [String: CanvasPoint] = [:]
        for (column, members) in byColumn.enumerated() {
            let ordered = members.sorted { a, b in
                let ya = nodes[a].position.y, yb = nodes[b].position.y
                return ya != yb ? ya < yb : a < b
            }
            let top = centerY - (Double(ordered.count - 1) * rowPitch + stepHeight) / 2
            let x = origin.x + Double(column) * columnPitch
            for (row, index) in ordered.enumerated() {
                positions[nodes[index].id] = CanvasPoint(x: x, y: top + Double(row) * rowPitch)
            }
        }
        positions[Self.finalID] = CanvasPoint(x: origin.x + Double(columnCount) * columnPitch,
                                              y: centerY - GoalNodeMetrics.finalSize.height / 2)
        return positions
    }

    /// "Ordenar": moves every node to its place in `layeredLayout`.
    public mutating func applyLayeredLayout(origin: CanvasPoint = .zero) {
        for (id, point) in layeredLayout(origin: origin) {
            move(id, to: point)
        }
    }

    /// Where "+ Nodo" drops a new step: the first spot, scanning the visible part of the canvas row by row,
    /// where a step fits without touching any node. When the view is full it goes right of everything, so it
    /// still never covers a node.
    public func freeSpot(visible: CanvasRect) -> CanvasPoint {
        let size = GoalNodeMetrics.stepSize
        let gap = 16.0
        let occupied = (nodes.map(\.id) + [Self.finalID]).compactMap { rect(of: $0)?.expanded(by: gap) }
        let area = visible.expanded(by: -gap)
        let step = 24.0
        var y = area.minY
        while y + size.height <= area.maxY {
            var x = area.minX
            while x + size.width <= area.maxX {
                let candidate = CanvasRect(origin: CanvasPoint(x: x, y: y), size: size)
                if !occupied.contains(where: { $0.intersects(candidate) }) {
                    return candidate.origin
                }
                x += step
            }
            y += step
        }
        let all = bounds()
        return CanvasPoint(x: all.maxX + GoalNodeMetrics.columnPitch - GoalNodeMetrics.stepSize.width, y: all.minY)
    }

    /// The node under `point`. The final node is drawn last, over the steps, and steps later in `nodes` over
    /// earlier ones, so the search goes from the top of that stack down.
    public func hitNode(at point: CanvasPoint) -> String? {
        let stack = nodes.map(\.id) + [Self.finalID]
        return stack.reversed().first { rect(of: $0)?.contains(point) == true }
    }

    /// The arrow closest to `point`, if any lies within `tolerance` (canvas units; divide a screen tolerance by
    /// the zoom). Arrows are thin, so clicking needs some slack.
    public func hitEdge(at point: CanvasPoint, tolerance: Double) -> GoalEdge? {
        var best: (edge: GoalEdge, distance: Double)?
        for edge in edges {
            guard let source = rect(of: edge.from), let target = rect(of: edge.to) else { continue }
            let d = distance(from: point, toCurve: edgeCurve(from: source, to: target))
            if d <= tolerance, d < best?.distance ?? .infinity {
                best = (edge, d)
            }
        }
        return best?.edge
    }

    /// Longest-path depth of every step, ignoring arrows into the final node. The graph is acyclic (`connect`
    /// refuses loops, and so does decoding), so the memoized walk terminates.
    private func stepColumns() -> [String: Int] {
        var columns: [String: Int] = [:]
        var visiting = Set<String>()
        func column(of id: String) -> Int {
            if let known = columns[id] { return known }
            // A loop can't be saved, but if one slipped in, cutting it here beats recursing forever.
            guard visiting.insert(id).inserted else { return 0 }
            let depth = predecessors(of: id).filter { !Self.isFinal($0) && node($0) != nil }
                .map { column(of: $0) + 1 }.max() ?? 0
            visiting.remove(id)
            columns[id] = depth
            return depth
        }
        for node in nodes {
            _ = column(of: node.id)
        }
        return columns
    }
}
