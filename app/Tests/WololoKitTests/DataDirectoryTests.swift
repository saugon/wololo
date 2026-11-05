import XCTest
@testable import WololoKit

final class DataDirectoryTests: XCTestCase {
    private let home = URL(fileURLWithPath: "/Users/someone", isDirectory: true)
    private var suite = ""
    private var defaults: UserDefaults!

    override func setUpWithError() throws {
        suite = "wololo-desk-tests-\(UUID().uuidString)"
        defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suite)
    }

    func testDefaultsToTheModsDataDirectory() {
        let directory = DataDirectory.resolve(environment: [:], defaults: defaults, home: home)
        XCTAssertEqual(directory.url.path, "/Users/someone/.claude/wololo")
        XCTAssertEqual(directory.runsURL.path, "/Users/someone/.claude/wololo/runs")
        XCTAssertEqual(directory.origin, .standard)
    }

    func testSettingBeatsTheDefault() {
        defaults.set("/Volumes/work/wololo", forKey: DataDirectory.settingKey)
        let directory = DataDirectory.resolve(environment: [:], defaults: defaults, home: home)
        XCTAssertEqual(directory.url.path, "/Volumes/work/wololo")
        XCTAssertEqual(directory.origin, .setting)
    }

    func testEnvironmentBeatsTheSetting() {
        defaults.set("/Volumes/work/wololo", forKey: DataDirectory.settingKey)
        let directory = DataDirectory.resolve(environment: ["WOLOLO_DATA_DIR": "/tmp/sample"], defaults: defaults, home: home)
        XCTAssertEqual(directory.url.path, "/tmp/sample")
        XCTAssertEqual(directory.runsURL.path, "/tmp/sample/runs")
        XCTAssertEqual(directory.origin, .environment)
    }

    func testBlankValuesFallThroughAndTildeExpands() {
        defaults.set("~/wololo-data", forKey: DataDirectory.settingKey)
        let directory = DataDirectory.resolve(environment: ["WOLOLO_DATA_DIR": "  "], defaults: defaults, home: home)
        XCTAssertEqual(directory.url.path, "/Users/someone/wololo-data")
        XCTAssertEqual(directory.origin, .setting)

        defaults.set("", forKey: DataDirectory.settingKey)
        XCTAssertEqual(DataDirectory.resolve(environment: [:], defaults: defaults, home: home).origin, .standard)
    }
}
