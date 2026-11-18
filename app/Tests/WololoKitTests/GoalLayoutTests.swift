import XCTest
@testable import WololoKit

final class GoalLayoutTests: XCTestCase {
    private func goal(_ ids: [String], edges: [(String, String)] = []) -> Goal {
        var goal = Goal(id: "g", projectID: "acme__shop", title: "Ecommerce terminado", updatedAt: 0)
        for id in ids {
            goal.addNode(GoalNode(id: id, title: id))
        }
        for (from, to) in edges {
            XCTAssertEqual(goal.connect(from: from, to: to), .ok)
        }
        return goal
    }

    /// The graph of the mockup (scenario 19).
    private var mockup: Goal {
        let f = Goal.finalID
        return goal(["A", "B", "C", "D", "E", "F", "G"],
                    edges: [("A", "B"), ("A", "E"), ("D", "E"), ("B", "C"), ("E", "C"), ("E", f), ("C", f),
                            ("F", "G"), ("G", f)])
    }

    // MARK: - Layered layout

    func testMockupLaysOutInColumnsWithTheFinalNodeLast() throws {
        let layout = mockup.layeredLayout()
        let x = { (id: String) in try XCTUnwrap(layout[id]).x }

        XCTAssertEqual(try x("A"), 0)
        XCTAssertEqual(try x("D"), try x("A"))
        XCTAssertEqual(try x("F"), try x("A"))
        XCTAssertEqual(try x("B"), 216)
        XCTAssertEqual(try x("E"), try x("B"))
        XCTAssertEqual(try x("G"), try x("B"))
        XCTAssertEqual(try x("C"), 432)
        XCTAssertEqual(try x(Goal.finalID), 648)
        for id in ["A", "B", "C", "D", "E", "F", "G"] {
            XCTAssertLessThan(try x(id), try x(Goal.finalID))
        }
        XCTAssertEqual(layout.count, 8)
    }

    func testColumnsAreCenteredOnTheTallestAndSoIsTheFinalNode() throws {
        let layout = mockup.layeredLayout()
        let stepMid = { (id: String) in try XCTUnwrap(layout[id]).y + GoalNodeMetrics.stepSize.height / 2 }
        let finalMid = try XCTUnwrap(layout[Goal.finalID]).y + GoalNodeMetrics.finalSize.height / 2
        XCTAssertEqual(try stepMid("D"), 170 + 36)
        XCTAssertEqual(try stepMid("C"), try stepMid("D"))
        XCTAssertEqual(finalMid, try stepMid("D"))
        XCTAssertEqual(try XCTUnwrap(layout["E"]).y - XCTUnwrap(layout["B"]).y, 170)
    }

    func testLayoutKeepsTheCurrentVerticalOrderThenCreationOrder() throws {
        var goal = goal(["a", "b", "c"])
        goal.move("a", to: CanvasPoint(x: 0, y: 500))
        goal.move("b", to: CanvasPoint(x: 0, y: 100))
        goal.move("c", to: CanvasPoint(x: 0, y: 100))
        let layout = goal.layeredLayout()
        let ys = try ["b", "c", "a"].map { try XCTUnwrap(layout[$0]).y }
        XCTAssertEqual(ys, [0, 170, 340])

        goal.applyLayeredLayout()
        XCTAssertEqual(goal.layeredLayout(), goal.nodes.reduce(into: [Goal.finalID: goal.finalPosition]) {
            $0[$1.id] = $1.position
        })
    }

    func testEmptyGoalPutsTheFinalNodeAtTheOrigin() {
        var goal = goal([])
        let origin = CanvasPoint(x: 40, y: 60)
        XCTAssertEqual(goal.layeredLayout(origin: origin), [Goal.finalID: origin])
        goal.finalPosition = CanvasPoint(x: 900, y: 900)
        goal.applyLayeredLayout(origin: origin)
        XCTAssertEqual(goal.finalPosition, origin)
    }

    func testBoundsIncludeTheFinalNode() {
        var goal = goal(["a"])
        goal.move("a", to: CanvasPoint(x: 0, y: 0))
        goal.move(Goal.finalID, to: CanvasPoint(x: 300, y: 200))
        XCTAssertEqual(goal.bounds(), CanvasRect(x: 0, y: 0, width: 428, height: 284))
    }

    // MARK: - Viewport

    func testZoomIsClamped() {
        XCTAssertEqual(Viewport(zoom: 0.1).zoom, 0.25)
        XCTAssertEqual(Viewport(zoom: 5).zoom, 2)
        XCTAssertEqual(Viewport(zoom: 1).zoomed(by: 100, anchor: .zero).zoom, 2)
        XCTAssertEqual(Viewport(zoom: 1).zoomed(by: 0.01, anchor: .zero).zoom, 0.25)
        var viewport = Viewport()
        viewport.setZoom(.nan)
        XCTAssertEqual(viewport.zoom, 1)
    }

    func testScreenAndCanvasRoundTrip() {
        let viewport = Viewport(offset: CanvasPoint(x: 120, y: -45), zoom: 1.5)
        let point = CanvasPoint(x: 333, y: -12)
        let back = viewport.toCanvas(viewport.toScreen(point))
        XCTAssertEqual(back.x, point.x, accuracy: 1e-9)
        XCTAssertEqual(back.y, point.y, accuracy: 1e-9)
        XCTAssertEqual(viewport.toScreen(point), CanvasPoint(x: 333 * 1.5 + 120, y: -12 * 1.5 - 45))
    }

    func testZoomKeepsTheAnchorFixed() {
        let viewport = Viewport(offset: CanvasPoint(x: 30, y: 70), zoom: 0.8)
        let anchor = CanvasPoint(x: 400, y: 250)
        let under = viewport.toCanvas(anchor)
        let zoomed = viewport.zoomed(by: 1.7, anchor: anchor)
        XCTAssertEqual(zoomed.zoom, 0.8 * 1.7, accuracy: 1e-9)
        let screen = zoomed.toScreen(under)
        XCTAssertEqual(screen.x, anchor.x, accuracy: 1e-9)
        XCTAssertEqual(screen.y, anchor.y, accuracy: 1e-9)
    }

    func testFittingPutsTheRectInsideTheView() {
        let rect = CanvasRect(x: -100, y: 50, width: 900, height: 300)
        let size = CanvasSize(width: 800, height: 600)
        let viewport = Viewport.fitting(rect, in: size, padding: 40)
        let topLeft = viewport.toScreen(rect.origin)
        let bottomRight = viewport.toScreen(CanvasPoint(x: rect.maxX, y: rect.maxY))
        let view = CanvasRect(x: 0, y: 0, width: size.width, height: size.height)
        XCTAssertTrue(view.contains(topLeft))
        XCTAssertTrue(view.contains(bottomRight))
        XCTAssertEqual(viewport.zoom, 720.0 / 900, accuracy: 1e-9)

        let tiny = Viewport.fitting(CanvasRect(x: 0, y: 0, width: 10, height: 10), in: size)
        XCTAssertEqual(tiny.zoom, 2)
    }

    // A node selected beside the drawer comes into the narrower canvas by the least pan.
    func testRevealingPansJustEnoughToShowTheRect() {
        let viewport = Viewport(offset: CanvasPoint(x: 10, y: 20), zoom: 0.5)
        let size = CanvasSize(width: 600, height: 400)
        let inside = CanvasRect(x: 100, y: 100, width: 200, height: 100)
        XCTAssertEqual(viewport.revealing(inside, in: size, margin: 16), viewport)

        // Right edge at 1300 × 0.5 + 10 = 660, 76 past the 584 limit; the vertical position is kept.
        let right = viewport.revealing(CanvasRect(x: 1100, y: 100, width: 200, height: 100), in: size, margin: 16)
        XCTAssertEqual(right, Viewport(offset: CanvasPoint(x: -66, y: 20), zoom: 0.5))

        // Top-left at (-90, -30) on screen, brought to (16, 16).
        let left = viewport.revealing(CanvasRect(x: -200, y: -100, width: 100, height: 50), in: size, margin: 16)
        XCTAssertEqual(left, Viewport(offset: CanvasPoint(x: 116, y: 66), zoom: 0.5))

        // Wider than the view: its left edge goes to the margin.
        let wide = viewport.revealing(CanvasRect(x: 400, y: 100, width: 2000, height: 100), in: size, margin: 16)
        XCTAssertEqual(wide.offset.x, 16 - 400 * 0.5, accuracy: 1e-9)
    }

    func testViewportRoundTripsAndClampsWhenDecoded() throws {
        let viewport = Viewport(offset: CanvasPoint(x: 12, y: 34), zoom: 1.25)
        XCTAssertEqual(try JSONDecoder().decode(Viewport.self, from: JSONEncoder().encode(viewport)), viewport)
        let wild = try JSONDecoder().decode(Viewport.self, from: Data(#"{"zoom": 9}"#.utf8))
        XCTAssertEqual(wild, Viewport(offset: .zero, zoom: 2))
    }

    func testViewportOffsetStaysFinite() throws {
        var viewport = Viewport(offset: CanvasPoint(x: 1, y: 2))
        viewport.offset = CanvasPoint(x: 7, y: .nan)
        XCTAssertEqual(viewport.offset, CanvasPoint(x: 7, y: 0))
        viewport.offset.x = -.infinity
        XCTAssertEqual(viewport.offset, CanvasPoint(x: 0, y: 0))

        let decoder = JSONDecoder()
        decoder.nonConformingFloatDecodingStrategy = .convertFromString(
            positiveInfinity: "inf", negativeInfinity: "-inf", nan: "nan"
        )
        let json = Data(#"{"offset": {"x": "inf", "y": "nan"}, "zoom": 1}"#.utf8)
        XCTAssertEqual(try decoder.decode(Viewport.self, from: json), Viewport(offset: .zero, zoom: 1))
    }

    // MARK: - Free spot

    func testFreeSpotAvoidsNodesAndStaysVisible() {
        var goal = goal(["a", "b"])
        goal.move("a", to: CanvasPoint(x: 0, y: 0))
        goal.move("b", to: CanvasPoint(x: 200, y: 0))
        goal.move(Goal.finalID, to: CanvasPoint(x: 0, y: 100))
        let visible = CanvasRect(x: 0, y: 0, width: 600, height: 400)

        let spot = goal.freeSpot(visible: visible)
        let placed = CanvasRect(origin: spot, size: GoalNodeMetrics.stepSize)
        XCTAssertTrue(visible.contains(placed))
        for id in ["a", "b", Goal.finalID] {
            XCTAssertFalse(goal.rect(of: id)!.intersects(placed), id)
        }
    }

    func testFreeSpotFallsBackRightOfEverythingWhenTheViewIsFull() {
        var goal = goal(["a"])
        goal.move("a", to: CanvasPoint(x: 0, y: 0))
        goal.move(Goal.finalID, to: CanvasPoint(x: 400, y: 0))
        let spot = goal.freeSpot(visible: CanvasRect(x: 0, y: 0, width: 150, height: 60))
        let placed = CanvasRect(origin: spot, size: GoalNodeMetrics.stepSize)
        XCTAssertGreaterThan(spot.x, goal.bounds().maxX)
        XCTAssertFalse(goal.rect(of: "a")!.intersects(placed))
        XCTAssertFalse(goal.rect(of: Goal.finalID)!.intersects(placed))
    }

    // MARK: - Arrows and hit-testing

    func testEdgeCurveLeavesRightMiddleAndEntersLeftMiddle() {
        let source = CanvasRect(x: 0, y: 0, width: 168, height: 72)
        let target = CanvasRect(x: 216, y: 170, width: 168, height: 72)
        let curve = edgeCurve(from: source, to: target)
        XCTAssertEqual(curve.start, CanvasPoint(x: 168, y: 36))
        XCTAssertEqual(curve.end, CanvasPoint(x: 216, y: 206))
        XCTAssertEqual(curve.control1, CanvasPoint(x: 208, y: 36))
        XCTAssertEqual(curve.control2, CanvasPoint(x: 176, y: 206))
        XCTAssertEqual(distance(from: curve.point(at: 0.5), toCurve: curve), 0, accuracy: 0.5)
    }

    func testHitEdgeFindsTheArrowWithinTolerance() {
        var goal = goal(["a", "b"], edges: [("a", "b")])
        goal.move("a", to: CanvasPoint(x: 0, y: 0))
        goal.move("b", to: CanvasPoint(x: 400, y: 0))
        goal.move(Goal.finalID, to: CanvasPoint(x: 0, y: 600))
        let onArrow = CanvasPoint(x: 284, y: 36)
        XCTAssertEqual(goal.hitEdge(at: onArrow, tolerance: 6), GoalEdge(from: "a", to: "b"))
        XCTAssertEqual(goal.hitEdge(at: CanvasPoint(x: 284, y: 40), tolerance: 6), GoalEdge(from: "a", to: "b"))
        XCTAssertNil(goal.hitEdge(at: CanvasPoint(x: 284, y: 60), tolerance: 6))
    }

    func testHitNodeFindsStepsAndTheFinalNode() {
        var goal = goal(["a", "b"])
        goal.move("a", to: CanvasPoint(x: 0, y: 0))
        goal.move("b", to: CanvasPoint(x: 100, y: 0))
        goal.move(Goal.finalID, to: CanvasPoint(x: 500, y: 0))
        XCTAssertEqual(goal.hitNode(at: CanvasPoint(x: 10, y: 10)), "a")
        XCTAssertEqual(goal.hitNode(at: CanvasPoint(x: 150, y: 10)), "b")
        XCTAssertEqual(goal.hitNode(at: CanvasPoint(x: 560, y: 80)), Goal.finalID)
        XCTAssertNil(goal.hitNode(at: CanvasPoint(x: 300, y: 10)))
        XCTAssertEqual(goal.handlePoint(of: "a"), CanvasPoint(x: 168, y: 36))
        XCTAssertNil(goal.rect(of: "missing"))
    }

    func testHitNodePicksTheTopmostOfOverlappingNodes() {
        var goal = goal(["a", "b", "c"])
        goal.move("a", to: CanvasPoint(x: 0, y: 0))
        goal.move("b", to: CanvasPoint(x: 50, y: 0))
        goal.move("c", to: CanvasPoint(x: 400, y: 0))
        goal.move(Goal.finalID, to: CanvasPoint(x: 450, y: 10))
        // a and b overlap from x 50 to 168: b comes later in `nodes`, so it is drawn on top.
        XCTAssertEqual(goal.hitNode(at: CanvasPoint(x: 100, y: 30)), "b")
        XCTAssertEqual(goal.hitNode(at: CanvasPoint(x: 20, y: 30)), "a")
        // The final node is drawn over every step.
        XCTAssertEqual(goal.hitNode(at: CanvasPoint(x: 500, y: 40)), Goal.finalID)
        XCTAssertEqual(goal.hitNode(at: CanvasPoint(x: 420, y: 40)), "c")
    }

    func testHitEdgeFindsAnArrowIntoTheFinalNode() throws {
        var goal = goal(["a"], edges: [("a", Goal.finalID)])
        goal.move("a", to: CanvasPoint(x: 0, y: 0))
        goal.move(Goal.finalID, to: CanvasPoint(x: 400, y: 100))
        let curve = edgeCurve(from: try XCTUnwrap(goal.rect(of: "a")), to: try XCTUnwrap(goal.rect(of: Goal.finalID)))
        XCTAssertEqual(goal.hitEdge(at: curve.point(at: 0.5), tolerance: 6), GoalEdge(from: "a", to: Goal.finalID))
        XCTAssertNil(goal.hitEdge(at: CanvasPoint(x: 284, y: 300), tolerance: 6))
    }

    func testHitEdgePicksTheNearestOfTwoCloseArrows() throws {
        var goal = goal(["a", "b", "c"], edges: [("a", "c"), ("b", "c")])
        goal.move("a", to: CanvasPoint(x: 0, y: 0))
        goal.move("b", to: CanvasPoint(x: 0, y: 20))
        goal.move("c", to: CanvasPoint(x: 400, y: 10))
        goal.move(Goal.finalID, to: CanvasPoint(x: 0, y: 600))
        let upper = edgeCurve(from: try XCTUnwrap(goal.rect(of: "a")), to: try XCTUnwrap(goal.rect(of: "c")))
        let lower = edgeCurve(from: try XCTUnwrap(goal.rect(of: "b")), to: try XCTUnwrap(goal.rect(of: "c")))
        // Both arrows lie within the tolerance of each point; the closer one wins.
        let nearUpper = CanvasPoint(x: 200, y: 40)
        let nearLower = CanvasPoint(x: 200, y: 52)
        XCTAssertLessThan(distance(from: nearUpper, toCurve: upper), distance(from: nearUpper, toCurve: lower))
        XCTAssertLessThan(distance(from: nearLower, toCurve: lower), distance(from: nearLower, toCurve: upper))
        XCTAssertLessThanOrEqual(distance(from: nearUpper, toCurve: lower), 20)
        XCTAssertLessThanOrEqual(distance(from: nearLower, toCurve: upper), 20)
        XCTAssertEqual(goal.hitEdge(at: nearUpper, tolerance: 20), GoalEdge(from: "a", to: "c"))
        XCTAssertEqual(goal.hitEdge(at: nearLower, tolerance: 20), GoalEdge(from: "b", to: "c"))
    }
}
