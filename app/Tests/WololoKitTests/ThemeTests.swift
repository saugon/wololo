import Foundation
import XCTest
@testable import WololoKit

/// A throwaway themes folder, removed when the test ends.
private final class ThemeFixture {
    let root: URL
    let theme: URL

    init(name: String = "propio") throws {
        root = FileManager.default.temporaryDirectory
            .appendingPathComponent("wololo-desk-theme-tests")
            .appendingPathComponent(UUID().uuidString)
        theme = root.appendingPathComponent(name)
        try FileManager.default.createDirectory(at: theme, withIntermediateDirectories: true)
    }

    deinit {
        try? FileManager.default.removeItem(at: root)
    }

    func touch(_ path: String, in folder: URL? = nil) throws {
        let file = (folder ?? theme).appendingPathComponent(path)
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("x".utf8).write(to: file)
    }

    func resolve(_ json: String) throws -> ResolvedTheme {
        try ThemeFile.decode(Data(json.utf8)).resolve(over: .actual, directory: theme)
    }
}

final class ThemeTests: XCTestCase {
    // MARK: Actual

    func testActualIsTodaysLook() {
        let actual = ThemeSpec.actual
        XCTAssertEqual(actual.id, "actual")
        XCTAssertEqual(actual.colors.ground, RGBA(hex: 0x0B0C0F))
        XCTAssertEqual(actual.colors.surface, RGBA(hex: 0x16181D))
        XCTAssertEqual(actual.colors.heading, RGBA(hex: 0xD5D8DD))
        XCTAssertEqual(actual.shapes.radius, 10)
        XCTAssertEqual(actual.shapes.bar, .continuous)
        XCTAssertEqual(actual.shapes.projectIcon, .symbol("folder"))
        XCTAssertEqual(actual.images, ThemeSpec.Images(background: nil, divider: nil, frame: nil, band: nil))
        XCTAssertEqual(actual.texts.waitingSection, "Te esperan")
        XCTAssertEqual(actual.texts.boardTitle, "Todos los runs")
        XCTAssertEqual(actual.texts.archive, "Archivo")
        XCTAssertEqual(actual.texts.empty, "Nada acá")
    }

    func testStatusStylesTakeThePluginsTones() {
        let actual = ThemeSpec.actual
        let claude = RGBA(hex: 0xFF9933), warning = RGBA(hex: 0xFFCC00), error = RGBA(hex: 0xFF6666), success = RGBA(hex: 0x3399FF)
        let gray = RGBA(hex: 0xA1A7B3)
        // As the plugin's toneOf: claude while working, warning while waiting on the person or orphaned, error when
        // blocked or failed, success when done, gray (subtle) while paused or cancelled.
        let tones: [(RunStatus, RGBA)] = [
            (.running, claude), (.waitingAgents, claude), (.waitingTests, claude), (.waitingCI, claude), (.pausing, claude),
            (.waitingUser, warning), (.waitingPermission, warning), (.stalled, warning), (.orphaned, warning),
            (.blocked, error), (.failed, error), (.done, success), (.paused, gray), (.cancelled, gray),
        ]
        for (status, tone) in tones {
            XCTAssertEqual(actual.style(status).color, tone, "\(status)")
        }
        XCTAssertEqual(actual.style(.waitingAgents), ThemeSpec.StatusStyle(
            color: claude, badge: claude, badgeText: RGBA(hex: 0x0B0C0F), activity: RGBA(hex: 0xC3C7CE)))
        XCTAssertEqual(actual.style(.unknown("new")), actual.style(.pausing))
    }

    func testBarFillFollowsTheProgressRole() {
        let actual = ThemeSpec.actual
        XCTAssertEqual(actual.barFill(.waiting), RGBA(hex: 0xFFCC00))
        XCTAssertEqual(actual.barFill(.working), RGBA(hex: 0xFF9933))
        XCTAssertEqual(actual.barFill(.onHold), RGBA(hex: 0xA1A7B3))
        XCTAssertEqual(actual.barFill(.finished), RGBA(hex: 0x3399FF))
        XCTAssertEqual(actual.barFill(.failed), RGBA(hex: 0xFF6666))

        var gold = actual
        gold.colors.bar.fill = .color(RGBA(hex: 0xD8BD7C))
        XCTAssertEqual(gold.barFill(.failed), RGBA(hex: 0xD8BD7C))
    }

    // MARK: Colors

    func testHexColors() {
        XCTAssertEqual(RGBA(hex: "#18191b"), RGBA(hex: 0x18191B))
        XCTAssertEqual(RGBA(hex: "#FFFFFF80"), RGBA(red: 255, green: 255, blue: 255, alpha: 0x80))
        XCTAssertEqual(RGBA(hex: 0x18191B).hex, "#18191b")
        XCTAssertEqual(RGBA(hex: 0xFFFFFF, alpha: 0x80).hex, "#ffffff80")
        for bad in ["18191b", "#fff", "#12345", "#1234567", "#gggggg", "red", "#", "", "#+12345"] {
            XCTAssertNil(RGBA(hex: bad), bad)
        }
    }

    // MARK: Merge

    /// Scenario 6: a partial theme changes only what it sets, the rest comes from Actual.
    func testPartialThemeChangesOnlyWhatItSets() throws {
        let fixture = try ThemeFixture(name: "parcial")
        let resolved = try fixture.resolve("""
        {"version": 1, "name": "Parcial",
         "colors": {"surface": "#202224"},
         "texts": {"columns": {"waiting": {"title": "Resisting"}}}}
        """)

        var expected = ThemeSpec.actual
        expected.id = "parcial"
        expected.name = "Parcial"
        expected.colors.surface = RGBA(hex: 0x202224)
        expected.texts.columns.waiting.title = "Resisting"
        XCTAssertEqual(resolved.spec, expected)
        XCTAssertEqual(resolved.warnings, [])
    }

    func testEmptyThemeIsActualUnderItsFolderName() throws {
        let fixture = try ThemeFixture(name: "vacio")
        let resolved = try fixture.resolve(##"{"version": 1}"##)
        var expected = ThemeSpec.actual
        expected.id = "vacio"
        expected.name = "vacio"
        XCTAssertEqual(resolved.spec, expected)
    }

    func testStatusColorsMergeFieldByField() throws {
        let fixture = try ThemeFixture()
        let spec = try fixture.resolve(##"{"version": 1, "colors": {"status": {"blocked": {"color": "#f29a92"}}}}"##).spec
        XCTAssertEqual(spec.style(.blocked).color, RGBA(hex: 0xF29A92))
        XCTAssertEqual(spec.style(.blocked).badge, ThemeSpec.actual.style(.blocked).badge)
        XCTAssertEqual(spec.style(.failed), ThemeSpec.actual.style(.failed))
    }

    // MARK: Hoods

    func testHoodIsTheColumnIconUnlessTheThemeSetsOne() throws {
        let actual = ThemeSpec.actual
        XCTAssertEqual(actual.hood(.waitingUser), actual.colors.columns.waiting.icon)
        XCTAssertEqual(actual.hood(.running), actual.colors.columns.working.icon)
        XCTAssertEqual(actual.hood(.orphaned), actual.colors.columns.onHold.icon)
        XCTAssertEqual(actual.hood(.failed), actual.colors.columns.finished.icon)

        let fixture = try ThemeFixture()
        let spec = try fixture.resolve(##"{"version": 1, "colors": {"columns": {"onHold": {"icon": "#cfcbc0"}}}}"##).spec
        XCTAssertEqual(spec.hood(.paused), RGBA(hex: 0xCFCBC0))
    }

    func testColumnHoodAndStatusHood() throws {
        let fixture = try ThemeFixture()
        let spec = try fixture.resolve("""
        {"version": 1, "colors": {
          "columns": {"working": {"hood": "#7fa9d6"}, "finished": {"hood": "#7cc08a"}},
          "status": {"failed": {"hood": "#c0655f"}}}}
        """).spec
        XCTAssertEqual(spec.hood(.running), RGBA(hex: 0x7FA9D6))
        XCTAssertEqual(spec.hood(.waitingAgents), RGBA(hex: 0x7FA9D6))
        XCTAssertEqual(spec.colors.columns.working.icon, ThemeSpec.actual.colors.columns.working.icon)
        XCTAssertEqual(spec.hood(.done), RGBA(hex: 0x7CC08A))
        XCTAssertEqual(spec.hood(.failed), RGBA(hex: 0xC0655F))
        XCTAssertEqual(spec.style(.failed).color, ThemeSpec.actual.style(.failed).color)
        XCTAssertEqual(spec.hood(.waitingUser), ThemeSpec.actual.colors.columns.waiting.icon)
    }

    func testBadHoodNamesTheKey() throws {
        let fixture = try ThemeFixture()
        XCTAssertThrowsError(try fixture.resolve(##"{"version": 1, "colors": {"columns": {"waiting": {"hood": "orange"}}}}"##)) { error in
            XCTAssertEqual(error as? ThemeError, .invalidColor(key: "colors.columns.waiting.hood", value: "orange"))
        }
        XCTAssertThrowsError(try fixture.resolve(##"{"version": 1, "colors": {"status": {"failed": {"hood": "#c06"}}}}"##)) { error in
            XCTAssertEqual(error as? ThemeError, .invalidColor(key: "colors.status.failed.hood", value: "#c06"))
        }
    }

    // MARK: Texts

    func testColumnTextFallsBack() throws {
        let actual = ThemeSpec.actual
        XCTAssertEqual(actual.columnText("waiting"), ThemeSpec.ColumnText(title: "Te espera"))
        XCTAssertEqual(actual.columnText("onHold"), ThemeSpec.ColumnText(title: "En pausa / huérfano"))
        XCTAssertEqual(actual.columnText("implement", fallback: "Implementación"), ThemeSpec.ColumnText(title: "Implementación"))
        XCTAssertEqual(actual.columnText("implement"), ThemeSpec.ColumnText(title: "implement"))

        let fixture = try ThemeFixture()
        let spec = try fixture.resolve("""
        {"version": 1, "texts": {"columns": {
          "working": {"subtitle": "Trabajando"},
          "finished": {"title": "  ", "subtitle": ""}},
          "archive": ""}}
        """).spec
        XCTAssertEqual(spec.columnText("working"), ThemeSpec.ColumnText(title: "Trabajando", subtitle: "Trabajando"))
        XCTAssertEqual(spec.columnText("finished"), ThemeSpec.ColumnText(title: "Terminado · 24 h"))
        XCTAssertEqual(spec.texts.archive, "Archivo")
    }

    func testEmptySubtitleRemovesTheBaseOne() throws {
        let fixture = try ThemeFixture()
        var base = ThemeSpec.actual
        base.texts.columns.waiting = ThemeSpec.ColumnText(title: "Resisting", subtitle: "Te espera")
        let file = try ThemeFile.decode(Data(##"{"version": 1, "texts": {"columns": {"waiting": {"subtitle": ""}}}}"##.utf8))
        let spec = try file.resolve(over: base, directory: fixture.theme).spec
        XCTAssertEqual(spec.columnText("waiting"), ThemeSpec.ColumnText(title: "Resisting"))
    }

    // MARK: Errors

    /// Scenario 7: a broken theme is an error, never a crash.
    func testInvalidJSON() throws {
        let fixture = try ThemeFixture()
        XCTAssertThrowsError(try fixture.resolve(##"{"version": 1, "colors": {"surface": "#ffffff"}"##)) { error in
            guard case ThemeError.invalidJSON = error else { return XCTFail("\(error)") }
        }
        XCTAssertThrowsError(try fixture.resolve("not json")) { error in
            guard case ThemeError.invalidJSON = error else { return XCTFail("\(error)") }
        }
        XCTAssertThrowsError(try fixture.resolve(##"{"version": 1, "shapes": {"radius": "big"}}"##)) { error in
            guard case ThemeError.invalidJSON(let detail) = error else { return XCTFail("\(error)") }
            XCTAssertTrue(detail.contains("shapes.radius"), detail)
        }
    }

    func testOnlyVersionOne() throws {
        let fixture = try ThemeFixture()
        XCTAssertThrowsError(try fixture.resolve(##"{"version": 2, "colors": {"surface": 3}}"##)) { error in
            XCTAssertEqual(error as? ThemeError, .unsupportedVersion(2))
        }
        XCTAssertThrowsError(try fixture.resolve(##"{"colors": {"surface": "#202224"}}"##)) { error in
            XCTAssertEqual(error as? ThemeError, .unsupportedVersion(nil))
        }
    }

    func testBadHexNamesTheKey() throws {
        let fixture = try ThemeFixture()
        XCTAssertThrowsError(try fixture.resolve(##"{"version": 1, "colors": {"surface": "#12345"}}"##)) { error in
            XCTAssertEqual(error as? ThemeError, .invalidColor(key: "colors.surface", value: "#12345"))
        }
        XCTAssertThrowsError(try fixture.resolve(##"{"version": 1, "colors": {"status": {"failed": {"badgeText": "white"}}}}"##)) { error in
            XCTAssertEqual(error as? ThemeError, .invalidColor(key: "colors.status.failed.badgeText", value: "white"))
        }
        XCTAssertThrowsError(try fixture.resolve(##"{"version": 1, "colors": {"columns": {"onHold": {"title": "#xyzxyz"}}}}"##)) { error in
            XCTAssertEqual(error as? ThemeError, .invalidColor(key: "colors.columns.onHold.title", value: "#xyzxyz"))
        }
        XCTAssertThrowsError(try fixture.resolve(##"{"version": 1, "colors": {"bar": {"fill": "gold"}}}"##)) { error in
            XCTAssertEqual(error as? ThemeError, .invalidColor(key: "colors.bar.fill", value: "gold"))
        }
    }

    func testUnknownChoices() throws {
        let fixture = try ThemeFixture()
        let cases: [(String, ThemeError)] = [
            (##"{"version": 1, "colors": {"status": {"sleeping": {"color": "#ffffff"}}}}"##,
             .invalidValue(key: "colors.status", value: "sleeping")),
            (##"{"version": 1, "shapes": {"bar": "zigzag"}}"##, .invalidValue(key: "shapes.bar", value: "zigzag")),
            (##"{"version": 1, "shapes": {"statusIcon": "star"}}"##, .invalidValue(key: "shapes.statusIcon", value: "star")),
            (##"{"version": 1, "shapes": {"projectIcon": "symbol:"}}"##, .invalidValue(key: "shapes.projectIcon", value: "symbol:")),
            (##"{"version": 1, "shapes": {"radius": -1}}"##, .invalidValue(key: "shapes.radius", value: "-1.0")),
            (##"{"version": 1, "fonts": {"display": {"weight": 5000}}}"##, .invalidValue(key: "fonts.display.weight", value: "5000")),
            (##"{"version": 1, "images": {"frame": {"file": "frame.png", "width": 6}}}"##, .missingField(key: "images.frame.slice")),
        ]
        for (json, expected) in cases {
            XCTAssertThrowsError(try fixture.resolve(json), json) { error in
                XCTAssertEqual(error as? ThemeError, expected, json)
            }
        }
    }

    // MARK: Paths

    func testPathsOutsideTheFolderAreRefused() throws {
        let fixture = try ThemeFixture()
        try fixture.touch("x.png", in: fixture.root)
        for path in ["../x.png", "img/../../x.png", "/etc/hosts", "~/x.png", fixture.root.appendingPathComponent("x.png").path] {
            let json = ##"{"version": 1, "images": {"background": {"file": "\##(path)", "size": 512}}}"##
            XCTAssertThrowsError(try fixture.resolve(json), path) { error in
                XCTAssertEqual(error as? ThemeError, .unsafePath(key: "images.background.file", path: path), path)
            }
        }
        XCTAssertThrowsError(try fixture.resolve(##"{"version": 1, "fonts": {"display": {"file": "../Cinzel.ttf"}}}"##)) { error in
            XCTAssertEqual(error as? ThemeError, .unsafePath(key: "fonts.display.file", path: "../Cinzel.ttf"))
        }
        XCTAssertThrowsError(try fixture.resolve(##"{"version": 1, "shapes": {"columnIcons": {"waiting": "image:../w.png"}}}"##)) { error in
            XCTAssertEqual(error as? ThemeError, .unsafePath(key: "shapes.columnIcons.waiting", path: "../w.png"))
        }
    }

    func testSymlinksLeavingTheFolderAreRefused() throws {
        let fixture = try ThemeFixture()
        let outside = fixture.root.appendingPathComponent("outside")
        try fixture.touch("secret.png", in: outside)
        let manager = FileManager.default
        try manager.createSymbolicLink(at: fixture.theme.appendingPathComponent("link.png"),
                                       withDestinationURL: outside.appendingPathComponent("secret.png"))
        try manager.createSymbolicLink(at: fixture.theme.appendingPathComponent("assets"), withDestinationURL: outside)
        try manager.createSymbolicLink(at: fixture.theme.appendingPathComponent("broken.png"),
                                       withDestinationURL: outside.appendingPathComponent("gone.png"))

        for path in ["link.png", "assets/secret.png", "assets/new.png", "broken.png"] {
            let json = ##"{"version": 1, "images": {"band": {"file": "\##(path)", "height": 10}}}"##
            XCTAssertThrowsError(try fixture.resolve(json), path) { error in
                XCTAssertEqual(error as? ThemeError, .unsafePath(key: "images.band.file", path: path), path)
            }
        }
    }

    func testSymlinksInsideTheFolderAreFine() throws {
        let fixture = try ThemeFixture()
        try fixture.touch("img/band.png")
        try FileManager.default.createSymbolicLink(at: fixture.theme.appendingPathComponent("band.png"),
                                                   withDestinationURL: fixture.theme.appendingPathComponent("img/band.png"))
        let resolved = try fixture.resolve(##"{"version": 1, "images": {"band": {"file": "band.png", "height": 10}}}"##)
        XCTAssertEqual(resolved.spec.images.band?.file.path, "band.png")
        XCTAssertEqual(resolved.warnings, [])
    }

    /// Scenario 8, at the model level: a missing file is a warning, and the theme still resolves.
    func testMissingAssetIsAWarning() throws {
        let fixture = try ThemeFixture()
        try fixture.touch("textura.png")
        let resolved = try fixture.resolve("""
        {"version": 1,
         "fonts": {"display": {"family": "Cinzel", "file": "fonts/Cinzel.ttf"}},
         "images": {"background": {"file": "./textura.png", "size": 512}, "divider": {"file": "rod.png", "width": 8}}}
        """)
        XCTAssertEqual(resolved.spec.images.background?.file.url, fixture.theme.appendingPathComponent("textura.png").standardizedFileURL)
        XCTAssertEqual(resolved.spec.fonts.display.file?.url, fixture.theme.appendingPathComponent("fonts/Cinzel.ttf").standardizedFileURL)
        XCTAssertEqual(resolved.spec.fonts.display.weight, 600)
        XCTAssertEqual(resolved.warnings, [
            "fonts.display.file: no existe fonts/Cinzel.ttf",
            "images.divider.file: no existe rod.png",
        ])
    }

    // MARK: A full theme

    func testFullThemeDecodes() throws {
        let fixture = try ThemeFixture(name: "aoe")
        for file in ["textura.png", "rod.png", "marco.png", "banda.png", "capucha.png", "Cinzel.ttf", "SourceSans3.ttf", "JetBrainsMono.ttf"] {
            try fixture.touch(file)
        }
        let resolved = try fixture.resolve("""
        {
          "version": 1, "id": "aoe", "name": "AoE", "author": "Wololo",
          "colors": {
            "ground": "#18191b", "sidebar": "#18191b", "surface": "#25272a", "surfaceHover": "#2e3034",
            "field": "#25272a", "border": "#3a3b3e", "borderHover": "#4a4b4e", "divider": "#2e3034",
            "cardDivider": "#2e3034", "rowDivider": "#2e3034",
            "title": "#ffffff", "heading": "#e5cc8c", "text": "#f2efe6", "secondary": "#dcd8cc",
            "muted": "#c8c4b8", "faint": "#bdbab0", "pendingMark": "#6b6a66", "agent": "#a6ccf2",
            "accent": "#d8bd7c", "focus": "#e5cc8c", "selection": "#2e3034",
            "widget": "#18191b", "widgetBorder": "#3a3b3e", "widgetHover": "#2e3034",
            "status": {
              "waiting": {"color": "#f5ae5c", "badge": "#f5ae5c", "badgeText": "#18191b", "activity": "#f5ae5c"},
              "permission": {"color": "#f5ae5c"}, "stalled": {"color": "#f5ae5c"},
              "blocked": {"color": "#f29a92", "activity": "#f29a92"},
              "running": {"color": "#a6ccf2"}, "agents": {"color": "#a6ccf2"}, "tests": {"color": "#a6ccf2"},
              "ci": {"color": "#a6ccf2"}, "pausing": {"color": "#a6ccf2"},
              "paused": {"color": "#cfcbc0"}, "orphaned": {"color": "#cfcbc0"},
              "done": {"color": "#a4dcae"}, "failed": {"color": "#f29a92"}, "cancelled": {"color": "#cfcbc0"}
            },
            "columns": {
              "waiting": {"icon": "#f5ae5c", "title": "#e5cc8c"}, "working": {"icon": "#a6ccf2", "title": "#e5cc8c"},
              "onHold": {"icon": "#cfcbc0", "title": "#e5cc8c"}, "finished": {"icon": "#a4dcae", "title": "#e5cc8c"}
            },
            "bar": {"fill": "#d8bd7c", "track": "#35363a"},
            "ci": {"pending": "#f5ae5c", "passing": "#a4dcae", "failing": "#f29a92", "none": "#bdbab0"}
          },
          "fonts": {
            "display": {"family": "Cinzel", "file": "Cinzel.ttf", "weight": 700, "tracking": 0.5},
            "body": {"family": "Source Sans 3", "file": "SourceSans3.ttf"},
            "mono": {"family": "JetBrains Mono", "file": "JetBrainsMono.ttf"}
          },
          "images": {
            "background": {"file": "textura.png", "size": 512},
            "divider": {"file": "rod.png", "width": 8},
            "frame": {"file": "marco.png", "slice": 12, "width": 6},
            "band": {"file": "banda.png", "height": 10}
          },
          "shapes": {
            "radius": 2, "bar": "blocks", "bullet": "gem", "statusIcon": "hood",
            "columnIcons": {"waiting": "builtin:resisting", "working": "builtin:converting", "onHold": "builtin:idle",
                            "finished": "image:capucha.png"},
            "projectIcon": "builtin:castle"
          },
          "texts": {
            "columns": {
              "waiting": {"title": "Resisting", "subtitle": "Te espera"},
              "working": {"title": "Converting", "subtitle": "Trabajando"},
              "onHold": {"title": "Idle", "subtitle": "En pausa / huérfano"},
              "finished": {"title": "Unit ready", "subtitle": "Terminado"}
            },
            "waitingSection": "Te esperan", "projectsSection": "Buildings", "all": "Todos",
            "boardTitle": "Todos los runs", "counterWorking": "trabajando", "counterWaiting": "idle",
            "archive": "Archivo", "empty": "Nada acá"
          }
        }
        """)
        let spec = resolved.spec
        XCTAssertEqual(resolved.warnings, [])
        XCTAssertEqual(spec.id, "aoe")
        XCTAssertEqual(spec.author, "Wololo")
        XCTAssertEqual(spec.colors.ground, RGBA(hex: 0x18191B))
        XCTAssertEqual(spec.style(.waitingUser).badgeText, RGBA(hex: 0x18191B))
        XCTAssertEqual(spec.style(.done).color, RGBA(hex: 0xA4DCAE))
        XCTAssertEqual(spec.barFill(.working), RGBA(hex: 0xD8BD7C))
        XCTAssertEqual(spec.colors.bar.track, RGBA(hex: 0x35363A))
        XCTAssertEqual(spec.fonts.display.family, "Cinzel")
        XCTAssertEqual(spec.fonts.display.weight, 700)
        XCTAssertEqual(spec.fonts.display.tracking, 0.5)
        XCTAssertEqual(spec.fonts.mono.file?.path, "JetBrainsMono.ttf")
        XCTAssertEqual(spec.images.frame?.slice, 12)
        XCTAssertEqual(spec.images.frame?.width, 6)
        XCTAssertEqual(spec.images.background?.size, 512)
        XCTAssertEqual(spec.shapes.bar, .blocks)
        XCTAssertEqual(spec.shapes.bullet, .gem)
        XCTAssertEqual(spec.shapes.statusIcon, .hood)
        XCTAssertEqual(spec.shapes.columnIcons.waiting, .builtin("resisting"))
        XCTAssertEqual(spec.shapes.columnIcons.finished,
                       .image(ThemeAsset(path: "capucha.png", url: fixture.theme.appendingPathComponent("capucha.png").standardizedFileURL)))
        XCTAssertEqual(spec.shapes.projectIcon, .builtin("castle"))
        XCTAssertEqual(spec.columnText("waiting"), ThemeSpec.ColumnText(title: "Resisting", subtitle: "Te espera"))
        XCTAssertEqual(spec.texts.projectsSection, "Buildings")
        XCTAssertEqual(spec.texts.counterWaiting, "idle")
    }
}
