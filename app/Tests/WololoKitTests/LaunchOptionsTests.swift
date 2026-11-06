import XCTest
@testable import WololoKit

final class LaunchOptionsTests: XCTestCase {
    func testNothingSetOpensNothing() {
        XCTAssertEqual(LaunchOptions(environment: [:]), LaunchOptions())
    }

    func testViews() {
        XCTAssertEqual(LaunchOptions(environment: ["WOLOLO_DESK_OPEN": "window"]).open, .window)
        XCTAssertEqual(LaunchOptions(environment: ["WOLOLO_DESK_OPEN": "widget"]).open, .widget)
        XCTAssertEqual(LaunchOptions(environment: ["WOLOLO_DESK_OPEN": "settings"]).open, .settings)
        XCTAssertNil(LaunchOptions(environment: ["WOLOLO_DESK_OPEN": "dock"]).open)
    }

    func testRunWithAndWithoutTab() {
        XCTAssertEqual(LaunchOptions(environment: ["WOLOLO_DESK_OPEN": "run:web-4312-a4f9c2"]).open,
                       .run(id: "web-4312-a4f9c2", tab: nil))
        for tab in LaunchOptions.DetailTab.allCases {
            XCTAssertEqual(LaunchOptions(environment: ["WOLOLO_DESK_OPEN": "run:r1:\(tab.rawValue)"]).open,
                           .run(id: "r1", tab: tab))
        }
        XCTAssertEqual(LaunchOptions(environment: ["WOLOLO_DESK_OPEN": "run:r1:logs"]).open, .run(id: "r1", tab: nil))
        XCTAssertNil(LaunchOptions(environment: ["WOLOLO_DESK_OPEN": "run:"]).open)
        XCTAssertNil(LaunchOptions(environment: ["WOLOLO_DESK_OPEN": "run"]).open)
    }

    func testFiltersColumnsAndSnapshot() {
        let options = LaunchOptions(environment: [
            "WOLOLO_DESK_OPEN": "window",
            "WOLOLO_DESK_SEARCH": "4312",
            "WOLOLO_DESK_PROJECT": "saugon__wololo",
            "WOLOLO_DESK_COLUMNS": "stage",
            "WOLOLO_DESK_SNAPSHOT": "/tmp/shots/board.png",
        ])
        XCTAssertEqual(options, LaunchOptions(open: .window, search: "4312", project: "saugon__wololo", columns: .byStage,
                                              snapshotURL: URL(fileURLWithPath: "/tmp/shots/board.png")))
        XCTAssertEqual(LaunchOptions(environment: ["WOLOLO_DESK_COLUMNS": "status"]).columns, .byStatus)
        XCTAssertNil(LaunchOptions(environment: ["WOLOLO_DESK_COLUMNS": "items"]).columns)
        XCTAssertNil(LaunchOptions(environment: ["WOLOLO_DESK_SEARCH": ""]).search)
    }

    /// Scenario 10: a theme forced for one launch, and a themes folder outside Application Support.
    func testThemeAndThemesDirectory() {
        let options = LaunchOptions(environment: [
            "WOLOLO_DESK_THEME": " aoe ",
            "WOLOLO_DESK_THEMES_DIR": "/tmp/wololo/themes",
        ])
        XCTAssertEqual(options, LaunchOptions(theme: "aoe", themesDirectory: URL(fileURLWithPath: "/tmp/wololo/themes")))
        XCTAssertEqual(LaunchOptions(environment: ["WOLOLO_DESK_THEMES_DIR": "~/temas"]).themesDirectory?.path,
                       (NSHomeDirectory() as NSString).appendingPathComponent("temas"))
        XCTAssertNil(LaunchOptions(environment: ["WOLOLO_DESK_THEME": ""]).theme)
        XCTAssertNil(LaunchOptions(environment: ["WOLOLO_DESK_THEMES_DIR": "  "]).themesDirectory)
    }
}
