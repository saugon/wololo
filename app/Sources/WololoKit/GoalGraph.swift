import Foundation

/// What happened when asking for an arrow; anything but `.ok` leaves the goal untouched so the view can
/// just say why.
public enum ConnectResult: Equatable, Sendable {
    case ok
    /// The arrow would close a loop, so nothing in it could ever start.
    case cycle
    case duplicate
    /// The final node is the goal itself: nothing can depend on it.
    case fromFinal
    case selfLoop
    case unknownNode
}

/// Graph operations on a goal. They are value-semantic mutations: callers mutate a copy and save it, and
/// none of them touch `updatedAt`.
extension Goal {
    public static func isFinal(_ id: String) -> Bool { id == finalID }

    /// The steps of the goal: every node but the final one, which is the goal itself.
    public var steps: [GoalNode] { nodes }

    public func node(_ id: String) -> GoalNode? {
        nodes.first { $0.id == id }
    }

    /// Whether `id` names a node on the canvas, the final node included.
    public func contains(_ id: String) -> Bool {
        Self.isFinal(id) || nodes.contains { $0.id == id }
    }

    public func position(of id: String) -> CanvasPoint? {
        Self.isFinal(id) ? finalPosition : node(id)?.position
    }

    /// Adds a step. Rejects an id already on the canvas, the final one included, so ids stay unique.
    @discardableResult
    public mutating func addNode(_ node: GoalNode) -> Bool {
        guard !node.id.isEmpty, !contains(node.id) else { return false }
        nodes.append(node)
        return true
    }

    /// Removes a step and every arrow touching it. The final node can't be removed.
    @discardableResult
    public mutating func removeNode(_ id: String) -> Bool {
        guard !Self.isFinal(id), let index = nodes.firstIndex(where: { $0.id == id }) else { return false }
        nodes.remove(at: index)
        edges.removeAll { $0.from == id || $0.to == id }
        return true
    }

    @discardableResult
    public mutating func removeEdge(_ edge: GoalEdge) -> Bool {
        guard let index = edges.firstIndex(of: edge) else { return false }
        edges.remove(at: index)
        return true
    }

    /// Moves a node on the canvas; moving the final node moves `finalPosition`.
    @discardableResult
    public mutating func move(_ id: String, to point: CanvasPoint) -> Bool {
        if Self.isFinal(id) {
            finalPosition = point
            return true
        }
        guard let index = nodes.firstIndex(where: { $0.id == id }) else { return false }
        nodes[index].position = point
        return true
    }

    /// Adds the arrow `from → to` (`to` depends on `from`) unless it would break the graph.
    @discardableResult
    public mutating func connect(from: String, to: String) -> ConnectResult {
        let result = canConnect(from: from, to: to)
        if result == .ok {
            edges.append(GoalEdge(from: from, to: to))
        }
        return result
    }

    /// The answer `connect` would give, without adding the arrow, so a drag can preview it.
    public func canConnect(from: String, to: String) -> ConnectResult {
        if Self.isFinal(from) { return .fromFinal }
        if from == to { return .selfLoop }
        guard contains(from), contains(to) else { return .unknownNode }
        if edges.contains(GoalEdge(from: from, to: to)) { return .duplicate }
        // The new arrow closes a loop exactly when `from` already depends, directly or not, on `to`.
        if isReachable(from, startingAt: to) { return .cycle }
        return .ok
    }

    /// The nodes `id` depends on, in the order their arrows were made.
    public func predecessors(of id: String) -> [String] {
        edges.filter { $0.to == id }.map(\.from)
    }

    /// The nodes that depend on `id`, in the order their arrows were made.
    public func successors(of id: String) -> [String] {
        edges.filter { $0.from == id }.map(\.to)
    }

    /// Steps done over all steps. The final node doesn't count: it is done exactly when the goal is.
    public func progress(doneIDs: Set<String>) -> (done: Int, total: Int, fraction: Double) {
        let total = steps.count
        let done = steps.filter { doneIDs.contains($0.id) }.count
        return (done, total, total == 0 ? 0 : Double(done) / Double(total))
    }

    private func isReachable(_ target: String, startingAt start: String) -> Bool {
        var pending = [start]
        var seen: Set<String> = [start]
        while let current = pending.popLast() {
            if current == target { return true }
            for next in successors(of: current) where seen.insert(next).inserted {
                pending.append(next)
            }
        }
        return false
    }
}
