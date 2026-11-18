import XCTest
@testable import WololoKit

final class GoalStoreTests: XCTestCase {
    private let savedAt: TimeInterval = 1_763_400_000
    private var fixture: StoreFixture!
    /// Stands in for `Application Support/Wololo Desk/Goals`.
    private var local: URL { fixture.root.appendingPathComponent("support/Goals") }
    /// Stands in for wololo's data directory; it exists unless a test removes it.
    private var data: URL { fixture.root.appendingPathComponent("data") }
    private var mirror: URL { GoalStore.mirrorDirectory(dataDirectory: data) }

    override func setUpWithError() throws {
        fixture = try StoreFixture(createRuns: false)
        try FileManager.default.createDirectory(at: data, withIntermediateDirectories: true)
    }

    override func tearDown() {
        fixture = nil
    }

    private func store(writes: Bool = true, log: @escaping @Sendable (String) -> Void = { _ in }) -> GoalStore {
        GoalStore(directory: local, mirror: mirror, writes: writes, log: log)
    }

    private func goal(_ id: String, project: String = "acme__shop", title: String = "Ecommerce terminado") -> Goal {
        var goal = Goal(id: id, projectID: project, title: title, updatedAt: savedAt)
        goal.addNode(GoalNode(id: "a", title: "Checkout", issue: "#131"))
        goal.connect(from: "a", to: Goal.finalID)
        return goal
    }

    private let shop = PlanningProject(id: "acme__shop", name: "shop", path: "/code/shop", repo: "acme/shop")
    private let blog = PlanningProject(id: "acme__blog", name: "blog", path: "/code/blog", repo: "acme/blog")

    private func contents(_ folder: URL) -> [String] {
        ((try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? []).sorted()
    }

    private func exists(_ url: URL) -> Bool {
        FileManager.default.fileExists(atPath: url.path)
    }

    /// `goal(id)` as a newer app would write it.
    private func newerGoalData(_ id: String) throws -> Data {
        var json = try XCTUnwrap(JSONSerialization.jsonObject(with: goal(id).encoded()) as? [String: Any])
        json["schema_version"] = 99
        return try JSONSerialization.data(withJSONObject: json)
    }

    private func projectsIn(_ folder: URL) throws -> [PlanningProject] {
        try PlanningProjectsFile.decode(from: Data(contentsOf: folder.appendingPathComponent("projects.json"))).projects
    }

    /// Makes `folder` read-only until the test ends.
    private func makeReadOnly(_ folder: URL) throws {
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try FileManager.default.setAttributes([.posixPermissions: 0o555], ofItemAtPath: folder.path)
        addTeardownBlock {
            try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: folder.path)
        }
    }

    // MARK: - Saving

    /// Scenario 14.
    func testSavedGoalHasTheSameBytesLocallyAndInTheCopy() throws {
        let store = store()
        try store.save(goal("g"))
        try store.saveProjects([shop], at: savedAt)

        for name in ["g.json", "projects.json"] {
            let localData = try Data(contentsOf: local.appendingPathComponent(name))
            let mirrorData = try Data(contentsOf: mirror.appendingPathComponent(name))
            XCTAssertEqual(localData, mirrorData, name)
        }
        XCTAssertEqual(try Goal.decode(from: Data(contentsOf: local.appendingPathComponent("g.json"))), goal("g"))
        let projects = try PlanningProjectsFile.decode(from: Data(contentsOf: local.appendingPathComponent("projects.json")))
        XCTAssertEqual(projects.projects, [shop])
        XCTAssertEqual(projects.updatedAt, savedAt)
    }

    func testSaveLeavesNoStagingFileBehind() throws {
        let store = store()
        try store.save(goal("g"))
        try store.save(goal("g", title: "Otra vez"))
        try store.saveProjects([shop], at: savedAt)

        XCTAssertEqual(contents(local), ["g.json", "projects.json"])
        XCTAssertEqual(contents(mirror), ["g.json", "projects.json"])
        XCTAssertEqual(store.load().goals.first?.title, "Otra vez")
    }

    /// Scenario 16.
    func testSaveWorksWithoutCreatingTheCopyWhenTheDataDirectoryIsMissing() throws {
        try FileManager.default.removeItem(at: data)
        let store = store()
        try store.save(goal("g"))
        try store.saveProjects([shop], at: savedAt)

        XCTAssertTrue(exists(local.appendingPathComponent("g.json")))
        XCTAssertTrue(exists(local.appendingPathComponent("projects.json")))
        XCTAssertFalse(exists(data))
    }

    func testAFailingCopyIsLoggedAndDoesNotStopTheSave() throws {
        // A file where the `goals` folder should be: the copy can't be written.
        try Data().write(to: mirror)
        let logged = Logged()
        let store = store(log: logged.append)
        try store.save(goal("g"))

        XCTAssertTrue(exists(local.appendingPathComponent("g.json")))
        XCTAssertFalse(logged.lines.isEmpty)
    }

    func testSaveRejectsAGoalWhoseIDCantNameAFile() {
        let store = store()
        for id in ["", "projects", ".hidden", "a/b", "a:b"] {
            XCTAssertThrowsError(try store.save(goal(id)), id)
        }
        XCTAssertFalse(exists(local))
    }

    func testSaveRejectsAGoalWithoutAProject() {
        let store = store()
        XCTAssertThrowsError(try store.save(goal("g", project: "")))
        XCTAssertFalse(exists(local))
    }

    func testAFailedWriteLeavesNoStagingFileBehind() throws {
        try makeReadOnly(local)
        XCTAssertThrowsError(try store().save(goal("g")))
        XCTAssertEqual(contents(local), [])
    }

    func testSaveProjectsRefusesWhileTheProjectsFileIsUnreadable() throws {
        try FileManager.default.createDirectory(at: local, withIntermediateDirectories: true)
        let damaged = Data("{ half".utf8)
        try damaged.write(to: local.appendingPathComponent("projects.json"))

        XCTAssertThrowsError(try store().saveProjects([shop], at: savedAt)) { error in
            XCTAssertEqual(error as? GoalStore.Failure, .unreadableProjectsFile)
        }
        XCTAssertEqual(try Data(contentsOf: local.appendingPathComponent("projects.json")), damaged)
        XCTAssertFalse(exists(mirror.appendingPathComponent("projects.json")))
    }

    func testSavingProjectsKeepsTheCopysProjectsOfGoalsNotImportedYet() throws {
        // Another machine left goal x of blog in the copy, and projects that this machine has under other names.
        try FileManager.default.createDirectory(at: mirror, withIntermediateDirectories: true)
        try goal("x", project: "acme__blog").encoded().write(to: mirror.appendingPathComponent("x.json"))
        let unused = PlanningProject(id: "acme__unused", name: "unused", path: "/code/unused")
        let renamedShop = PlanningProject(id: "acme__shop", name: "otra", path: "/elsewhere")
        try PlanningProjectsFile(updatedAt: 1, projects: [renamedShop, blog, unused]).encoded()
            .write(to: mirror.appendingPathComponent("projects.json"))

        let store = store()
        try store.saveProjects([shop], at: savedAt)

        XCTAssertEqual(try projectsIn(local), [shop])
        XCTAssertEqual(try projectsIn(mirror), [shop, blog])
        XCTAssertEqual(store.importMirror().projects, [blog])
    }

    func testSavingProjectsLeavesAnUnreadableCopyOfTheProjectsFileAlone() throws {
        try FileManager.default.createDirectory(at: mirror, withIntermediateDirectories: true)
        let damaged = Data("{ half".utf8)
        try damaged.write(to: mirror.appendingPathComponent("projects.json"))
        let logged = Logged()

        try store(log: logged.append).saveProjects([shop], at: savedAt)

        XCTAssertEqual(try projectsIn(local), [shop])
        XCTAssertEqual(try Data(contentsOf: mirror.appendingPathComponent("projects.json")), damaged)
        XCTAssertTrue(logged.lines.contains { $0.contains("Did not copy projects.json") })
    }

    func testSavingProjectsKeepsAllTheCopysProjectsWhileAGoalThereIsUnreadable() throws {
        // The unreadable goal may be blog's or unused's: neither can be dropped.
        try FileManager.default.createDirectory(at: mirror, withIntermediateDirectories: true)
        try Data("{ half".utf8).write(to: mirror.appendingPathComponent("broken.json"))
        let unused = PlanningProject(id: "acme__unused", name: "unused", path: "/code/unused")
        try PlanningProjectsFile(updatedAt: 1, projects: [blog, unused]).encoded()
            .write(to: mirror.appendingPathComponent("projects.json"))

        try store().saveProjects([shop], at: savedAt)

        XCTAssertEqual(try projectsIn(local), [shop])
        XCTAssertEqual(try projectsIn(mirror), [shop, blog, unused])
    }

    /// Scenario 17.
    func testWithoutWritesNothingTouchesTheDisk() throws {
        try FileManager.default.createDirectory(at: mirror, withIntermediateDirectories: true)
        try goal("x").encoded().write(to: mirror.appendingPathComponent("x.json"))
        let store = store(writes: false)

        try store.save(goal("g"))
        try store.saveProjects([shop], at: savedAt)
        try store.delete(goalID: "x")
        let imported = store.importMirror()

        XCTAssertEqual(imported.goals.map(\.id), ["x"])
        XCTAssertFalse(exists(local))
        XCTAssertEqual(contents(mirror), ["x.json"])
    }

    // MARK: - Deleting

    func testDeleteRemovesTheGoalAndItsCopy() throws {
        let store = store()
        try store.save(goal("g"))
        try store.save(goal("h"))
        try store.delete(goalID: "g")

        XCTAssertEqual(contents(local), ["h.json"])
        XCTAssertEqual(contents(mirror), ["h.json"])
        XCTAssertNoThrow(try store.delete(goalID: "g"))
    }

    func testDeleteKeepsTheGoalWhenItsCopyCantBeRemoved() throws {
        let store = store()
        try store.save(goal("g"))
        try makeReadOnly(mirror)

        XCTAssertThrowsError(try store.delete(goalID: "g"))
        XCTAssertTrue(exists(local.appendingPathComponent("g.json")))
        XCTAssertTrue(exists(mirror.appendingPathComponent("g.json")))
    }

    func testDeleteWorksWhenTheCopyFolderIsAFile() throws {
        let store = store()
        try store.save(goal("g"))
        try FileManager.default.removeItem(at: mirror)
        try Data().write(to: mirror)

        XCTAssertNoThrow(try store.delete(goalID: "g"))
        XCTAssertFalse(exists(local.appendingPathComponent("g.json")))
    }

    func testDeleteRejectsAnIDThatCantNameAFile() {
        for id in ["", "projects", ".hidden", "a/b", "../g"] {
            XCTAssertThrowsError(try store().delete(goalID: id), id) { error in
                XCTAssertEqual(error as? GoalStore.Failure, .invalidGoal("A goal needs an id that can name its file"))
            }
        }
    }

    func testDeleteProjectRemovesItsGoalsAndTheProject() throws {
        let store = store()
        try store.save(goal("g"))
        try store.save(goal("h", project: "acme__blog"))
        try store.saveProjects([shop, blog], at: savedAt)

        try store.deleteProject(id: "acme__blog", goalIDs: ["h"], remaining: [shop, blog], at: savedAt + 1)

        XCTAssertEqual(contents(local), ["g.json", "projects.json"])
        XCTAssertEqual(contents(mirror), ["g.json", "projects.json"])
        XCTAssertEqual(try projectsIn(local), [shop])
        XCTAssertEqual(try projectsIn(mirror), [shop])
    }

    func testDeleteProjectKeepsTheProjectWhenAGoalCantBeRemoved() throws {
        let store = store()
        try store.save(goal("h", project: "acme__blog"))
        try store.saveProjects([shop, blog], at: savedAt)

        XCTAssertThrowsError(try store.deleteProject(id: "acme__blog", goalIDs: ["a/b"], remaining: [shop, blog],
                                                     at: savedAt + 1))
        XCTAssertEqual(try projectsIn(local), [shop, blog])
    }

    func testDeleteProjectKeepsTheProjectWhenAGoalsCopyCantBeRemoved() throws {
        let store = store()
        try store.save(goal("h", project: "acme__blog"))
        try store.saveProjects([shop, blog], at: savedAt)
        try makeReadOnly(mirror)

        XCTAssertThrowsError(try store.deleteProject(id: "acme__blog", goalIDs: ["h"], remaining: [shop, blog],
                                                     at: savedAt + 1))
        XCTAssertEqual(try projectsIn(local), [shop, blog])
        XCTAssertEqual(try projectsIn(mirror), [shop, blog])
        XCTAssertTrue(exists(local.appendingPathComponent("h.json")))
    }

    // MARK: - Loading

    func testLoadReadsProjectsAndGoals() throws {
        let store = store()
        try store.save(goal("g"))
        try store.save(goal("h", project: "acme__blog"))
        try store.saveProjects([shop, blog], at: savedAt)

        let loaded = store.load()
        XCTAssertEqual(loaded.projects, [shop, blog])
        XCTAssertEqual(loaded.goals, [goal("g"), goal("h", project: "acme__blog")])
    }

    func testLoadSkipsUnreadableFiles() throws {
        let logged = Logged()
        let store = store(log: logged.append)
        try store.save(goal("g"))
        try Data("{ half a fi".utf8).write(to: local.appendingPathComponent("broken.json"))
        try goal("other").encoded().write(to: local.appendingPathComponent("misfiled.json"))
        try Data("{}".utf8).write(to: local.appendingPathComponent(".hidden.json"))
        try Data("not json".utf8).write(to: local.appendingPathComponent("notes.txt"))

        XCTAssertEqual(store.load().goals.map(\.id), ["g"])
        XCTAssertEqual(logged.lines.count, 2)
    }

    func testLoadOfAMissingFolderIsEmpty() {
        let loaded = store().load()
        XCTAssertTrue(loaded.projects.isEmpty)
        XCTAssertTrue(loaded.goals.isEmpty)
        XCTAssertFalse(loaded.projectsUnreadable)
        XCTAssertTrue(loaded.unreadableGoalIDs.isEmpty)
    }

    func testLoadTellsUnreadableFilesFromMissingOnes() throws {
        let store = store()
        try store.save(goal("g"))
        try newerGoalData("newer").write(to: local.appendingPathComponent("newer.json"))
        try Data("{ half".utf8).write(to: local.appendingPathComponent("broken.json"))
        XCTAssertFalse(store.load().projectsUnreadable)

        try Data("{ half".utf8).write(to: local.appendingPathComponent("projects.json"))
        let loaded = store.load()

        XCTAssertEqual(loaded.goals.map(\.id), ["g"])
        XCTAssertEqual(loaded.unreadableGoalIDs, ["newer", "broken"])
        XCTAssertTrue(loaded.projectsUnreadable)
        XCTAssertTrue(loaded.projects.isEmpty)
    }

    func testRepeatedProjectsKeepTheFirst() throws {
        let json = """
        {"schema_version": 1, "id": "projects", "updated_at": 1,
         "projects": [{"id": "acme__shop", "name": "shop", "path": "/code/shop"},
                      {"id": "acme__blog", "name": "blog", "path": "/code/blog"},
                      {"id": "acme__shop", "name": "otra", "path": "/elsewhere"}]}
        """
        let file = try PlanningProjectsFile.decode(from: Data(json.utf8))
        XCTAssertEqual(file.projects.map(\.id), ["acme__shop", "acme__blog"])
        XCTAssertEqual(file.projects.first?.name, "shop")
    }

    // MARK: - Importing

    /// Scenario 15: a goal only the copy has comes back with its project.
    func testImportBringsBackAGoalMissingLocallyWithItsProject() throws {
        let store = store()
        try store.save(goal("g"))
        try store.saveProjects([shop], at: savedAt)
        // What another machine left in the copy.
        let other = PlanningProject(id: "acme__other", name: "other", path: "/code/other")
        try goal("x", project: "acme__blog").encoded().write(to: mirror.appendingPathComponent("x.json"))
        try PlanningProjectsFile(updatedAt: savedAt, projects: [shop, blog, other]).encoded()
            .write(to: mirror.appendingPathComponent("projects.json"))

        let imported = store.importMirror()

        XCTAssertEqual(imported.goals, [goal("x", project: "acme__blog")])
        XCTAssertEqual(imported.projects, [blog])
        let loaded = store.load()
        XCTAssertEqual(loaded.goals.map(\.id), ["g", "x"])
        XCTAssertEqual(loaded.projects, [shop, blog])
        XCTAssertEqual(contents(local), ["g.json", "projects.json", "x.json"])
    }

    /// Scenario 15: a goal this machine has wins over the copy.
    func testImportNeverTouchesAGoalThatExistsLocally() throws {
        let store = store()
        try store.save(goal("x", title: "Local"))
        let localBytes = try Data(contentsOf: local.appendingPathComponent("x.json"))
        try goal("x", title: "De la copia").encoded().write(to: mirror.appendingPathComponent("x.json"))

        let imported = store.importMirror()

        XCTAssertTrue(imported.goals.isEmpty)
        XCTAssertTrue(imported.projects.isEmpty)
        XCTAssertEqual(try Data(contentsOf: local.appendingPathComponent("x.json")), localBytes)
    }

    /// Scenario 15: a local goal this app can't read (damaged, or from a newer app) still wins over the copy.
    func testImportNeverTouchesALocalGoalItCantRead() throws {
        try FileManager.default.createDirectory(at: local, withIntermediateDirectories: true)
        let localBytes = try newerGoalData("x")
        try localBytes.write(to: local.appendingPathComponent("x.json"))
        try FileManager.default.createDirectory(at: mirror, withIntermediateDirectories: true)
        try goal("x").encoded().write(to: mirror.appendingPathComponent("x.json"))

        let imported = store().importMirror()

        XCTAssertTrue(imported.goals.isEmpty)
        XCTAssertEqual(try Data(contentsOf: local.appendingPathComponent("x.json")), localBytes)
    }

    func testImportDoesNotRewriteAnUnreadableProjectsFile() throws {
        try FileManager.default.createDirectory(at: local, withIntermediateDirectories: true)
        let damaged = Data("{ half".utf8)
        try damaged.write(to: local.appendingPathComponent("projects.json"))
        try FileManager.default.createDirectory(at: mirror, withIntermediateDirectories: true)
        try goal("x", project: "acme__blog").encoded().write(to: mirror.appendingPathComponent("x.json"))
        try PlanningProjectsFile(updatedAt: savedAt, projects: [blog]).encoded()
            .write(to: mirror.appendingPathComponent("projects.json"))

        let imported = store().importMirror()

        XCTAssertEqual(imported.goals.map(\.id), ["x"])
        XCTAssertEqual(imported.projects, [blog])
        XCTAssertEqual(try Data(contentsOf: local.appendingPathComponent("projects.json")), damaged)
        XCTAssertTrue(exists(local.appendingPathComponent("x.json")))
    }

    func testImportSavesTheProjectOfAGoalImportedEarlierOnceItCan() throws {
        try FileManager.default.createDirectory(at: local, withIntermediateDirectories: true)
        try Data("{ half".utf8).write(to: local.appendingPathComponent("projects.json"))
        try FileManager.default.createDirectory(at: mirror, withIntermediateDirectories: true)
        try goal("x", project: "acme__blog").encoded().write(to: mirror.appendingPathComponent("x.json"))
        try PlanningProjectsFile(updatedAt: savedAt, projects: [shop, blog]).encoded()
            .write(to: mirror.appendingPathComponent("projects.json"))
        let store = store()

        let first = store.importMirror()
        XCTAssertEqual(first.goals.map(\.id), ["x"])
        XCTAssertTrue(store.load().projectsUnreadable)

        try FileManager.default.removeItem(at: local.appendingPathComponent("projects.json"))
        let second = store.importMirror()

        XCTAssertTrue(second.goals.isEmpty)
        XCTAssertEqual(second.projects, [blog])
        XCTAssertEqual(try projectsIn(local), [blog])
        XCTAssertEqual(store.load().goals.map(\.id), ["x"])
    }

    func testImportOnlyBringsTheProjectsOfTheGoalsItWrote() throws {
        // Projects are returned without being written while projects.json is unreadable, so only the goals decide.
        try FileManager.default.createDirectory(at: local, withIntermediateDirectories: true)
        try Data("{ half".utf8).write(to: local.appendingPathComponent("projects.json"))
        try makeReadOnly(local)
        try FileManager.default.createDirectory(at: mirror, withIntermediateDirectories: true)
        try goal("x", project: "acme__blog").encoded().write(to: mirror.appendingPathComponent("x.json"))
        try PlanningProjectsFile(updatedAt: savedAt, projects: [blog]).encoded()
            .write(to: mirror.appendingPathComponent("projects.json"))

        let imported = store().importMirror()

        XCTAssertTrue(imported.goals.isEmpty)
        XCTAssertTrue(imported.projects.isEmpty)
    }

    func testImportIgnoresUnreadableFiles() throws {
        try FileManager.default.createDirectory(at: mirror, withIntermediateDirectories: true)
        try Data("{ half".utf8).write(to: mirror.appendingPathComponent("broken.json"))
        try Data("{ half".utf8).write(to: mirror.appendingPathComponent("projects.json"))
        try goal("x").encoded().write(to: mirror.appendingPathComponent("x.json"))

        let imported = store().importMirror()

        XCTAssertEqual(imported.goals.map(\.id), ["x"])
        XCTAssertTrue(imported.projects.isEmpty)
        XCTAssertEqual(contents(local), ["x.json"])
    }

    func testImportWithoutACopyFolderIsEmpty() throws {
        try FileManager.default.removeItem(at: data)
        let imported = store().importMirror()
        XCTAssertTrue(imported.goals.isEmpty)
        XCTAssertFalse(exists(local))
    }
}

/// Collects what the store logs; the store may call `log` from any thread.
private final class Logged: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: [String] = []

    var lines: [String] {
        lock.lock()
        defer { lock.unlock() }
        return stored
    }

    @Sendable func append(_ line: String) {
        lock.lock()
        defer { lock.unlock() }
        stored.append(line)
    }
}
