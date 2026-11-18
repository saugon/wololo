import XCTest
@testable import WololoKit

/// Spec 22–24: the command, the folder and the terminal scripts "Arrancar run" launches from a node.
final class RunLaunchTests: XCTestCase {
    private let shop = PlanningProject(id: "p1", name: "shop", path: "/Users/x/code/shop", repo: "acme/shop")
    private let lib = PlanningProject(id: "p2", name: "lib", path: "/Users/x/code/lib", repo: "otra/lib")

    // Scenario 8
    func testIssueOfTheProjectsRepoRunsInItsFolderInANewITermWindow() {
        let node = GoalNode(id: "n1", title: "Checkout", issue: "#131")
        let command = RunLaunch.command(for: node, projectRepo: "acme/shop")
        XCTAssertEqual(command, "/wololo #131")
        XCTAssertEqual(RunLaunch.folder(for: node, project: shop, projects: [shop]), .folder("/Users/x/code/shop"))

        let script = RunLaunch.iTermScript(folder: "/Users/x/code/shop", command: command)
        XCTAssertTrue(script.contains("create window with default profile"))
        XCTAssertTrue(script.contains("write text"))
        XCTAssertTrue(script.contains("cd '/Users/x/code/shop'"))
        XCTAssertTrue(script.contains("claude '/wololo #131'"))
        XCTAssertTrue(script.contains("activate"))
    }

    func testIssueOfTheProjectsRepoByURLStillReadsAsANumber() {
        let node = GoalNode(id: "n1", issue: "https://github.com/ACME/shop/issues/131")
        XCTAssertEqual(RunLaunch.command(for: node, projectRepo: "acme/shop"), "/wololo #131")
    }

    func testBareNumberWithoutARepoReadsAsANumber() {
        let node = GoalNode(id: "n1", issue: "7")
        XCTAssertEqual(RunLaunch.command(for: node, projectRepo: nil), "/wololo #7")
        let local = PlanningProject(id: "p3", name: "local", path: "/tmp/local")
        XCTAssertEqual(RunLaunch.folder(for: node, project: local, projects: [local]), .folder("/tmp/local"))
    }

    func testTerminalScriptRunsTheLineInANewWindow() {
        let script = RunLaunch.terminalScript(folder: "/Users/x/code/shop", command: "/wololo #131")
        XCTAssertTrue(script.contains("tell application \"Terminal\""))
        XCTAssertTrue(script.contains("do script \"cd '/Users/x/code/shop' && claude '/wololo #131'\"\n"))
        XCTAssertTrue(script.contains("activate"))
    }

    func testTerminalNotRunningRunsTheLineInTheWindowItOpensOnStart() {
        let script = RunLaunch.terminalScript(folder: "/Users/x/code/shop", command: "/wololo #131")
        XCTAssertTrue(script.contains("set wasRunning to application \"Terminal\" is running"))
        XCTAssertTrue(script.contains("if not wasRunning and (count of windows) > 0 then"))
        XCTAssertTrue(script.contains("do script \"cd '/Users/x/code/shop' && claude '/wololo #131'\" in window 1"))
    }

    func testITermNotRunningTypesTheLineInTheWindowItOpensOnStart() {
        let script = RunLaunch.iTermScript(folder: "/Users/x/code/shop", command: "/wololo #131")
        XCTAssertTrue(script.contains("set wasRunning to application \"iTerm2\" is running"))
        XCTAssertTrue(script.contains("if not wasRunning and (count of windows) > 0 then"))
        XCTAssertTrue(script.contains("set w to current window"))
        XCTAssertTrue(script.contains("set w to (create window with default profile)"))
    }

    func testGhosttyOpensAWindowInTheFolderTypingTheClaudeLine() {
        let script = RunLaunch.ghosttyScript(folder: "/Users/x/code/shop", command: "/wololo #131")
        XCTAssertEqual(script, #"""
        tell application "Ghostty"
            set c to new surface configuration
            set initial working directory of c to "/Users/x/code/shop"
            set initial input of c to "claude '/wololo #131'\n"
            new window with configuration c
            activate
        end tell
        """#)
    }

    // Scenario 10
    func testNodeWithoutIssueSendsItsTitleAndDescription() {
        let node = GoalNode(id: "n1", title: "Monitoreo", description: "Alertas de errores")
        XCTAssertEqual(RunLaunch.command(for: node, projectRepo: "acme/shop"), "/wololo Monitoreo. Alertas de errores")
    }

    func testNodeWithoutDescriptionSendsOnlyItsTitle() {
        let node = GoalNode(id: "n1", title: "  Monitoreo  ", description: " \n ")
        XCTAssertEqual(RunLaunch.command(for: node, projectRepo: "acme/shop"), "/wololo Monitoreo")
    }

    func testNewlinesAndWhitespaceRunsCollapseToOneLine() {
        let node = GoalNode(id: "n1", title: "Monitoreo\nde  errores", description: "Alertas\n\n\tpor mail\n")
        XCTAssertEqual(RunLaunch.command(for: node, projectRepo: "acme/shop"), "/wololo Monitoreo de errores. Alertas por mail")
    }

    func testTitleEndingInPunctuationGetsNoSecondPeriod() {
        for title in ["Monitoreo.", "¿Monitoreo?", "¡Monitoreo!"] {
            let node = GoalNode(id: "n1", title: title, description: "Alertas")
            XCTAssertEqual(RunLaunch.command(for: node, projectRepo: "acme/shop"), "/wololo \(title) Alertas")
        }
    }

    func testNodeWithOnlyADescriptionSendsIt() {
        let node = GoalNode(id: "n1", title: " ", description: "Alertas de errores")
        XCTAssertEqual(RunLaunch.command(for: node, projectRepo: "acme/shop"), "/wololo Alertas de errores")
        XCTAssertEqual(RunLaunch.folder(for: node, project: shop, projects: [shop]), .folder("/Users/x/code/shop"))
    }

    func testNodeWithoutTitleDescriptionOrIssueIsDisabled() {
        for issue in [nil, "pronto"] {
            let node = GoalNode(id: "n1", title: "  ", description: "\n", issue: issue)
            XCTAssertEqual(
                RunLaunch.folder(for: node, project: shop, projects: [shop]),
                .disabled(reason: "Escribí un título o vinculá un issue")
            )
        }
    }

    func testTextThatNamesNoIssueCountsAsNoIssue() {
        let node = GoalNode(id: "n1", title: "Monitoreo", issue: "pronto")
        XCTAssertEqual(RunLaunch.command(for: node, projectRepo: "acme/shop"), "/wololo Monitoreo")
    }

    func testIssueThatNamesNoIssueDisablesTheStart() {
        for issue in ["pronto", "acme/shop#", "#abc"] {
            let node = GoalNode(id: "n1", title: "Monitoreo", issue: issue)
            XCTAssertEqual(RunLaunch.folder(for: node, project: shop, projects: [shop]),
                           .disabled(reason: "No reconozco ese issue"), issue)
        }
        let blank = GoalNode(id: "n1", title: "Monitoreo", issue: "  ")
        XCTAssertEqual(RunLaunch.folder(for: blank, project: shop, projects: [shop]), .folder("/Users/x/code/shop"))
    }

    func testSingleQuotesAreShellEscaped() {
        let node = GoalNode(id: "n1", title: "Arreglar el 'checkout'")
        let command = RunLaunch.command(for: node, projectRepo: "acme/shop")
        XCTAssertEqual(RunLaunch.shellLine(command: command), #"claude '/wololo Arreglar el '\''checkout'\'''"#)
        XCTAssertEqual(RunLaunch.shellQuote("it's"), #"'it'\''s'"#)
        XCTAssertEqual(
            RunLaunch.cdLine(folder: "/Users/x/o'brien", command: "/wololo #1"),
            #"cd '/Users/x/o'\''brien' && claude '/wololo #1'"#
        )
    }

    // Scenario 11
    func testIssueOfAnotherRepoWithoutItsProjectIsDisabled() {
        let node = GoalNode(id: "n1", issue: "otra/lib#12")
        XCTAssertEqual(
            RunLaunch.folder(for: node, project: shop, projects: [shop]),
            .disabled(reason: "Agregá un proyecto para otra/lib")
        )
    }

    func testIssueOfAnotherRepoRunsByURLInThatProjectsFolder() {
        let node = GoalNode(id: "n1", issue: "otra/lib#12")
        XCTAssertEqual(
            RunLaunch.command(for: node, projectRepo: "acme/shop"),
            "/wololo https://github.com/otra/lib/issues/12"
        )
        XCTAssertEqual(RunLaunch.folder(for: node, project: shop, projects: [shop, lib]), .folder("/Users/x/code/lib"))
    }

    func testOtherRepoMatchesAProjectByItsKeyIgnoringCase() {
        let byKey = PlanningProject(id: "p4", name: "lib", path: "/Users/x/lib", key: "Otra__Lib")
        let node = GoalNode(id: "n1", issue: "otra/lib#12")
        XCTAssertEqual(RunLaunch.folder(for: node, project: shop, projects: [shop, byKey]), .folder("/Users/x/lib"))
    }

    func testEmptyProjectFolderIsDisabled() {
        let noFolder = PlanningProject(id: "p1", name: "shop", path: "", repo: "acme/shop")
        let node = GoalNode(id: "n1", issue: "#131")
        XCTAssertEqual(
            RunLaunch.folder(for: node, project: noFolder, projects: [noFolder]),
            .disabled(reason: "Elegí una carpeta para shop")
        )
    }

    func testAppleScriptEscapesQuotesAndBackslashesInTheFolder() {
        let script = RunLaunch.iTermScript(folder: #"/Users/x/a "b" \c"#, command: "/wololo #1")
        XCTAssertTrue(script.contains(#"write text "cd '/Users/x/a \"b\" \\c' && claude '/wololo #1'""#))
        let terminal = RunLaunch.terminalScript(folder: #"/Users/x/a "b" \c"#, command: "/wololo #1")
        XCTAssertTrue(terminal.contains(#"do script "cd '/Users/x/a \"b\" \\c' && claude '/wololo #1'""#))
    }

    func testShellAndAppleScriptEscapingBothHoldForHostileText() {
        let node = GoalNode(id: "n1", title: #"$(rm -rf ~) `x` \ "q" ; it's "#)
        let command = RunLaunch.command(for: node, projectRepo: "acme/shop")
        XCTAssertEqual(command, #"/wololo $(rm -rf ~) `x` \ "q" ; it's"#)
        XCTAssertEqual(RunLaunch.shellLine(command: command), #"claude '/wololo $(rm -rf ~) `x` \ "q" ; it'\''s'"#)
        let script = RunLaunch.iTermScript(folder: "/Users/x/code/shop", command: command)
        XCTAssertTrue(script.contains(
            #"write text "cd '/Users/x/code/shop' && claude '/wololo $(rm -rf ~) `x` \\ \"q\" ; it'\\''s'""# + "\n"
        ))
        let ghostty = RunLaunch.ghosttyScript(folder: "/Users/x/code/shop", command: command)
        XCTAssertTrue(ghostty.contains(
            #"set initial input of c to "claude '/wololo $(rm -rf ~) `x` \\ \"q\" ; it'\\''s'\n""#
        ))
    }
}
