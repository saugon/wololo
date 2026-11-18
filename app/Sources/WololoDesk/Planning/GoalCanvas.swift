import SwiftUI
import WololoKit

/// A goal drawn as a canvas of nodes and arrows (spec 9 to 15): its header, the dotted ground, the arrows, the steps in
/// `goal.nodes` order and the final node last, which is the order `Goal.hitNode` searches in, so nothing is raised
/// above it. The person pans by dragging the ground or scrolling, zooms by pinching or with the controls, drags nodes,
/// drags arrows out of the selected node's handle, double-clicks to add a node, and removes the selected node or arrow
/// with ⌫. Each goal keeps its own viewport.
struct GoalCanvas: View {
    let state: AppState
    let goalID: String

    /// What a press on the canvas turned into, until the release.
    private enum Drag {
        case none
        case pan(startOffset: CanvasPoint, start: CGPoint, moved: Bool)
        /// `grab` is where the node was taken, relative to its top-left corner, in canvas units; `position` is where
        /// the drag has it, nil until it moves. Only the position is kept, so edits made meanwhile survive the release.
        case node(id: String, grab: CanvasPoint, start: CGPoint, position: CanvasPoint?)
        /// `start` is the press, so a press on the handle that never moves still counts as a click.
        case connect(from: String, start: CGPoint, pointer: CGPoint, moved: Bool)
    }

    /// How far, in screen points, a press may move and still count as a click.
    private static let clickSlop: CGFloat = 3

    @Environment(\.theme) private var theme
    @State private var viewport = Viewport.identity
    @State private var size = CGSize.zero
    @State private var hasViewport = false
    /// Set while the viewport is the automatic fit of a goal opened with none saved: it follows the canvas's size
    /// until the person moves it.
    @State private var followsSize = false
    @State private var drag = Drag.none

    var body: some View {
        if let stored = state.goal(id: goalID) {
            let goal = dragged(stored)
            let project = state.project(id: goal.projectID)
            let repo = project.flatMap(defaultRepo(for:))
            let status = goal.status(defaultRepo: repo, runs: RunIndex(runs: state.model.runs), now: state.model.now)
            VStack(spacing: 0) {
                GoalHeader(state: state, goal: stored,
                           subtitle: goalSubtitle(projectName: project?.name, repo: repo, done: status.done,
                                                  total: status.total),
                           arrange: arrange, addNode: addNode)
                ThemeBand()
                GeometryReader { geometry in
                    canvas(goal, status: status, repo: repo)
                        .onAppear { resize(to: geometry.size) }
                        .onChange(of: geometry.size) { resize(to: geometry.size) }
                }
                // Below the canvas, not over it, so the canvas's AppKit input view can never take their clicks.
                HStack(spacing: 20) {
                    CanvasControls(zoom: viewport.zoom, zoomBy: zoomFromCenter, fit: fit)
                    CanvasHint()
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(theme.ground)
                .overlay(alignment: .top) { theme.border.frame(height: 1) }
            }
        }
    }

    /// The stored goal with the node being dragged where the drag has it.
    private func dragged(_ stored: Goal) -> Goal {
        guard case .node(let id, _, _, let position?) = drag else { return stored }
        var goal = stored
        goal.move(id, to: position)
        return goal
    }

    // MARK: Drawing

    private func canvas(_ goal: Goal, status: GoalStatus, repo: String?) -> some View {
        ZStack(alignment: .topLeading) {
            DotGrid(viewport: viewport)
            EdgeLayer(goal: goal, status: status, viewport: viewport, selected: state.selectedEdge,
                      pending: pendingArrow(goal))
            nodes(goal, status: status, repo: repo)
            handle(goal)
            CanvasInput(handlers: handlers)
        }
        .clipped()
        .contentShape(Rectangle())
    }

    /// The steps in their stored order, then the final node, laid out in canvas units and scaled and moved as a whole
    /// by the viewport (`screen = canvas × zoom + offset`).
    private func nodes(_ goal: Goal, status: GoalStatus, repo: String?) -> some View {
        let target = dropTarget(goal)
        return ZStack(alignment: .topLeading) {
            ForEach(goal.nodes) { node in
                let nodeStatus = status.status(of: node.id)
                NodeCard(node: node, status: nodeStatus, meta: nodeStatus?.metaLine(defaultRepo: repo) ?? "sin issue",
                         isSelected: state.selectedNodeID == node.id, isDropTarget: target == node.id)
                    .offset(x: node.position.x, y: node.position.y)
            }
            FinalNodeCard(title: goal.title, isDone: status.status(of: Goal.finalID)?.state.isDone == true,
                          isSelected: state.selectedNodeID == Goal.finalID, isDropTarget: target == Goal.finalID)
                .offset(x: goal.finalPosition.x, y: goal.finalPosition.y)
        }
        .scaleEffect(viewport.zoom, anchor: .topLeading)
        .offset(x: viewport.offset.x, y: viewport.offset.y)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .allowsHitTesting(false)
    }

    /// The dot on the selected step's right edge that arrows are dragged out of. The final node has none: nothing can
    /// depend on the goal.
    @ViewBuilder
    private func handle(_ goal: Goal) -> some View {
        if let id = state.selectedNodeID, !Goal.isFinal(id), let point = goal.handlePoint(of: id) {
            let center = viewport.toScreen(point)
            Circle()
                .fill(theme.focus)
                .overlay { Circle().strokeBorder(theme.ground, lineWidth: 2) }
                .frame(width: 12, height: 12)
                .offset(x: center.x - 6, y: center.y - 6)
                .allowsHitTesting(false)
        }
    }

    private func pendingArrow(_ goal: Goal) -> (from: CGPoint, to: CGPoint)? {
        guard case .connect(let from, _, let pointer, true) = drag, let start = goal.handlePoint(of: from) else {
            return nil
        }
        let screen = viewport.toScreen(start)
        return (CGPoint(x: screen.x, y: screen.y), pointer)
    }

    /// The node an arrow being dragged would be dropped on, when the arrow would be accepted.
    private func dropTarget(_ goal: Goal) -> String? {
        guard case .connect(let from, _, let pointer, true) = drag,
              CanvasPress.dropResult(goal: goal, from: from, point: canvasPoint(pointer), viewport: viewport) == .ok
        else { return nil }
        return CanvasPress.dropTarget(goal: goal, point: canvasPoint(pointer), viewport: viewport)
    }

    // MARK: Input

    private var handlers: CanvasInput.Handlers {
        CanvasInput.Handlers(
            mouseDown: mouseDown,
            mouseDragged: mouseDragged,
            mouseUp: mouseUp,
            scroll: { delta, ended in
                followsSize = false
                viewport.offset = CanvasPoint(x: viewport.offset.x + delta.width, y: viewport.offset.y + delta.height)
                if ended { saveViewport() }
            },
            magnify: { factor, point, ended in
                followsSize = false
                viewport = viewport.zoomed(by: factor, anchor: canvasPoint(point))
                if ended { saveViewport() }
            },
            menu: menuItems,
            delete: {
                // The canvas only gets keys as first responder, so this is a second guard against a field's ⌫.
                guard !state.isTextFocused, !state.isSearchFocused else { return }
                deleteSelection()
            },
            cancel: {
                guard !state.isTextFocused, !state.isSearchFocused else { return }
                clearSelection()
            }
        )
    }

    private var currentGoal: Goal? {
        state.goal(id: goalID)
    }

    private func mouseDown(_ point: CGPoint, clickCount: Int) {
        guard let goal = currentGoal else { return }
        let target = CanvasPress.target(goal: goal, viewport: viewport, selectedNodeID: state.selectedNodeID,
                                        point: canvasPoint(point))
        if clickCount >= 2, case .background = target {
            drag = .none
            let canvas = viewport.toCanvas(canvasPoint(point))
            createNode(at: CanvasPoint(x: canvas.x - GoalNodeMetrics.stepSize.width / 2,
                                       y: canvas.y - GoalNodeMetrics.stepSize.height / 2))
            return
        }
        switch target {
        case .handle(let id):
            drag = .connect(from: id, start: point, pointer: point, moved: false)
        case .node(let id):
            guard let position = goal.position(of: id) else { return }
            let canvas = viewport.toCanvas(canvasPoint(point))
            select(node: id)
            drag = .node(id: id, grab: CanvasPoint(x: canvas.x - position.x, y: canvas.y - position.y), start: point,
                         position: nil)
        case .edge, .background:
            drag = .pan(startOffset: viewport.offset, start: point, moved: false)
        }
    }

    private func mouseDragged(_ point: CGPoint) {
        switch drag {
        case .none:
            break
        case .pan(let startOffset, let start, let moved):
            let isMoving = moved || distance(start, point) > Self.clickSlop
            guard isMoving else { return }
            followsSize = false
            viewport.offset = CanvasPoint(x: startOffset.x + point.x - start.x, y: startOffset.y + point.y - start.y)
            drag = .pan(startOffset: startOffset, start: start, moved: true)
        case .node(let id, let grab, let start, let position):
            guard position != nil || distance(start, point) > Self.clickSlop else { return }
            let canvas = viewport.toCanvas(canvasPoint(point))
            drag = .node(id: id, grab: grab, start: start, position: CanvasPoint(x: canvas.x - grab.x, y: canvas.y - grab.y))
        case .connect(let from, let start, _, let moved):
            drag = .connect(from: from, start: start, pointer: point,
                            moved: moved || distance(start, point) > Self.clickSlop)
        }
    }

    private func mouseUp(_ point: CGPoint) {
        let finished = drag
        drag = .none
        switch finished {
        case .none:
            break
        case .pan(_, _, let moved):
            if moved {
                saveViewport()
            } else {
                click(at: point)
            }
        case .node(let id, _, _, let position):
            // Moved onto the goal as it is now, so a rename saved during the drag isn't undone.
            guard let position, var goal = currentGoal, goal.move(id, to: position) else { return }
            state.update(goal: goal)
        case .connect(_, _, _, false):
            click(at: point)
        case .connect(let from, _, _, true):
            guard var goal = currentGoal,
                  let result = CanvasPress.dropResult(goal: goal, from: from, point: canvasPoint(point),
                                                      viewport: viewport)
            else { return }
            switch result {
            case .ok:
                if let to = CanvasPress.dropTarget(goal: goal, point: canvasPoint(point), viewport: viewport) {
                    goal.connect(from: from, to: to)
                    state.update(goal: goal)
                }
            case .cycle: state.showToast(["Eso armaría un ciclo"])
            case .duplicate: state.showToast(["Esa flecha ya existe"])
            case .fromFinal, .selfLoop, .unknownNode: break
            }
        }
    }

    /// A press that ended where it began, ignoring the handle: the node or arrow under it is selected; otherwise the
    /// selection goes.
    private func click(at point: CGPoint) {
        guard let goal = currentGoal else { return }
        switch CanvasPress.target(goal: goal, viewport: viewport, selectedNodeID: nil, point: canvasPoint(point)) {
        case .node(let id):
            select(node: id)
        case .edge(let edge):
            state.selectedNodeID = nil
            state.selectedEdge = edge
        case .handle, .background:
            clearSelection()
        }
    }

    /// The right-click menu for the node or arrow under the pointer, which it also selects.
    private func menuItems(at point: CGPoint) -> [CanvasMenuItem] {
        guard let goal = currentGoal else { return [] }
        switch CanvasPress.target(goal: goal, viewport: viewport, selectedNodeID: nil, point: canvasPoint(point)) {
        case .node(let id):
            select(node: id)
            guard !Goal.isFinal(id) else { return [] }
            return [CanvasMenuItem(title: "Borrar paso") { remove(node: id) }]
        case .edge(let edge):
            state.selectedNodeID = nil
            state.selectedEdge = edge
            return [CanvasMenuItem(title: "Borrar flecha") { remove(edge: edge) }]
        case .handle, .background:
            return []
        }
    }

    // MARK: Editing

    private func select(node id: String) {
        state.selectedEdge = nil
        state.selectedNodeID = id
    }

    private func clearSelection() {
        state.selectedNodeID = nil
        state.selectedEdge = nil
    }

    /// A new step at `position` (its top-left corner), saved and selected, with its title asked to take the focus.
    private func createNode(at position: CanvasPoint) {
        guard var goal = currentGoal else { return }
        let node = GoalNode(id: UUID().uuidString.lowercased(), title: "Paso nuevo", position: position)
        guard goal.addNode(node) else { return }
        state.update(goal: goal)
        select(node: node.id)
        state.focusTitleRequest += 1
    }

    /// "+ Nodo": a step in a free spot of what is on screen. When the screen is full the spot lies outside it, so the
    /// canvas scrolls to show the new step.
    private func addNode() {
        guard let goal = currentGoal else { return }
        let screen = CanvasSize(width: size.width, height: size.height)
        let visible = viewport.visibleRect(in: screen)
        let spot = goal.freeSpot(visible: visible)
        let rect = CanvasRect(origin: spot, size: GoalNodeMetrics.stepSize)
        createNode(at: spot)
        if !visible.contains(rect) {
            viewport.offset = CanvasPoint(x: screen.width / 2 - rect.midX * viewport.zoom,
                                          y: screen.height / 2 - rect.midY * viewport.zoom)
            saveViewport()
        }
    }

    /// "Ordenar": every node to its layer, saved, then the whole graph fitted on screen so nothing is left out of view.
    private func arrange() {
        guard var goal = currentGoal else { return }
        goal.applyLayeredLayout()
        state.update(goal: goal)
        fit()
    }

    private func deleteSelection() {
        if let edge = state.selectedEdge {
            remove(edge: edge)
        } else if let id = state.selectedNodeID {
            remove(node: id)
        }
    }

    /// Removes a step and its arrows. The final node is the goal itself and stays.
    private func remove(node id: String) {
        guard !Goal.isFinal(id), var goal = currentGoal, goal.removeNode(id) else { return }
        state.update(goal: goal)
        if state.selectedNodeID == id { state.selectedNodeID = nil }
    }

    private func remove(edge: GoalEdge) {
        guard var goal = currentGoal, goal.removeEdge(edge) else { return }
        state.update(goal: goal)
        if state.selectedEdge == edge { state.selectedEdge = nil }
    }

    // MARK: Viewport

    /// Takes the canvas's size; the first time, the goal opens where the person left it, or fitted on screen.
    private func resize(to newSize: CGSize) {
        size = newSize
        guard newSize.width > 0, newSize.height > 0 else { return }
        if !hasViewport {
            hasViewport = true
            if let saved = state.planningPrefs.viewport(forGoal: goalID) {
                viewport = saved
                return
            }
            followsSize = true
        }
        if followsSize, let goal = currentGoal {
            // Opened, a small goal stays at 100 % instead of filling the window with oversized nodes.
            let fitted = Viewport.fitting(goal.bounds(), in: CanvasSize(width: newSize.width, height: newSize.height))
            let center = CanvasPoint(x: newSize.width / 2, y: newSize.height / 2)
            viewport = fitted.zoom > 1 ? fitted.zoomed(by: 1 / fitted.zoom, anchor: center) : fitted
        }
    }

    private func fit() {
        guard let goal = currentGoal, size.width > 0, size.height > 0 else { return }
        viewport = Viewport.fitting(goal.bounds(), in: CanvasSize(width: size.width, height: size.height))
        saveViewport()
    }

    private func zoomFromCenter(_ factor: Double) {
        viewport = viewport.zoomed(by: factor, anchor: CanvasPoint(x: size.width / 2, y: size.height / 2))
        saveViewport()
    }

    private func saveViewport() {
        followsSize = false
        state.planningPrefs.setViewport(viewport, forGoal: goalID)
    }

    private func canvasPoint(_ point: CGPoint) -> CanvasPoint {
        CanvasPoint(x: point.x, y: point.y)
    }

    private func distance(_ a: CGPoint, _ b: CGPoint) -> CGFloat {
        hypot(a.x - b.x, a.y - b.y)
    }
}
