import CoreText
import Foundation
import XCTest
@testable import WololoKit

/// The themes and fonts the app bundles, read from the source tree.
final class BuiltInThemesTests: XCTestCase {
    private static let resources = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .appendingPathComponent("Sources/WololoDesk/Resources")

    private func folder(_ key: String) -> URL {
        Self.resources.appendingPathComponent("Themes").appendingPathComponent(key)
    }

    private func file(_ key: String) throws -> ThemeFile {
        try ThemeFile.decode(Data(contentsOf: folder(key).appendingPathComponent(ThemeLibrary.fileName)))
    }

    private func resolve(_ key: String, over base: ThemeSpec = .actual) throws -> ResolvedTheme {
        try file(key).resolve(over: base, directory: folder(key))
    }

    func testActualJSONIsTheActualConstant() throws {
        let resolved = try resolve("actual")
        XCTAssertEqual(resolved.spec, .actual)
        XCTAssertEqual(resolved.warnings, [])
    }

    /// Over a base that differs almost everywhere, `actual/theme.json` still gives `ThemeSpec.actual`: it writes out
    /// every value instead of inheriting it. Only what `theme.json` cannot unset is put back by hand.
    func testActualJSONSetsEveryValue() throws {
        let aoe = try resolve("aoe").spec
        var spec = try resolve("actual", over: aoe).spec
        spec.images = ThemeSpec.actual.images
        spec.fonts.body.weight = ThemeSpec.actual.fonts.body.weight
        spec.fonts.mono.weight = ThemeSpec.actual.fonts.mono.weight
        for group in StatusGroup.allCases {
            spec.colors.columns[group].hood = nil
        }
        spec.colors.status.failed.hood = nil
        XCTAssertEqual(spec, .actual)
    }

    func testAoEResolvesWithEveryFilePresent() throws {
        let resolved = try resolve("aoe")
        let spec = resolved.spec
        XCTAssertEqual(resolved.warnings, [])
        XCTAssertEqual(spec.id, "aoe")
        XCTAssertEqual(spec.name, "AoE")
        XCTAssertEqual(spec.colors.ground, RGBA(hex: 0x18191B))
        XCTAssertEqual(spec.colors.surface, RGBA(hex: 0x25272A))
        XCTAssertEqual(spec.barFill(.working), RGBA(hex: 0xD8BD7C))
        XCTAssertEqual(spec.colors.columns.waiting.title, RGBA(hex: 0xE5CC8C))
        XCTAssertEqual(spec.hood(.waitingUser), RGBA(hex: 0xE8963A))
        XCTAssertEqual(spec.hood(.waitingAgents), RGBA(hex: 0x7FA9D6))
        XCTAssertEqual(spec.hood(.paused), RGBA(hex: 0x8D8C84))
        XCTAssertEqual(spec.hood(.inReview), RGBA(hex: 0x9A83C9))
        XCTAssertEqual(spec.style(.inReview).color, RGBA(hex: 0xC8B4F0))
        XCTAssertEqual(spec.hood(.done), RGBA(hex: 0x7CC08A))
        XCTAssertEqual(spec.hood(.failed), RGBA(hex: 0xC0655F))
        XCTAssertEqual(spec.fonts.display.family, "Cinzel")
        XCTAssertEqual(spec.fonts.display.weight, 700)
        XCTAssertEqual(spec.fonts.display.tracking, 0.04)
        XCTAssertEqual(spec.fonts.body.family, "Source Sans 3")
        XCTAssertEqual(spec.fonts.mono.family, "JetBrains Mono")
        XCTAssertEqual(spec.fonts.mono.weight, 500)
        XCTAssertEqual(spec.images.background?.size, 512)
        XCTAssertEqual(spec.images.divider?.width, 8)
        XCTAssertNil(spec.images.frame, "AoE draws no iron frames, as in the reference image")
        XCTAssertEqual(spec.images.band?.height, 10)
        XCTAssertEqual(spec.shapes.radius, 0)
        XCTAssertEqual(spec.shapes.bar, .blocks)
        XCTAssertEqual(spec.shapes.bullet, .gem)
        XCTAssertEqual(spec.shapes.statusIcon, .hood)
        XCTAssertEqual(spec.shapes.columnIcons, PerColumn(
            waiting: .builtin("resisting"), working: .builtin("converting"), review: .builtin("researching"),
            onHold: .builtin("idle"), finished: .builtin("unitReady")
        ))
        XCTAssertEqual(spec.shapes.projectIcon, .builtin("castle"))
        XCTAssertEqual(spec.columnText("finished"), ThemeSpec.ColumnText(title: "Unit ready", subtitle: "Terminado · 24 h"))
        XCTAssertEqual(spec.columnText("review"), ThemeSpec.ColumnText(title: "Researching", subtitle: "En revisión"))
        XCTAssertEqual(spec.texts.projectsSection, "Buildings")
        XCTAssertEqual(spec.texts.counterWaiting, "idle")
        for asset in [spec.images.background?.file, spec.images.divider?.file, spec.images.band?.file] {
            let asset = try XCTUnwrap(asset)
            XCTAssertTrue(FileManager.default.fileExists(atPath: asset.url.path), asset.path)
        }
    }

    func testTheLibraryOffersBothBuiltIns() throws {
        let library = ThemeLibrary(builtIns: ["actual", "aoe"].map(folder), userDirectory: nil)
        XCTAssertEqual(library.entries.map(\.key), ["actual", "aoe"])
        XCTAssertEqual(library.entries.map(\.error), [nil, nil])
        XCTAssertEqual(try library.resolve("actual").spec, .actual)
    }

    /// The bundled fonts provide, by family, every font a built-in theme names, and each comes with its licence.
    func testBundledFontsCoverTheBuiltInThemes() throws {
        let fonts = Self.resources.appendingPathComponent("Fonts")
        let files = try FileManager.default.contentsOfDirectory(at: fonts, includingPropertiesForKeys: nil)
        var families: Set<String> = []
        for file in files where file.pathExtension == "ttf" {
            let descriptors = try XCTUnwrap(CTFontManagerCreateFontDescriptorsFromURL(file as CFURL) as? [CTFontDescriptor],
                                            file.lastPathComponent)
            for descriptor in descriptors {
                if let family = CTFontDescriptorCopyAttribute(descriptor, kCTFontFamilyNameAttribute) as? String {
                    families.insert(family)
                }
            }
            // Cinzel-Variable.ttf comes with OFL-Cinzel.txt.
            let name = file.deletingPathExtension().lastPathComponent.replacingOccurrences(of: "-Variable", with: "")
            let licence = fonts.appendingPathComponent("OFL-\(name).txt")
            XCTAssertTrue(FileManager.default.fileExists(atPath: licence.path), licence.lastPathComponent)
        }
        let named = try ["actual", "aoe"].flatMap { key -> [String] in
            let fonts = try resolve(key).spec.fonts
            return [fonts.display, fonts.body, fonts.mono].compactMap(\.family)
        }
        XCTAssertEqual(Set(named), ["Cinzel", "Source Sans 3", "JetBrains Mono"])
        XCTAssertTrue(Set(named).isSubset(of: families), "\(families)")
    }
}
