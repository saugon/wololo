import Foundation
import XCTest
@testable import WololoKit

/// Built-in theme folders and a user themes folder, removed when the test ends.
private final class LibraryFixture {
    let root: URL
    let builtIns: URL
    let user: URL

    init() throws {
        root = FileManager.default.temporaryDirectory
            .appendingPathComponent("wololo-desk-theme-library-tests")
            .appendingPathComponent(UUID().uuidString)
        builtIns = root.appendingPathComponent("Themes")
        user = root.appendingPathComponent("user/Themes")
        try write(builtIns.appendingPathComponent("actual"), ##"{"version": 1, "id": "actual", "name": "Actual"}"##)
        try write(builtIns.appendingPathComponent("aoe"), ##"""
        {"version": 1, "id": "aoe", "name": "AoE", "author": "Wololo",
         "colors": {"surface": "#202224"},
         "images": {"background": {"file": "assets/texture.png", "size": 128}}}
        """##)
        try touch(builtIns.appendingPathComponent("aoe/assets/texture.png"))
    }

    deinit {
        try? FileManager.default.removeItem(at: root)
    }

    var builtInFolders: [URL] { ["actual", "aoe"].map { builtIns.appendingPathComponent($0) } }

    func library() -> ThemeLibrary {
        ThemeLibrary(builtIns: builtInFolders, userDirectory: user)
    }

    func write(_ folder: URL, _ json: String) throws {
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try Data(json.utf8).write(to: folder.appendingPathComponent("theme.json"))
    }

    func touch(_ file: URL) throws {
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("x".utf8).write(to: file)
    }

    func json(_ key: String) throws -> [String: Any] {
        let data = try Data(contentsOf: user.appendingPathComponent(key).appendingPathComponent("theme.json"))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }
}

final class ThemeLibraryTests: XCTestCase {
    // MARK: Discovery

    func testBuiltInsFirstThenUserFoldersSorted() throws {
        let fixture = try LibraryFixture()
        try fixture.write(fixture.user.appendingPathComponent("zeta"), ##"{"version": 1, "name": "Zeta"}"##)
        try fixture.write(fixture.user.appendingPathComponent("Alfa"), ##"{"version": 1}"##)
        try fixture.write(fixture.user.appendingPathComponent("roto"), ##"{"version": 1, "colors": "#fff""##)
        try fixture.write(fixture.user.appendingPathComponent("ruta-mala"),
                          ##"{"version": 1, "images": {"band": {"file": "../x.png"}}}"##)
        try FileManager.default.createDirectory(at: fixture.user.appendingPathComponent("sin-json"), withIntermediateDirectories: true)
        try fixture.write(fixture.user.appendingPathComponent(".oculto"), ##"{"version": 1}"##)
        try fixture.touch(fixture.user.appendingPathComponent("notas.txt"))

        let entries = fixture.library().entries
        XCTAssertEqual(entries.map(\.key), ["actual", "aoe", "Alfa", "roto", "ruta-mala", "sin-json", "zeta"])
        XCTAssertEqual(entries.map(\.isBuiltIn), [true, true, false, false, false, false, false])
        XCTAssertEqual(entries.map(\.name), ["Actual", "AoE", "Alfa", "roto", "ruta-mala", "sin-json", "Zeta"])
        XCTAssertEqual(entries.map(\.isUsable), [true, true, true, false, false, false, true])

        let errors = Dictionary(uniqueKeysWithValues: entries.map { ($0.key, $0.error) })
        XCTAssertTrue(try XCTUnwrap(errors["roto"] ?? nil).hasPrefix("theme.json no es JSON válido"))
        XCTAssertEqual(errors["ruta-mala"], ThemeError.unsafePath(key: "images.band.file", path: "../x.png").description)
        XCTAssertEqual(errors["sin-json"], "falta theme.json")
        XCTAssertEqual(entries[1].directory, fixture.builtIns.appendingPathComponent("aoe"))
    }

    func testAUserFolderCannotTakeABuiltInName() throws {
        let fixture = try LibraryFixture()
        try fixture.write(fixture.user.appendingPathComponent("aoe"), ##"{"version": 1, "name": "Mi AoE"}"##)
        try fixture.write(fixture.user.appendingPathComponent("Actual"), ##"{"version": 1}"##)

        let library = fixture.library()
        let user = library.entries.filter { !$0.isBuiltIn }
        XCTAssertEqual(user.map(\.key), ["Actual", "aoe"])
        XCTAssertEqual(user.map(\.error), ["nombre reservado", "nombre reservado"])
        XCTAssertEqual(Set(library.entries.map(\.id)).count, library.entries.count, "ids stay unique")
        XCTAssertEqual(library.entry("aoe")?.isBuiltIn, true)
        XCTAssertEqual(try library.resolve("aoe").spec.name, "AoE")
    }

    func testWithoutUserFolderThereAreOnlyBuiltIns() throws {
        let fixture = try LibraryFixture()
        XCTAssertEqual(fixture.library().entries.map(\.key), ["actual", "aoe"], "the folder does not exist yet")
        XCTAssertEqual(ThemeLibrary(builtIns: fixture.builtInFolders, userDirectory: nil).entries.map(\.key), ["actual", "aoe"])
    }

    // MARK: Resolve

    func testResolveFallsBackToActualAndUsesTheKeyAsID() throws {
        let fixture = try LibraryFixture()
        try fixture.write(fixture.user.appendingPathComponent("mio"),
                          ##"{"version": 1, "id": "otro", "name": "Mío", "fonts": {"display": {"family": "Cinzel", "file": "fonts/Cinzel.ttf"}}}"##)
        let library = fixture.library()

        let aoe = try library.resolve("aoe")
        XCTAssertEqual(aoe.spec.id, "aoe")
        XCTAssertEqual(aoe.spec.colors.surface, RGBA(hex: 0x202224))
        XCTAssertEqual(aoe.spec.colors.ground, ThemeSpec.actual.colors.ground)
        XCTAssertEqual(aoe.spec.images.background?.file.url, fixture.builtIns.appendingPathComponent("aoe/assets/texture.png"))
        XCTAssertEqual(aoe.warnings, [])

        let mine = try library.resolve("mio")
        XCTAssertEqual(mine.spec.id, "mio")
        XCTAssertEqual(mine.spec.name, "Mío")
        XCTAssertEqual(mine.warnings, ["fonts.display.file: no existe fonts/Cinzel.ttf"])
        XCTAssertEqual(library.entry("mio")?.warnings, mine.warnings)
        XCTAssertTrue(library.entry("mio")?.isUsable ?? false, "a missing file is a warning")
    }

    func testResolveRefusesUnknownAndBrokenThemes() throws {
        let fixture = try LibraryFixture()
        try fixture.write(fixture.user.appendingPathComponent("roto"), ##"{"version": 2}"##)
        let library = fixture.library()

        XCTAssertThrowsError(try library.resolve("nada")) { error in
            XCTAssertEqual(error as? ThemeLibraryError, .notFound("nada"))
        }
        XCTAssertThrowsError(try library.resolve("roto")) { error in
            XCTAssertEqual(error as? ThemeLibraryError,
                           .unusable(key: "roto", reason: ThemeError.unsupportedVersion(2).description))
        }
    }

    // MARK: Starting theme

    func testStartingKeyPrefersTheForcedThemeThenTheSavedOne() throws {
        let fixture = try LibraryFixture()
        try fixture.write(fixture.user.appendingPathComponent("mio"), ##"{"version": 1}"##)
        let library = fixture.library()

        XCTAssertEqual(library.startingKey(forced: nil, saved: nil), "actual")
        XCTAssertEqual(library.startingKey(forced: nil, saved: "mio"), "mio")
        XCTAssertEqual(library.startingKey(forced: "aoe", saved: "mio"), "aoe")
    }

    func testStartingKeyFallsBackToActualWhenTheThemeCannotBeUsed() throws {
        let fixture = try LibraryFixture()
        try fixture.write(fixture.user.appendingPathComponent("roto"), "{")
        let library = fixture.library()

        XCTAssertEqual(library.startingKey(forced: nil, saved: "borrado"), "actual", "a saved theme that is gone")
        XCTAssertEqual(library.startingKey(forced: nil, saved: "roto"), "actual")
        XCTAssertEqual(library.startingKey(forced: "nada", saved: "aoe"), "actual", "a forced theme does not fall back to the saved one")
    }

    // MARK: Duplicate

    /// Scenario 9: duplicating AoE creates `aoe-copia` with its theme.json and assets, and it shows up in the list.
    func testDuplicateCopiesTheFolderUnderAFreeKey() throws {
        let fixture = try LibraryFixture()
        let library = fixture.library()

        XCTAssertEqual(try library.duplicate("aoe", into: fixture.user), "aoe-copia")
        XCTAssertEqual(try library.duplicate("aoe", into: fixture.user), "aoe-copia-2")

        let copy = fixture.user.appendingPathComponent("aoe-copia")
        XCTAssertTrue(FileManager.default.fileExists(atPath: copy.appendingPathComponent("assets/texture.png").path))
        let json = try fixture.json("aoe-copia")
        XCTAssertEqual(json["id"] as? String, "aoe-copia")
        XCTAssertEqual(json["name"] as? String, "AoE (copia)")
        XCTAssertEqual(json["author"] as? String, "Wololo")
        XCTAssertEqual((json["colors"] as? [String: Any])?["surface"] as? String, "#202224")
        XCTAssertEqual(try fixture.json("aoe-copia-2")["id"] as? String, "aoe-copia-2")

        let reloaded = fixture.library()
        XCTAssertEqual(reloaded.entries.map(\.key), ["actual", "aoe", "aoe-copia", "aoe-copia-2"])
        let resolved = try reloaded.resolve("aoe-copia")
        XCTAssertEqual(resolved.spec.name, "AoE (copia)")
        XCTAssertEqual(resolved.spec.colors.surface, RGBA(hex: 0x202224))
        XCTAssertEqual(resolved.spec.images.background?.file.url, copy.appendingPathComponent("assets/texture.png"))
        XCTAssertEqual(resolved.warnings, [])
        XCTAssertEqual(try fixture.library().duplicate("aoe-copia", into: fixture.user), "aoe-copia-copia")
    }

    func testDuplicateRefusesUnknownAndBrokenThemes() throws {
        let fixture = try LibraryFixture()
        try fixture.write(fixture.user.appendingPathComponent("roto"), "{")
        let library = fixture.library()

        XCTAssertThrowsError(try library.duplicate("nada", into: fixture.user)) { error in
            XCTAssertEqual(error as? ThemeLibraryError, .notFound("nada"))
        }
        XCTAssertThrowsError(try library.duplicate("roto", into: fixture.user))
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: fixture.user.path), ["roto"])
    }
}
