import XCTest
@testable import WololoKit

@MainActor
final class GoalSessionTests: XCTestCase {
    private var fixture: StoreFixture!
    /// Stands in for `Application Support/Wololo Desk/Goals`.
    private var local: URL { fixture.root.appendingPathComponent("support/Goals") }
    private var data: URL { fixture.root.appendingPathComponent("data") }
    private var mirror: URL { GoalStore.mirrorDirectory(dataDirectory: data) }
    /// Each read of the clock is one second later, so `updatedAt` tells how many saves there were.
    private var ticks: TimeInterval = 1_763_400_000
    private var reports: [[String]] = []

    private let shop = PlanningProject(id: "acme__shop", name: "shop", path: "/code/shop", repo: "acme/shop")

    override func setUpWithError() throws {
        fixture = try StoreFixture(createRuns: false)
        try FileManager.default.createDirectory(at: data, withIntermediateDirectories: true)
        ticks = 1_763_400_000
        reports = []
    }

    override func tearDown() {
        fixture = nil
    }

    private func store(writes: Bool = true) -> GoalStore {
        GoalStore(directory: local, mirror: mirror, writes: writes)
    }

    private func session(writes: Bool = true, delay: Duration = .milliseconds(20)) -> GoalSession {
        let session = GoalSession(store: store(writes: writes), textSaveDelay: delay) { [unowned self] in
            ticks += 1
            return ticks
        }
        session.report = { [unowned self] in reports.append($0) }
        return session
    }

    private func saved(_ id: String) -> Goal? {
        store().load().goals.first { $0.id == id }
    }

    private func exists(_ url: URL) -> Bool {
        FileManager.default.fileExists(atPath: url.path)
    }

    func testTextEditsAreSavedOnceAfterTheLastOne() async throws {
        let session = session()
        session.saveProjects([shop])
        var goal = try XCTUnwrap(session.createGoal(in: shop))
        let created = try XCTUnwrap(saved(goal.id)).updatedAt

        goal.title = "E"
        session.updateText(goal)
        goal.title = "Ecommerce"
        session.updateText(goal)
        XCTAssertEqual(session.goal(id: goal.id)?.title, "Ecommerce", "shown at once")
        XCTAssertEqual(saved(goal.id)?.title, "Objetivo nuevo", "not written per keystroke")
        XCTAssertTrue(session.hasPendingSaves)

        let deadline = Date().addingTimeInterval(2)
        while session.hasPendingSaves, Date() < deadline {
            try await Task.sleep(for: .milliseconds(20))
        }
        let written = try XCTUnwrap(saved(goal.id))
        XCTAssertEqual(written.title, "Ecommerce")
        XCTAssertEqual(written.updatedAt, created + 1, "the two edits are one save")
        XCTAssertFalse(session.hasPendingSaves)
    }

    func testFlushWritesWhatIsWaiting() throws {
        let session = session(delay: .seconds(60))
        session.saveProjects([shop])
        var goal = try XCTUnwrap(session.createGoal(in: shop))
        goal.title = "Ecommerce terminado"
        session.updateText(goal)
        XCTAssertEqual(saved(goal.id)?.title, "Objetivo nuevo")

        session.flush()
        XCTAssertEqual(saved(goal.id)?.title, "Ecommerce terminado")
        XCTAssertFalse(session.hasPendingSaves)
    }

    func testAStructuralChangeSavesNowWithThePendingText() throws {
        let session = session(delay: .seconds(60))
        session.saveProjects([shop])
        var goal = try XCTUnwrap(session.createGoal(in: shop))
        goal.title = "Ecommerce terminado"
        session.updateText(goal)
        goal.addNode(GoalNode(id: "a", title: "Checkout"))
        session.update(goal)

        let written = try XCTUnwrap(saved(goal.id))
        XCTAssertEqual(written.title, "Ecommerce terminado")
        XCTAssertEqual(written.nodes.map(\.id).contains("a"), true)
        XCTAssertFalse(session.hasPendingSaves, "the pending text save is folded in")
    }

    func testCreatingAGoalSavesTheProjectTheRunsName() throws {
        let session = session()
        let goal = try XCTUnwrap(session.createGoal(in: shop))

        let snapshot = store().load()
        XCTAssertEqual(snapshot.projects, [shop])
        XCTAssertEqual(snapshot.goals.map(\.id), [goal.id])
        XCTAssertEqual(goal.projectID, shop.id)
        XCTAssertEqual(session.storedProjects, [shop])
    }

    func testDeletingAGoalRemovesItsFileAndCopy() throws {
        let session = session()
        let goal = try XCTUnwrap(session.createGoal(in: shop))
        XCTAssertTrue(exists(local.appendingPathComponent("\(goal.id).json")))
        XCTAssertTrue(exists(mirror.appendingPathComponent("\(goal.id).json")))

        XCTAssertTrue(session.deleteGoal(id: goal.id))
        XCTAssertFalse(exists(local.appendingPathComponent("\(goal.id).json")))
        XCTAssertFalse(exists(mirror.appendingPathComponent("\(goal.id).json")))
        XCTAssertNil(session.goal(id: goal.id))
    }

    func testDeletingAProjectRemovesItsGoalsAndKeepsTheOthers() throws {
        let blog = PlanningProject(id: "acme__blog", name: "blog", path: "/code/blog", repo: "acme/blog")
        let session = session()
        let first = try XCTUnwrap(session.createGoal(in: shop))
        let second = try XCTUnwrap(session.createGoal(in: shop))
        let kept = try XCTUnwrap(session.createGoal(in: blog))

        XCTAssertTrue(session.deleteProject(id: shop.id))
        XCTAssertEqual(session.storedProjects, [blog])
        XCTAssertEqual(session.goals.map(\.id), [kept.id])
        let snapshot = store().load()
        XCTAssertEqual(snapshot.projects, [blog])
        XCTAssertEqual(snapshot.goals.map(\.id), [kept.id])
        for id in [first.id, second.id] {
            XCTAssertFalse(exists(local.appendingPathComponent("\(id).json")))
            XCTAssertFalse(exists(mirror.appendingPathComponent("\(id).json")))
        }
    }

    func testAProjectStaysWhenOneOfItsGoalsCantBeDeleted() throws {
        let session = session()
        let first = try XCTUnwrap(session.createGoal(in: shop))
        let stuck = try XCTUnwrap(session.createGoal(in: shop))
        // The first goal's copy is already gone; the second's sits in a copy folder that can't be changed.
        try FileManager.default.removeItem(at: mirror.appendingPathComponent("\(first.id).json"))
        try FileManager.default.setAttributes([.posixPermissions: 0o555], ofItemAtPath: mirror.path)
        addTeardownBlock { [mirror] in
            try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: mirror.path)
        }

        XCTAssertFalse(session.deleteProject(id: shop.id))
        XCTAssertEqual(session.storedProjects, [shop])
        XCTAssertEqual(store().load().projects, [shop])
        XCTAssertEqual(session.goals.map(\.id), [stuck.id])
        XCTAssertFalse(exists(local.appendingPathComponent("\(first.id).json")))
        XCTAssertTrue(exists(local.appendingPathComponent("\(stuck.id).json")))
        XCTAssertTrue(exists(mirror.appendingPathComponent("\(stuck.id).json")))
        XCTAssertEqual(reports.first?.first, "No pude borrar el objetivo")
    }

    func testAProjectIsNotDeletedWhileProjectsJSONIsUnreadable() throws {
        let session = session()
        let goal = try XCTUnwrap(session.createGoal(in: shop))
        try Data("{ broken".utf8).write(to: local.appendingPathComponent(GoalStore.projectsFileName))
        session.load()

        XCTAssertFalse(session.deleteProject(id: shop.id))
        XCTAssertEqual(session.goals.map(\.id), [goal.id])
        XCTAssertTrue(exists(local.appendingPathComponent("\(goal.id).json")))
    }

    func testProjectsAreNotSavedOverAnUnreadableFile() throws {
        try FileManager.default.createDirectory(at: local, withIntermediateDirectories: true)
        let file = local.appendingPathComponent(GoalStore.projectsFileName)
        try Data("{ broken".utf8).write(to: file)
        let session = session()
        session.load()
        XCTAssertTrue(session.projectsUnreadable)
        XCTAssertEqual(reports.count, 1)

        XCTAssertFalse(session.saveProjects([shop]))
        XCTAssertEqual(try Data(contentsOf: file), Data("{ broken".utf8))
        XCTAssertEqual(session.storedProjects, [shop], "kept on screen")
        XCTAssertEqual(reports.count, 2)
    }

    func testAFailedProjectsWriteKeepsTheStoredProjects() throws {
        // A file where the goals folder should be: nothing can be written into it.
        try FileManager.default.createDirectory(at: local.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data().write(to: local)
        let session = session()

        XCTAssertFalse(session.saveProjects([shop]))
        XCTAssertEqual(session.storedProjects, [])
        XCTAssertEqual(reports.first?.first, "No pude guardar los proyectos")
    }

    func testNoGoalIsCreatedWhenItsProjectCantBeSaved() throws {
        // A file where the goals folder should be: the project the runs name can't be saved.
        try FileManager.default.createDirectory(at: local.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data().write(to: local)
        let session = session()

        XCTAssertNil(session.createGoal(in: shop))
        XCTAssertEqual(session.goals, [])
        XCTAssertEqual(session.storedProjects, [])
        XCTAssertEqual(reports.map(\.first),
                       ["No pude guardar los proyectos", "No creé el objetivo: no pude guardar su proyecto"])
        XCTAssertFalse(session.projectsUnreadable)
    }

    func testLoadImportsTheCopysGoals() throws {
        let remote = GoalStore(directory: mirror, mirror: nil, writes: true)
        try remote.saveProjects([shop], at: 1)
        try remote.save(Goal(id: "ecommerce", projectID: shop.id, title: "Ecommerce terminado", updatedAt: 1))

        let session = session()
        session.load()
        XCTAssertEqual(session.goals.map(\.id), ["ecommerce"])
        XCTAssertEqual(session.storedProjects, [shop])
        XCTAssertNotNil(saved("ecommerce"), "brought into the source of truth")
    }

    func testWithoutWritesNothingTouchesTheDisk() async throws {
        let remote = GoalStore(directory: mirror, mirror: nil, writes: true)
        try remote.save(Goal(id: "ecommerce", projectID: shop.id, title: "Ecommerce terminado", updatedAt: 1))
        let mirrorFiles = try FileManager.default.contentsOfDirectory(atPath: mirror.path).sorted()

        let session = session(writes: false)
        session.load()
        XCTAssertEqual(session.goals.map(\.id), ["ecommerce"], "imported in memory")
        var goal = try XCTUnwrap(session.createGoal(in: shop))
        goal.title = "Otro"
        session.updateText(goal)
        session.update(goal)
        session.updateText(goal)
        session.flush()
        session.saveProjects([shop])
        session.deleteGoal(id: "ecommerce")
        try await Task.sleep(for: .milliseconds(100))

        XCTAssertFalse(exists(local))
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: mirror.path).sorted(), mirrorFiles)
        XCTAssertEqual(reports, [])
    }
}
