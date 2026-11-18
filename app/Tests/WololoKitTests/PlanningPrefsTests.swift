import XCTest
@testable import WololoKit

final class PlanningPrefsTests: XCTestCase {
    private var suiteName = ""
    private var defaults: UserDefaults!

    override func setUp() {
        super.setUp()
        suiteName = "PlanningPrefsTests-\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        defaults = nil
        super.tearDown()
    }

    func testNothingSavedOpensOperation() {
        let prefs = PlanningPrefs(defaults: defaults, persists: true)
        XCTAssertEqual(prefs.tab, .operation)
        XCTAssertNil(prefs.selectedProjectID)
        XCTAssertNil(prefs.selectedGoalID)
        XCTAssertNil(prefs.viewport(forGoal: "g1"))
    }

    /// Scenario 13: the tab, the goal and its viewport come back on the next launch.
    func testRemembersTabSelectionAndViewport() throws {
        let prefs = PlanningPrefs(defaults: defaults, persists: true)
        prefs.tab = .planning
        prefs.selectedProjectID = "acme__shop"
        prefs.selectedGoalID = "g1"
        prefs.setViewport(Viewport(offset: CanvasPoint(x: 120, y: -40), zoom: 1.5), forGoal: "g1")
        prefs.setViewport(Viewport(offset: CanvasPoint(x: 3, y: 4), zoom: 0.5), forGoal: "g2")

        let next = PlanningPrefs(defaults: try XCTUnwrap(UserDefaults(suiteName: suiteName)), persists: true)
        XCTAssertEqual(next.tab, .planning)
        XCTAssertEqual(next.selectedProjectID, "acme__shop")
        XCTAssertEqual(next.selectedGoalID, "g1")
        XCTAssertEqual(next.viewport(forGoal: "g1"), Viewport(offset: CanvasPoint(x: 120, y: -40), zoom: 1.5))
        XCTAssertEqual(next.viewport(forGoal: "g2"), Viewport(offset: CanvasPoint(x: 3, y: 4), zoom: 0.5))

        next.selectedGoalID = nil
        next.removeViewport(forGoal: "g1")
        XCTAssertNil(prefs.selectedGoalID)
        XCTAssertNil(prefs.viewport(forGoal: "g1"))
        XCTAssertNotNil(prefs.viewport(forGoal: "g2"))
    }

    func testDoesNotWriteViewportsThatAreNotFinite() {
        let prefs = PlanningPrefs(defaults: defaults, persists: true)
        let saved = Viewport(offset: CanvasPoint(x: 10, y: 20), zoom: 1)
        prefs.setViewport(saved, forGoal: "g1")
        prefs.setViewport(Viewport(offset: CanvasPoint(x: .nan, y: 0), zoom: 1), forGoal: "g1")
        prefs.setViewport(Viewport(offset: CanvasPoint(x: 0, y: .infinity), zoom: 1), forGoal: "g1")
        XCTAssertEqual(prefs.viewport(forGoal: "g1"), saved)
        prefs.setViewport(Viewport(offset: CanvasPoint(x: -.infinity, y: 0), zoom: 1), forGoal: "g2")
        XCTAssertNil(prefs.viewport(forGoal: "g2"))
    }

    func testReadsTolerateGarbage() {
        defaults.set(42, forKey: PlanningPrefs.Key.tab)
        defaults.set(["not", "a", "string"], forKey: PlanningPrefs.Key.projectID)
        defaults.set("", forKey: PlanningPrefs.Key.goalID)
        defaults.set(["g1": Data("{not json".utf8), "g2": "text", "g3": Data(#"{"zoom": 9}"#.utf8)],
                     forKey: PlanningPrefs.Key.viewports)
        let prefs = PlanningPrefs(defaults: defaults, persists: true)
        XCTAssertEqual(prefs.tab, .operation)
        XCTAssertNil(prefs.selectedProjectID)
        XCTAssertNil(prefs.selectedGoalID)
        XCTAssertNil(prefs.viewport(forGoal: "g1"))
        XCTAssertNil(prefs.viewport(forGoal: "g2"))
        XCTAssertEqual(prefs.viewport(forGoal: "g3"), Viewport(offset: .zero, zoom: Viewport.maxZoom), "the zoom is clamped")

        defaults.set("kanban", forKey: PlanningPrefs.Key.tab)
        XCTAssertEqual(prefs.tab, .operation)

        defaults.set("not a dictionary", forKey: PlanningPrefs.Key.viewports)
        XCTAssertNil(prefs.viewport(forGoal: "g3"))
        prefs.setViewport(Viewport(offset: CanvasPoint(x: 1, y: 2), zoom: 1), forGoal: "g4")
        XCTAssertEqual(prefs.viewport(forGoal: "g4"), Viewport(offset: CanvasPoint(x: 1, y: 2), zoom: 1),
                       "a damaged value is replaced on the next save")
    }

    /// Scenario 17: a snapshot reads but never writes.
    func testWithoutPersistingNothingIsWritten() {
        defaults.set("planning", forKey: PlanningPrefs.Key.tab)
        let prefs = PlanningPrefs(defaults: defaults, persists: false)
        XCTAssertEqual(prefs.tab, .planning)
        prefs.tab = .operation
        prefs.selectedProjectID = "p"
        prefs.selectedGoalID = "g"
        prefs.setViewport(.identity, forGoal: "g")
        prefs.removeViewport(forGoal: "g")
        XCTAssertEqual(defaults.string(forKey: PlanningPrefs.Key.tab), "planning")
        XCTAssertNil(defaults.object(forKey: PlanningPrefs.Key.projectID))
        XCTAssertNil(defaults.object(forKey: PlanningPrefs.Key.goalID))
        XCTAssertNil(defaults.object(forKey: PlanningPrefs.Key.viewports))
    }
}
