import XCTest
@testable import WololoKit

final class DataDirectoryTests: XCTestCase {
    private let home = URL(fileURLWithPath: "/Users/someone", isDirectory: true)

    func testDefaultsToTheModsDataDirectory() {
        let directory = DataDirectory.resolve(environment: [:], setting: nil, home: home)
        XCTAssertEqual(directory.url.path, "/Users/someone/.claude/wololo")
        XCTAssertEqual(directory.runsURL.path, "/Users/someone/.claude/wololo/runs")
        XCTAssertEqual(directory.origin, .standard)
    }

    func testSettingBeatsTheDefault() {
        let directory = DataDirectory.resolve(environment: [:], setting: "/Volumes/work/wololo", home: home)
        XCTAssertEqual(directory.url.path, "/Volumes/work/wololo")
        XCTAssertEqual(directory.origin, .setting)
    }

    func testEnvironmentBeatsTheSetting() {
        let directory = DataDirectory.resolve(environment: ["WOLOLO_DATA_DIR": "/tmp/sample"], setting: "/Volumes/work/wololo", home: home)
        XCTAssertEqual(directory.url.path, "/tmp/sample")
        XCTAssertEqual(directory.runsURL.path, "/tmp/sample/runs")
        XCTAssertEqual(directory.origin, .environment)
    }

    func testBlankValuesFallThroughAndTildeExpands() {
        let directory = DataDirectory.resolve(environment: ["WOLOLO_DATA_DIR": "  "], setting: "~/wololo-data", home: home)
        XCTAssertEqual(directory.url.path, "/Users/someone/wololo-data")
        XCTAssertEqual(directory.origin, .setting)

        XCTAssertEqual(DataDirectory.resolve(environment: [:], setting: "", home: home).origin, .standard)
    }
}
