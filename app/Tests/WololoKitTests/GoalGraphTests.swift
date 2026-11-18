import XCTest
@testable import WololoKit

final class GoalGraphTests: XCTestCase {
    private let savedAt: TimeInterval = 1_763_400_000

    private func goal(_ ids: [String], edges: [(String, String)] = []) -> Goal {
        var goal = Goal(id: "g", projectID: "acme__shop", title: "Ecommerce terminado", updatedAt: savedAt)
        for (index, id) in ids.enumerated() {
            goal.addNode(GoalNode(id: id, title: id, position: CanvasPoint(x: Double(index) * 216, y: 0)))
        }
        for (from, to) in edges {
            XCTAssertEqual(goal.connect(from: from, to: to), .ok)
        }
        return goal
    }

    // MARK: - JSON

    func testGoalRoundTrips() throws {
        var original = goal(["a", "b"], edges: [("a", "b"), ("b", Goal.finalID)])
        original.description = "Que se pueda comprar"
        original.finalPosition = CanvasPoint(x: 648, y: 85)
        original.nodes[0].issue = "#131"
        original.nodes[1].manualState = .doing

        let data = try original.encoded()
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(json["schema_version"] as? Int, 1)
        XCTAssertEqual(json["id"] as? String, "g")
        XCTAssertEqual(json["project_id"] as? String, "acme__shop")
        XCTAssertNotNil(json["final_position"])
        XCTAssertEqual(json["updated_at"] as? Double, 1_763_400_000)
        let nodes = try XCTUnwrap(json["nodes"] as? [[String: Any]])
        XCTAssertEqual(nodes[1]["manual_state"] as? String, "doing")

        XCTAssertEqual(try Goal.decode(from: data), original)
    }

    func testMinimalGoalDecodesWithDefaults() throws {
        let goal = try Goal.decode(from: Data(#"{"id": "g", "project_id": "p"}"#.utf8))
        XCTAssertEqual(goal.schemaVersion, 1)
        XCTAssertEqual(goal.title, "")
        XCTAssertEqual(goal.nodes, [])
        XCTAssertEqual(goal.edges, [])
        XCTAssertEqual(goal.finalPosition, .zero)
        XCTAssertEqual(goal.updatedAt, 0)
    }

    func testGoalWithoutIDIsRejected() {
        XCTAssertThrowsError(try Goal.decode(from: Data(#"{"title": "x", "project_id": "p"}"#.utf8)))
    }

    func testGoalWithoutProjectIsRejected() {
        for json in [#"{"id": "g"}"#, #"{"id": "g", "project_id": ""}"#] {
            XCTAssertThrowsError(try Goal.decode(from: Data(json.utf8)), json) { error in
                guard case DecodingError.dataCorrupted = error else {
                    return XCTFail("expected dataCorrupted, got \(error)")
                }
            }
        }
    }

    func testUpdatedAtRoundTripsExactly() throws {
        let now = Date().timeIntervalSince1970 + 0.123_456_7
        var original = goal(["a"])
        original.updatedAt = now
        let decoded = try Goal.decode(from: try original.encoded())
        XCTAssertEqual(decoded.updatedAt, now)
        XCTAssertEqual(decoded, original)

        let file = PlanningProjectsFile(updatedAt: now, projects: [])
        XCTAssertEqual(try PlanningProjectsFile.decode(from: try file.encoded()), file)
    }

    func testGoalIDsMustBePlainFileNames() {
        for id in ["", "projects", "../x", "a/b", "a\\b", ".hidden", "a:b"] {
            XCTAssertFalse(Goal.isValidID(id), id)
        }
        XCTAssertTrue(Goal.isValidID(UUID().uuidString))
        XCTAssertTrue(Goal.isValidID("ecommerce-terminado"))
    }

    func testGoalWithAnInvalidIDIsRejected() throws {
        for id in ["projects", "../x", "a/b", ".hidden"] {
            let json = try JSONSerialization.data(withJSONObject: ["id": id, "project_id": "p"])
            XCTAssertThrowsError(try Goal.decode(from: json), id)
        }
        let id = UUID().uuidString
        let json = try JSONSerialization.data(withJSONObject: ["id": id, "project_id": "p"])
        XCTAssertEqual(try Goal.decode(from: json).id, id)
    }

    func testFilesFromANewerSchemaAreRejected() {
        XCTAssertThrowsError(try Goal.decode(from: Data(#"{"id": "g", "project_id": "p", "schema_version": 2}"#.utf8)))
        XCTAssertNoThrow(try Goal.decode(from: Data(#"{"id": "g", "project_id": "p", "schema_version": 1}"#.utf8)))
        XCTAssertThrowsError(try PlanningProjectsFile.decode(from: Data(#"{"schema_version": 2}"#.utf8)))
        XCTAssertNoThrow(try PlanningProjectsFile.decode(from: Data(#"{"schema_version": 1}"#.utf8)))
    }

    func testIssuesAreStoredTrimmed() throws {
        XCTAssertEqual(GoalNode(id: "a", issue: "  #131\n").issue, "#131")
        XCTAssertNil(GoalNode(id: "a", issue: " \n\t").issue)

        let node = try JSONDecoder().decode(GoalNode.self, from: Data(#"{"id": "a", "issue": "\n owner/repo#12 \t"}"#.utf8))
        XCTAssertEqual(node.issue, "owner/repo#12")
        let blank = try JSONDecoder().decode(GoalNode.self, from: Data(#"{"id": "a", "issue": " \n "}"#.utf8))
        XCTAssertNil(blank.issue)
    }

    func testDecodingDropsBrokenNodesAndEdges() throws {
        let json = #"""
        {
          "id": "g",
          "project_id": "acme__shop",
          "updated_at": 1763400000,
          "nodes": [
            {"id": "a", "manual_state": "someday", "position": {"x": "left"}},
            {"title": "sin id"},
            {"id": "final"},
            {"id": "b", "issue": "  "},
            {"id": "a", "title": "repetido"},
            7
          ],
          "edges": [
            {"from": "a", "to": "b"},
            {"from": "a", "to": "b"},
            {"from": "b", "to": "a"},
            {"from": "final", "to": "a"},
            {"from": "a", "to": "ghost"},
            {"from": "b", "to": "final"}
          ]
        }
        """#
        let goal = try Goal.decode(from: Data(json.utf8))

        XCTAssertEqual(goal.updatedAt, savedAt)
        XCTAssertEqual(goal.nodes.map(\.id), ["a", "b"])
        XCTAssertNil(goal.nodes[0].manualState)
        XCTAssertEqual(goal.nodes[0].title, "")
        XCTAssertEqual(goal.nodes[0].position, .zero)
        XCTAssertNil(goal.nodes[1].issue)
        XCTAssertEqual(goal.edges, [GoalEdge(from: "a", to: "b"), GoalEdge(from: "b", to: Goal.finalID)])
    }

    func testProjectsFileRoundTrips() throws {
        let file = PlanningProjectsFile(updatedAt: savedAt, projects: [
            PlanningProject(id: "acme__shop", name: "shop", path: "/Users/me/code/shop", repo: "acme/shop",
                            key: "acme__shop"),
            PlanningProject(id: "p2", name: "notas", path: "/Users/me/notas"),
        ])

        let data = try file.encoded()
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(json["schema_version"] as? Int, 1)
        XCTAssertEqual(json["id"] as? String, "projects")
        XCTAssertEqual(json["updated_at"] as? Double, 1_763_400_000)

        XCTAssertEqual(try PlanningProjectsFile.decode(from: data), file)
    }

    func testMinimalProjectsFileDecodes() throws {
        let file = try PlanningProjectsFile.decode(from: Data(#"""
        {"projects": [{"id": "p", "path": "/tmp/p", "repo": ""}, {"name": "sin id"}]}
        """#.utf8))
        XCTAssertEqual(file.schemaVersion, 1)
        XCTAssertEqual(file.projects, [PlanningProject(id: "p", name: "p", path: "/tmp/p")])
    }

    func testProjectKeys() {
        XCTAssertEqual(PlanningProject.key(forRepo: "acme/shop"), "acme__shop")
        XCTAssertEqual(PlanningProject(id: "p", name: "shop", path: "/p", repo: "acme/shop").effectiveKey,
                       "acme__shop")
        XCTAssertEqual(PlanningProject(id: "p", name: "shop", path: "/p", repo: "acme/shop", key: "custom").effectiveKey,
                       "custom")
        XCTAssertEqual(PlanningProject(id: "p", name: "shop", path: "/p", key: "local").effectiveKey, "local")
        XCTAssertNil(PlanningProject(id: "p", name: "notas", path: "/p").effectiveKey)
    }

    // MARK: - Connecting

    func testConnectingBackIntoAChainIsACycleAndChangesNothing() {
        var goal = goal(["a", "b", "c"], edges: [("a", "b"), ("b", "c")])
        let before = goal

        XCTAssertEqual(goal.connect(from: "c", to: "a"), .cycle)
        XCTAssertEqual(goal, before)
    }

    func testDiamondAcceptsCrossLinksButNotLoops() {
        var goal = goal(["a", "b", "c", "d"], edges: [("a", "b"), ("a", "c"), ("b", "d"), ("c", "d")])
        let before = goal

        XCTAssertEqual(goal.connect(from: "d", to: "a"), .cycle)
        XCTAssertEqual(goal, before)
        XCTAssertEqual(goal.connect(from: "b", to: "c"), .ok)
    }

    func testClosingALongChainIsACycle() {
        var goal = goal(["a", "b", "c", "d", "e"], edges: [("a", "b"), ("b", "c"), ("c", "d"), ("d", "e")])
        XCTAssertEqual(goal.connect(from: "e", to: "a"), .cycle)
        XCTAssertEqual(goal.edges.count, 4)
    }

    func testIndependentBranchesCanBothReachTheFinalNode() {
        var goal = goal(["a", "b", "c", "d"], edges: [("a", "b"), ("c", "d")])
        XCTAssertEqual(goal.connect(from: "b", to: Goal.finalID), .ok)
        XCTAssertEqual(goal.connect(from: "d", to: Goal.finalID), .ok)
        XCTAssertEqual(goal.predecessors(of: Goal.finalID), ["b", "d"])
    }

    func testDuplicateEdgeIsRejected() {
        var goal = goal(["a", "b"], edges: [("a", "b")])
        XCTAssertEqual(goal.connect(from: "a", to: "b"), .duplicate)
        XCTAssertEqual(goal.edges.count, 1)
    }

    func testFinalNodeCannotBeAnOrigin() {
        var goal = goal(["a"])
        XCTAssertEqual(goal.connect(from: Goal.finalID, to: "a"), .fromFinal)
        XCTAssertEqual(goal.edges, [])
        XCTAssertEqual(goal.connect(from: "a", to: Goal.finalID), .ok)
    }

    func testSelfLoopsAndUnknownNodesAreRejected() {
        var goal = goal(["a"])
        XCTAssertEqual(goal.connect(from: "a", to: "a"), .selfLoop)
        XCTAssertEqual(goal.connect(from: "a", to: "ghost"), .unknownNode)
        XCTAssertEqual(goal.connect(from: "ghost", to: "a"), .unknownNode)
        XCTAssertEqual(goal.edges, [])
    }

    func testPredecessorsAndSuccessors() {
        let goal = goal(["a", "b", "c"], edges: [("a", "c"), ("b", "c"), ("c", Goal.finalID)])
        XCTAssertEqual(goal.predecessors(of: "c"), ["a", "b"])
        XCTAssertEqual(goal.successors(of: "a"), ["c"])
        XCTAssertEqual(goal.predecessors(of: Goal.finalID), ["c"])
        XCTAssertEqual(goal.successors(of: Goal.finalID), [])
    }

    // MARK: - Editing

    func testAddNodeRejectsRepeatedAndFinalIDs() {
        var goal = goal(["a"])
        XCTAssertFalse(goal.addNode(GoalNode(id: "a")))
        XCTAssertFalse(goal.addNode(GoalNode(id: Goal.finalID)))
        XCTAssertEqual(goal.steps.map(\.id), ["a"])
    }

    func testRemovingANodeRemovesItsEdges() {
        var goal = goal(["a", "b", "c"], edges: [("a", "b"), ("b", "c"), ("a", "c"), ("c", Goal.finalID)])

        XCTAssertTrue(goal.removeNode("b"))
        XCTAssertEqual(goal.nodes.map(\.id), ["a", "c"])
        XCTAssertEqual(goal.edges, [GoalEdge(from: "a", to: "c"), GoalEdge(from: "c", to: Goal.finalID)])
    }

    func testRemovingTheFinalNodeDoesNothing() {
        var goal = goal(["a"], edges: [("a", Goal.finalID)])
        let before = goal

        XCTAssertFalse(goal.removeNode(Goal.finalID))
        XCTAssertEqual(goal, before)
    }

    func testRemoveEdge() {
        var goal = goal(["a", "b"], edges: [("a", "b"), ("b", Goal.finalID)])
        XCTAssertTrue(goal.removeEdge(GoalEdge(from: "a", to: "b")))
        XCTAssertFalse(goal.removeEdge(GoalEdge(from: "a", to: "b")))
        XCTAssertEqual(goal.edges, [GoalEdge(from: "b", to: Goal.finalID)])
    }

    func testMoveUpdatesNodesAndTheFinalPosition() {
        var goal = goal(["a"])
        XCTAssertTrue(goal.move("a", to: CanvasPoint(x: 10, y: 20)))
        XCTAssertTrue(goal.move(Goal.finalID, to: CanvasPoint(x: 400, y: 30)))
        XCTAssertFalse(goal.move("ghost", to: .zero))

        XCTAssertEqual(goal.position(of: "a"), CanvasPoint(x: 10, y: 20))
        XCTAssertEqual(goal.finalPosition, CanvasPoint(x: 400, y: 30))
        XCTAssertEqual(goal.position(of: Goal.finalID), CanvasPoint(x: 400, y: 30))
    }

    func testEditingLeavesUpdatedAtAlone() {
        var goal = goal(["a", "b"])
        goal.connect(from: "a", to: "b")
        goal.move("a", to: CanvasPoint(x: 1, y: 1))
        goal.removeNode("b")
        XCTAssertEqual(goal.updatedAt, savedAt)
    }

    // MARK: - Progress

    func testProgressCountsDoneSteps() {
        let goal = goal(["a", "b", "c", "d", "e", "f", "g"])
        let progress = goal.progress(doneIDs: ["a", "c", Goal.finalID, "ghost"])

        XCTAssertEqual(progress.done, 2)
        XCTAssertEqual(progress.total, 7)
        XCTAssertEqual(progress.fraction, 0.2857, accuracy: 1e-4)
    }

    func testProgressOfAGoalWithoutSteps() {
        let progress = goal([]).progress(doneIDs: [])
        XCTAssertEqual(progress.done, 0)
        XCTAssertEqual(progress.total, 0)
        XCTAssertEqual(progress.fraction, 0)
    }
}
