import XCTest
@testable import WololoKit

final class CanvasPressTests: XCTestCase {
    /// A at (0, 0) and B at (400, 0), with the arrow A → B and the final node far below.
    private var goal: Goal {
        var goal = Goal(id: "g", projectID: "acme__shop", title: "Ecommerce terminado", updatedAt: 0)
        goal.addNode(GoalNode(id: "A", title: "A", position: CanvasPoint(x: 0, y: 0)))
        goal.addNode(GoalNode(id: "B", title: "B", position: CanvasPoint(x: 400, y: 0)))
        goal.finalPosition = CanvasPoint(x: 0, y: 400)
        XCTAssertEqual(goal.connect(from: "A", to: "B"), .ok)
        return goal
    }

    private let viewport = Viewport.identity

    func testHandleBeatsNode() throws {
        let handle = try XCTUnwrap(goal.handlePoint(of: "A"))
        let inside = CanvasPoint(x: handle.x - 3, y: handle.y)
        XCTAssertEqual(CanvasPress.target(goal: goal, viewport: viewport, selectedNodeID: "A", point: inside),
                       .handle(nodeID: "A"))
        XCTAssertEqual(CanvasPress.target(goal: goal, viewport: viewport, selectedNodeID: nil, point: inside), .node("A"))
    }

    func testHandleFollowsTheZoom() throws {
        let zoomed = Viewport(offset: CanvasPoint(x: 50, y: 20), zoom: 2)
        let handle = zoomed.toScreen(try XCTUnwrap(goal.handlePoint(of: "A")))
        XCTAssertEqual(CanvasPress.target(goal: goal, viewport: zoomed, selectedNodeID: "A",
                                          point: CanvasPoint(x: handle.x + 8, y: handle.y)), .handle(nodeID: "A"))
    }

    func testNodeBeatsEdge() throws {
        var overlapped = goal
        // C sits across the arrow A → B, so a press there lands on both.
        overlapped.addNode(GoalNode(id: "C", title: "C", position: CanvasPoint(x: 200, y: 0)))
        let point = CanvasPoint(x: 250, y: 36)
        XCTAssertNotNil(overlapped.hitEdge(at: point, tolerance: CanvasPress.edgeTolerance))
        XCTAssertEqual(CanvasPress.target(goal: overlapped, viewport: viewport, selectedNodeID: nil, point: point),
                       .node("C"))
    }

    func testEdgeBeatsBackground() {
        let point = CanvasPoint(x: 284, y: 36)
        XCTAssertEqual(CanvasPress.target(goal: goal, viewport: viewport, selectedNodeID: nil, point: point),
                       .edge(GoalEdge(from: "A", to: "B")))
        XCTAssertEqual(CanvasPress.target(goal: goal, viewport: viewport, selectedNodeID: nil,
                                          point: CanvasPoint(x: 284, y: 200)), .background)
    }

    func testFinalNodeHasNoHandle() throws {
        let handle = try XCTUnwrap(goal.handlePoint(of: Goal.finalID))
        XCTAssertEqual(CanvasPress.target(goal: goal, viewport: viewport, selectedNodeID: Goal.finalID,
                                          point: CanvasPoint(x: handle.x - 2, y: handle.y)), .node(Goal.finalID))
        XCTAssertEqual(CanvasPress.target(goal: goal, viewport: viewport, selectedNodeID: Goal.finalID,
                                          point: CanvasPoint(x: handle.x + 2, y: handle.y)), .background)
    }

    func testDropOnEmptySpaceIsNil() {
        XCTAssertNil(CanvasPress.dropResult(goal: goal, from: "A", point: CanvasPoint(x: 284, y: 200),
                                            viewport: viewport))
        XCTAssertNil(CanvasPress.dropTarget(goal: goal, point: CanvasPoint(x: 284, y: 200), viewport: viewport))
    }

    func testDropTargetFollowsTheZoomAndOffset() {
        let zoomed = Viewport(offset: CanvasPoint(x: 50, y: 20), zoom: 2)
        // B spans x 400…568, y 0…72 on the canvas: x 850…1186, y 20…164 on screen.
        XCTAssertEqual(CanvasPress.dropTarget(goal: goal, point: CanvasPoint(x: 900, y: 80), viewport: zoomed), "B")
        XCTAssertNil(CanvasPress.dropTarget(goal: goal, point: CanvasPoint(x: 840, y: 80), viewport: zoomed))
        XCTAssertNil(CanvasPress.dropTarget(goal: goal, point: CanvasPoint(x: 450, y: 30), viewport: zoomed))
        XCTAssertEqual(CanvasPress.dropResult(goal: goal, from: "B", point: CanvasPoint(x: 100, y: 80),
                                              viewport: zoomed), .cycle)
    }

    func testEdgeToleranceIsInScreenPointsAtEveryZoom() {
        // Along y = 36 near x 284 the arrow A → B runs flat, so a point straight below is that far from it.
        for zoom in [0.5, 2.0] {
            let viewport = Viewport(offset: CanvasPoint(x: 30, y: 10), zoom: zoom)
            let onArrow = viewport.toScreen(CanvasPoint(x: 284, y: 36))
            let hit = CanvasPoint(x: onArrow.x, y: onArrow.y + 6)
            let miss = CanvasPoint(x: onArrow.x, y: onArrow.y + 7)
            XCTAssertEqual(CanvasPress.target(goal: goal, viewport: viewport, selectedNodeID: nil, point: hit),
                           .edge(GoalEdge(from: "A", to: "B")), "zoom \(zoom)")
            XCTAssertEqual(CanvasPress.target(goal: goal, viewport: viewport, selectedNodeID: nil, point: miss),
                           .background, "zoom \(zoom)")
        }
    }

    func testDropResults() {
        let onB = CanvasPoint(x: 450, y: 30)
        let onA = CanvasPoint(x: 50, y: 30)
        let onFinal = CanvasPoint(x: 60, y: 440)
        XCTAssertEqual(CanvasPress.dropTarget(goal: goal, point: onB, viewport: viewport), "B")
        XCTAssertEqual(CanvasPress.dropResult(goal: goal, from: "B", point: onA, viewport: viewport), .cycle)
        XCTAssertEqual(CanvasPress.dropResult(goal: goal, from: "A", point: onB, viewport: viewport), .duplicate)
        XCTAssertEqual(CanvasPress.dropResult(goal: goal, from: "B", point: onFinal, viewport: viewport), .ok)
    }
}
