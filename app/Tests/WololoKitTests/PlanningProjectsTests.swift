import XCTest
@testable import WololoKit

final class PlanningProjectsTests: XCTestCase {
    private func run(_ id: String, key: String, path: String = "/code/shop", createdAt: TimeInterval = 0) throws -> Run {
        try makeRun(id, ["project": ["key": key, "path": path], "created_at": createdAt])
    }

    // MARK: - Merging stored projects with the runs

    func testProjectsWithRunsAppearWithoutBeingCreated() throws {
        let projects = mergedProjects(stored: [], runs: [try run("a", key: "acme__shop"), try run("b", key: "acme__shop")])
        XCTAssertEqual(projects, [PlanningProject(id: "acme__shop", name: "shop", path: "/code/shop",
                                                  repo: "acme/shop", key: "acme__shop")])
    }

    func testDerivedPathComesFromTheNewestRunWithAPath() throws {
        let runs = [
            try run("old", key: "acme__shop", path: "/old/shop", createdAt: 100),
            try run("new", key: "acme__shop", path: "/new/shop", createdAt: 300),
            try run("newest", key: "acme__shop", path: "", createdAt: 500),
            try run("mid", key: "acme__shop", path: "/mid/shop", createdAt: 200),
        ]
        XCTAssertEqual(mergedProjects(stored: [], runs: runs).map(\.path), ["/new/shop"])
    }

    func testRunsWithoutAKeyNameNoProject() throws {
        XCTAssertEqual(mergedProjects(stored: [], runs: [try run("a", key: "")]), [])
    }

    func testStoredProjectAbsorbsTheOneItsRunsName() throws {
        let stored = PlanningProject(id: "p1", name: "Tienda", path: "/mine/shop", repo: "acme/shop")
        let projects = mergedProjects(stored: [stored], runs: [try run("a", key: "acme__shop")])
        XCTAssertEqual(projects, [stored])
    }

    func testStoredProjectWithoutPathTakesTheRunsPath() throws {
        let stored = PlanningProject(id: "p1", name: "Tienda", path: "", key: "acme__shop")
        let projects = mergedProjects(stored: [stored], runs: [try run("a", key: "acme__shop", path: "/code/shop")])
        XCTAssertEqual(projects, [PlanningProject(id: "p1", name: "Tienda", path: "/code/shop", key: "acme__shop")])
    }

    func testStoredProjectsWithoutRunsAreKeptAndAllAreSortedByName() throws {
        let stored = [
            PlanningProject(id: "z", name: "zeta", path: "/z"),
            PlanningProject(id: "b2", name: "Beta", path: "/b2"),
            PlanningProject(id: "b1", name: "beta", path: "/b1"),
        ]
        let projects = mergedProjects(stored: stored, runs: [try run("a", key: "acme__shop")])
        XCTAssertEqual(projects.map(\.id), ["b1", "b2", "acme__shop", "z"])
    }

    func testLocalKeysHaveNoRepo() throws {
        let projects = mergedProjects(stored: [], runs: [try run("a", key: "local__x-abc", path: "/code/x")])
        XCTAssertEqual(projects, [PlanningProject(id: "local__x-abc", name: "x", path: "/code/x",
                                                  repo: nil, key: "local__x-abc")])
    }

    func testLocalKeyWithoutAPathIsNamedAfterTheKey() throws {
        let projects = mergedProjects(stored: [], runs: [try run("a", key: "local__x-abc", path: "")])
        XCTAssertEqual(projects.map(\.name), ["x-abc"])
    }

    func testStoredRepoAbsorbsRunsWhoseKeyDiffersInCase() throws {
        let stored = PlanningProject(id: "p1", name: "Tienda", path: "/mine/shop", repo: "Acme/Shop")
        XCTAssertEqual(mergedProjects(stored: [stored], runs: [try run("a", key: "acme__shop")]), [stored])
    }

    func testKeysDifferingInCaseMakeOneDerivedProject() throws {
        let runs = [
            try run("a", key: "Acme__shop", path: "/old/shop", createdAt: 100),
            try run("b", key: "acme__shop", path: "/new/shop", createdAt: 200),
        ]
        XCTAssertEqual(mergedProjects(stored: [], runs: runs),
                       [PlanningProject(id: "Acme__shop", name: "shop", path: "/new/shop",
                                        repo: "Acme/shop", key: "Acme__shop")])
    }

    func testDerivedIDIsTheOldestRunsSpellingWhateverTheOrder() throws {
        let runs = [
            try run("b", key: "acme__shop", createdAt: 200),
            try run("z", key: "ACME__shop", createdAt: 100),
            try run("a", key: "Acme__shop", createdAt: 100),
        ]
        for order in [runs, runs.reversed(), [runs[1], runs[0], runs[2]]] {
            XCTAssertEqual(mergedProjects(stored: [], runs: order).map(\.id), ["Acme__shop"])
        }
    }

    func testSavingASuffixedProjectAndMergingAgainAddsNoOther() throws {
        let edited = PlanningProject(id: "acme__shop", name: "Otra", path: "/code/other", repo: "acme/other",
                                     key: "acme__other")
        let runs = [try run("a", key: "acme__shop"), try run("b", key: "acme__other")]
        let suffixed = try XCTUnwrap(mergedProjects(stored: [edited], runs: runs).first { $0.id == "acme__shop~2" })

        let stored = upserting(suffixed, into: [edited])
        let projects = mergedProjects(stored: stored, runs: runs)
        XCTAssertEqual(projects.map(\.id).sorted(), ["acme__shop", "acme__shop~2"])
        XCTAssertEqual(mergedProjects(stored: projects, runs: runs), projects, "merging again changes nothing")
    }

    // MARK: - Editing and saving

    func testEditingTheRepoAdoptsItsKey() throws {
        let saved = PlanningProject(id: "acme__shop", name: "shop", path: "/code/shop", repo: "acme/shop",
                                    key: "acme__shop")
        let edited = projectEditing(saved, name: "Otra", path: "/code/other", repo: "acme/other")
        XCTAssertEqual(edited, PlanningProject(id: "acme__shop", name: "Otra", path: "/code/other",
                                               repo: "acme/other", key: "acme__other"))

        let runs = [try run("a", key: "acme__other", path: "/x/other"), try run("b", key: "acme__shop")]
        let projects = mergedProjects(stored: [edited], runs: runs)
        XCTAssertEqual(projects, [
            edited,
            PlanningProject(id: "acme__shop~2", name: "shop", path: "/code/shop", repo: "acme/shop", key: "acme__shop"),
        ])
    }

    func testEditingWithoutARepoKeepsTheKey() {
        let saved = PlanningProject(id: "p1", name: "shop", path: "/code/shop", repo: "acme/shop")
        for repo in [nil, "", "  "] as [String?] {
            let edited = projectEditing(saved, name: "shop", path: "/code/shop", repo: repo)
            XCTAssertEqual(edited.key, "acme__shop")
            XCTAssertNil(edited.repo)
        }
        let derived = PlanningProject(id: "acme__shop", name: "shop", path: "", key: "acme__shop")
        XCTAssertEqual(projectEditing(derived, name: "n", path: "/p", repo: nil),
                       PlanningProject(id: "acme__shop", name: "n", path: "/p", key: "acme__shop"))
    }

    func testFindsTheProjectThatAlreadyCollectsAKey() {
        let projects = [
            PlanningProject(id: "p1", name: "a", path: "", repo: "Acme/Shop"),
            PlanningProject(id: "p2", name: "b", path: "", key: "local__x-abc"),
            PlanningProject(id: "p3", name: "c", path: ""),
        ]
        XCTAssertEqual(project(matchingKey: "acme__shop", in: projects)?.id, "p1")
        XCTAssertEqual(project(matchingKey: "LOCAL__x-abc", in: projects)?.id, "p2")
        XCTAssertNil(project(matchingKey: "acme__other", in: projects))
    }

    func testStoredProjectsAreKnownByID() throws {
        let stored = [PlanningProject(id: "p1", name: "a", path: "", key: "acme__shop")]
        let projects = mergedProjects(stored: stored, runs: [try run("a", key: "acme__shop"), try run("b", key: "x__y")])
        XCTAssertEqual(projects.map { isStored($0, in: stored) }, [true, false])
    }

    func testUpsertingReplacesByIDOrAppends() {
        let a = PlanningProject(id: "a", name: "a", path: "")
        let b = PlanningProject(id: "b", name: "b", path: "")
        let renamed = PlanningProject(id: "a", name: "A", path: "/a")
        XCTAssertEqual(upserting(renamed, into: [a, b]), [renamed, b])
        XCTAssertEqual(upserting(b, into: [a]), [a, b])
    }

    // MARK: - Reading the origin remote

    private func config(origin url: String) -> String {
        """
        [core]
        \trepositoryformatversion = 0
        [remote "origin"]
        \turl = \(url)
        \tfetch = +refs/heads/*:refs/remotes/origin/*
        """
    }

    func testReadsGitHubOriginInEveryURLForm() {
        for url in ["https://github.com/acme/shop", "https://github.com/acme/shop.git",
                    "https://github.com/acme/shop/", "git@github.com:acme/shop.git", "git@github.com:acme/shop",
                    "ssh://git@github.com/acme/shop.git", "ssh://git@github.com/acme/shop",
                    "https://www.github.com/acme/shop.git", "git@ssh.github.com:acme/shop.git",
                    "ssh://git@ssh.github.com:443/acme/shop.git", "github-work:acme/shop.git",
                    "git@github-work:acme/shop", "git@github.com-work:acme/shop.git",
                    "ssh://git@github-work/acme/shop.git", "ssh://git@github.com-work/acme/shop",
                    "git+ssh://git@github.com/acme/shop.git"] {
            XCTAssertEqual(originRepo(gitConfig: config(origin: url)), "acme/shop", url)
        }
    }

    func testIgnoresOriginsOffGitHub() {
        for url in ["https://gitlab.com/acme/shop.git", "git@gitlab.com:acme/shop.git", "/srv/git/shop.git",
                    "https://github.com/acme", "https://github.com/acme/shop/extra",
                    "https://github-work/acme/shop.git", "https://github.com-work/acme/shop.git",
                    "ssh://git@gitlab.com/acme/shop.git", "git@github.com-:acme/shop.git"] {
            XCTAssertNil(originRepo(gitConfig: config(origin: url)), url)
        }
    }

    func testNoOriginMeansNoRepo() {
        XCTAssertNil(originRepo(gitConfig: "[core]\n\tbare = false\n"))
        XCTAssertNil(originRepo(gitConfig: "[remote \"upstream\"]\n\turl = git@github.com:acme/shop.git\n"))
        XCTAssertNil(originRepo(gitConfig: ""))
    }

    func testPicksOriginAmongSeveralRemotes() {
        let text = """
        [remote "upstream"]
        \turl = https://github.com/upstream/shop.git
        [remote "origin"]
        \turl = git@github.com:acme/shop.git
        [remote "fork"]
        \turl = https://github.com/fork/shop.git
        [branch "main"]
        \tremote = origin
        """
        XCTAssertEqual(originRepo(gitConfig: text), "acme/shop")
    }

    func testGitConfigOfAPlainRepo() {
        XCTAssertEqual(gitConfigURL(forFolder: "/code/shop", read: { _ in nil }).path, "/code/shop/.git/config")
    }

    func testGitConfigOfAWorktreeFollowsGitdirAndCommondir() {
        let files = [
            "/code/wt/.git": "gitdir: /code/shop/.git/worktrees/wt\n",
            "/code/shop/.git/worktrees/wt/commondir": "../..\n",
            "/code/shop/.git/config": config(origin: "git@github.com:acme/shop.git"),
        ]
        let read: (URL) -> String? = { files[$0.path] }
        XCTAssertEqual(gitConfigURL(forFolder: "/code/wt", read: read).path, "/code/shop/.git/config")
        XCTAssertEqual(originRepo(forFolder: "/code/wt", read: read), "acme/shop")
    }

    func testGitConfigOfARelativeGitdirWithoutCommondir() {
        let files = ["/code/lib/sub/.git": "gitdir: ../.git/modules/sub"]
        XCTAssertEqual(gitConfigURL(forFolder: "/code/lib/sub", read: { files[$0.path] }).path,
                       "/code/lib/.git/modules/sub/config")
    }

    func testGitConfigIsFoundInAParentFolder() {
        let files = ["/code/shop/.git/config": config(origin: "git@github.com:acme/shop.git")]
        let read: (URL) -> String? = { files[$0.path] }
        XCTAssertEqual(gitConfigURL(forFolder: "/code/shop/app/Sources", read: read).path, "/code/shop/.git/config")
        XCTAssertEqual(originRepo(forFolder: "/code/shop/app/Sources", read: read), "acme/shop")
    }

    func testWorktreeIsFoundFromASubfolder() {
        let files = [
            "/code/wt/.git": "gitdir: /code/shop/.git/worktrees/wt\n",
            "/code/shop/.git/worktrees/wt/commondir": "../..\n",
            "/code/shop/.git/config": config(origin: "git@github.com:acme/shop.git"),
        ]
        XCTAssertEqual(originRepo(forFolder: "/code/wt/app", read: { files[$0.path] }), "acme/shop")
    }

    func testNoGitUpToTheRootMeansNoRepo() {
        XCTAssertNil(originRepo(forFolder: "/code/plain/sub", read: { _ in nil }))
        XCTAssertEqual(gitConfigURL(forFolder: "/", read: { _ in nil }).path, "/.git/config")
    }

    func testDefaultProjectNameIsTheFolderName() {
        XCTAssertEqual(defaultProjectName(forFolder: "/Users/me/code/shop"), "shop")
        XCTAssertEqual(defaultProjectName(forFolder: "/Users/me/code/shop/"), "shop")
    }

    // MARK: - Typing a repo

    func testRepoInputAcceptsTheNameAndGitHubURLs() {
        for input in ["acme/shop", " acme/shop ", "acme/shop.git", "acme/shop/", "github.com/acme/shop",
                      "https://github.com/acme/shop", "https://github.com/acme/shop.git",
                      "http://www.github.com/acme/shop/", "git@github.com:acme/shop.git",
                      "ssh://git@github.com/acme/shop", "git@github.com-work:acme/shop.git"] {
            XCTAssertEqual(normalizeRepoInput(input), "acme/shop", input)
        }
        XCTAssertEqual(normalizeRepoInput("my-org/my_repo.js"), "my-org/my_repo.js")
    }

    func testRepoInputRejectsWhatIsNotAGitHubRepo() {
        for input in ["", "   ", "acme", "acme/", "/shop", "acme/shop/extra", "acme shop/x", "acme/sh op",
                      "-acme/shop", "acme/..", "https://gitlab.com/acme/shop", "https://github.com/acme",
                      "acme/shop#12", "a/b:c", "acme:shop/x", "foo:acme/shop"] {
            XCTAssertNil(normalizeRepoInput(input), input)
        }
    }

    // MARK: - Removing and default repo

    func testRemovingAProjectReturnsItsGoals() {
        let projects = [PlanningProject(id: "p1", name: "a", path: ""), PlanningProject(id: "p2", name: "b", path: "")]
        let goals = [
            Goal(id: "g1", projectID: "p1", title: "", updatedAt: 0),
            Goal(id: "g2", projectID: "p2", title: "", updatedAt: 0),
            Goal(id: "g3", projectID: "p1", title: "", updatedAt: 0),
        ]
        let result = projectRemoving(id: "p1", from: projects, goals: goals)
        XCTAssertEqual(result.projects.map(\.id), ["p2"])
        XCTAssertEqual(result.goalIDs, ["g1", "g3"])
    }

    func testDefaultRepoComesFromTheRepoThenTheKey() {
        XCTAssertEqual(defaultRepo(for: PlanningProject(id: "p", name: "", path: "", repo: "acme/shop", key: "x__y")),
                       "acme/shop")
        XCTAssertEqual(defaultRepo(for: PlanningProject(id: "p", name: "", path: "", key: "acme__shop")), "acme/shop")
        XCTAssertNil(defaultRepo(for: PlanningProject(id: "p", name: "", path: "", key: "local__x-abc")))
        XCTAssertNil(defaultRepo(for: PlanningProject(id: "p", name: "", path: "")))
    }
}
