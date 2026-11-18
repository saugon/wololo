import XCTest
@testable import WololoKit

/// Scenario 11: "Ir a la terminal" brings a live session's terminal to the front; otherwise it opens one in the cwd
/// and copies `/wololo resume <id>`, except for a finished run.
final class TerminalPlanTests: XCTestCase {
    func testLiveRunWhoseTerminalIsFoundOnlyFocusesIt() throws {
        let plan = TerminalPlan(try makeRun("r1", status: "running"), now: fixtureNow)
        XCTAssertTrue(plan.triesFocus)
        XCTAssertEqual(plan.steps(focused: true), [.focus])
    }

    func testLiveRunWithoutATerminalOpensOneAndCopiesResume() throws {
        let plan = TerminalPlan(try makeRun("r1", status: "waiting_user"), now: fixtureNow)
        XCTAssertTrue(plan.triesFocus)
        XCTAssertEqual(plan.steps(focused: false), [.open, .copyResume])
        XCTAssertEqual(plan.resumeCommand, "/wololo resume r1")
    }

    func testOrphanedRunIsLookedForAndCopiesResumeWhenNotFound() throws {
        let run = try makeRun("r2", status: "running", ["owner": ["cwd": "/tmp", "heartbeat_at": fixtureNow - 120]])
        let plan = TerminalPlan(run, now: fixtureNow)
        XCTAssertTrue(plan.triesFocus)
        XCTAssertEqual(plan.steps(focused: true), [.focus])
        XCTAssertEqual(plan.steps(focused: false), [.open, .copyResume])
        XCTAssertEqual(plan.resumeCommand, "/wololo resume r2")
    }

    func testFinishedRunOpensATerminalAndCopiesNothing() throws {
        for status in ["done", "failed", "cancelled"] {
            let plan = TerminalPlan(try makeRun("r3", status: status), now: fixtureNow)
            XCTAssertFalse(plan.triesFocus, status)
            XCTAssertNil(plan.resumeCommand, status)
            XCTAssertEqual(plan.steps(focused: false), [.open], status)
            XCTAssertEqual(plan.steps(focused: true), [.open], status)
        }
    }

    func testPausedRunIsLookedForAndResumableWhenNotFound() {
        let plan = TerminalPlan(id: "r4", status: .paused)
        XCTAssertTrue(plan.triesFocus)
        XCTAssertEqual(plan.steps(focused: false), [.open, .copyResume])
    }

    func testDirectoryIsTheCwdWhenItExists() {
        let directory = TerminalDirectory(cwd: "/repo", projectPath: "/project", home: "/home") { _ in true }
        XCTAssertEqual(directory, .cwd("/repo"))
    }

    func testMissingCwdFallsBackToTheProjectPath() {
        let directory = TerminalDirectory(cwd: "/gone", projectPath: "/project", home: "/home") { $0 == "/project" }
        XCTAssertEqual(directory, .project("/project"))
        XCTAssertEqual(directory.path, "/project")
    }

    func testEmptyCwdFallsBackToTheProjectPath() {
        let directory = TerminalDirectory(cwd: "", projectPath: "/project", home: "/home") { _ in true }
        XCTAssertEqual(directory, .project("/project"))
    }

    func testMissingCwdAndProjectFallBackToHome() {
        let directory = TerminalDirectory(cwd: "/gone", projectPath: "", home: "/home") { _ in false }
        XCTAssertEqual(directory, .home("/home"))
    }

    private func iTerm(_ panes: TerminalPane...) -> TerminalListing {
        TerminalListing(app: .iTerm2, panes: panes)
    }

    private func ghostty(_ panes: TerminalPane...) -> TerminalListing {
        TerminalListing(app: .ghostty, panes: panes)
    }

    private func match(_ cwd: String, project: String = "/Users/x/repo", _ listings: TerminalListing...) -> PaneMatch? {
        matchPane(cwd: cwd, projectPath: project, home: "/Users/x", in: listings)
    }

    func testAShellAtHomeOrAboveDoesNotMatchARunInTheRepo() {
        let listing = iTerm(
            TerminalPane(id: "home", job: "zsh", path: "/Users/x"),
            TerminalPane(id: "root", job: "zsh", path: "/"),
            TerminalPane(id: "parent", job: "node", path: "/Users")
        )
        XCTAssertNil(match("/Users/x/repo", listing))
        XCTAssertNil(match("/Users/x/repo", project: "/Users/x", listing))
    }

    func testExactDirectoryBeatsAnAncestor() {
        let listing = iTerm(
            TerminalPane(id: "ancestor", job: "node", path: "/Users/x/repo"),
            TerminalPane(id: "exact", job: "zsh", path: "/Users/x/repo/app")
        )
        XCTAssertEqual(match("/Users/x/repo/app", listing), PaneMatch(
            app: .iTerm2, pane: TerminalPane(id: "exact", job: "zsh", path: "/Users/x/repo/app"), isExact: true
        ))
    }

    func testGhosttyExactBeatsAnITermAncestor() {
        let found = match(
            "/Users/x/repo/app",
            iTerm(TerminalPane(id: "/dev/ttys001", job: "node", path: "/Users/x/repo")),
            ghostty(TerminalPane(id: "G1", job: "", path: "/Users/x/repo/app"))
        )
        XCTAssertEqual(found?.app, .ghostty)
        XCTAssertEqual(found?.pane.id, "G1")
        XCTAssertEqual(found?.isExact, true)
    }

    func testExactMatchesPreferTheAgentsNodeJobThenListingOrder() {
        let shell = TerminalPane(id: "shell", job: "zsh", path: "/Users/x/repo")
        let agent = TerminalPane(id: "agent", job: "node", path: "/Users/x/repo")
        XCTAssertEqual(match("/Users/x/repo", iTerm(shell, agent))?.pane.id, "agent")
        XCTAssertEqual(match("/Users/x/repo", iTerm(shell), ghostty(TerminalPane(id: "g", job: "", path: "/Users/x/repo")))?.app, .iTerm2)
    }

    func testAncestorInsideTheProjectMatchesTheDeepestOne() {
        let found = match(
            "/Users/x/repo/app/src",
            iTerm(
                TerminalPane(id: "repo", job: "zsh", path: "/Users/x/repo"),
                TerminalPane(id: "app", job: "zsh", path: "/Users/x/repo/app"),
                TerminalPane(id: "outside", job: "node", path: "/Users/x")
            )
        )
        XCTAssertEqual(found?.pane.id, "app")
        XCTAssertEqual(found?.isExact, false)
    }

    func testAncestorsDoNotCountWithoutAProjectPath() {
        let listing = iTerm(TerminalPane(id: "repo", job: "zsh", path: "/Users/x/repo"))
        XCTAssertNil(match("/Users/x/repo/app", project: "", listing))
    }

    func testFoldersBelowTheCwdNeverMatch() {
        let listing = iTerm(
            TerminalPane(id: "worktree", job: "node", path: "/Users/x/repo/.claude/worktrees/other"),
            TerminalPane(id: "sub", job: "node", path: "/Users/x/repo/app")
        )
        XCTAssertNil(match("/Users/x/repo", listing))
    }

    func testSiblingPrefixesAndEmptyPathsNeverMatch() {
        let listing = iTerm(
            TerminalPane(id: "sibling", job: "node", path: "/Users/x/repo-other"),
            TerminalPane(id: "empty", job: "node", path: "")
        )
        XCTAssertNil(match("/Users/x/repo", listing))
        XCTAssertNil(match("", iTerm(TerminalPane(id: "root", job: "zsh", path: "/"))))
    }

    func testPathsAreComparedNormalized() throws {
        let found = match("/Users/x/repo/", iTerm(TerminalPane(id: "t", job: "zsh", path: "/Users/x/./app/../repo")))
        XCTAssertEqual(found?.isExact, true)

        let base = FileManager.default.temporaryDirectory.appendingPathComponent("wololo-desk-\(UUID().uuidString)")
        let real = base.appendingPathComponent("real")
        let link = base.appendingPathComponent("link")
        try FileManager.default.createDirectory(at: real, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: base) }
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: real)
        let viaLink = matchPane(cwd: link.path + "/", projectPath: "", home: "/nowhere", in: [
            iTerm(TerminalPane(id: "t", job: "zsh", path: real.path)),
        ])
        XCTAssertEqual(viaLink?.isExact, true)
    }

    func testNormalizedPath() {
        XCTAssertEqual(normalizedPath(""), "")
        XCTAssertEqual(normalizedPath("/"), "/")
        XCTAssertEqual(normalizedPath("/nonexistent/a/b/"), "/nonexistent/a/b")
        XCTAssertEqual(normalizedPath("/nonexistent/a/../b/./c"), "/nonexistent/b/c")
    }

    func testTheSessionsTtyWinsOverTheDirectory() {
        // Two sessions of one repository: the directory alone would pick the first tab every time.
        let first = TerminalPane(id: "G1", job: "", path: "/Users/x/repo", tty: "/dev/ttys000")
        let second = TerminalPane(id: "G2", job: "", path: "/Users/x/repo", tty: "/dev/ttys001")
        let elsewhere = TerminalPane(id: "G3", job: "", path: "/Users/x/other", tty: "/dev/ttys012")
        let listing = ghostty(first, second, elsewhere)
        let find = { (tty: String) in matchPane(cwd: "/Users/x/repo", projectPath: "/Users/x/repo", home: "/Users/x", tty: tty, in: [listing]) }
        XCTAssertEqual(find("ttys001")?.pane.id, "G2")
        // The terminal's directory can lag behind the session's: the tty still finds it.
        XCTAssertEqual(find("/dev/ttys012"), PaneMatch(app: .ghostty, pane: elsewhere, isExact: true))
        // No tty, or one no pane is on, falls back to the directory.
        XCTAssertEqual(find("")?.pane.id, "G1")
        XCTAssertEqual(find("ttys099")?.pane.id, "G1")
    }

    func testTtyPath() {
        XCTAssertEqual(ttyPath("ttys001"), "/dev/ttys001")
        XCTAssertEqual(ttyPath(" /dev/ttys001\n"), "/dev/ttys001")
        XCTAssertEqual(ttyPath("??"), "")
        XCTAssertEqual(ttyPath(""), "")
    }

    func testSessionPIDReadsClaudeCodesSessionFiles() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("sessions-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        try #"{"pid": 23075, "sessionId": "d2dc", "cwd": "/repo"}"#.write(to: dir.appendingPathComponent("23075.json"), atomically: true, encoding: .utf8)
        try #"{"pid": 24468, "sessionId": "74d0"}"#.write(to: dir.appendingPathComponent("24468.json"), atomically: true, encoding: .utf8)
        try "not json".write(to: dir.appendingPathComponent("1.json"), atomically: true, encoding: .utf8)
        try #"{"pid": 5, "sessionId": "d2dc"}"#.write(to: dir.appendingPathComponent("5.key"), atomically: true, encoding: .utf8)

        XCTAssertEqual(sessionPID("74d0", in: dir), 24468)
        XCTAssertEqual(sessionPID("d2dc", in: dir), 23075)
        XCTAssertNil(sessionPID("gone", in: dir))
        XCTAssertNil(sessionPID("", in: dir))
        XCTAssertNil(sessionPID("74d0", in: dir.appendingPathComponent("missing")))
    }

    func testParsePanesReadsTabSeparatedLines() {
        let raw = "/dev/ttys001\tnode \t/repo\n\tzsh\t/skipped\n/dev/ttys002\tzsh\t\r\nbroken line\n"
        XCTAssertEqual(parsePanes(raw), [
            TerminalPane(id: "/dev/ttys001", job: "node", path: "/repo"),
            TerminalPane(id: "/dev/ttys002", job: "zsh", path: ""),
        ])
        XCTAssertEqual(parsePanes("G1\t\t/repo\t/dev/ttys004\n"), [TerminalPane(id: "G1", job: "", path: "/repo", tty: "/dev/ttys004")])
    }

    func testAppleScriptStringEscapesWhatEndsOrBreaksALiteral() {
        XCTAssertEqual(appleScriptString("plain"), #""plain""#)
        XCTAssertEqual(appleScriptString(#"say "hi""#), #""say \"hi\"""#)
        XCTAssertEqual(appleScriptString(#"C:\dir\file"#), #""C:\\dir\\file""#)
        XCTAssertEqual(appleScriptString(#"ends with\"#), #""ends with\\""#)
        XCTAssertEqual(appleScriptString("a\nb\rc\td"), #""a\nb\rc\td""#)
        XCTAssertEqual(appleScriptString("/Users/x/🚀 repo/𝄞"), "\"/Users/x/🚀 repo/𝄞\"")
        XCTAssertEqual(appleScriptString(""), #""""#)
    }
}
