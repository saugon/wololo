import CoreText
import Foundation

/// The files the app ships: the fonts with their licences and the built-in themes. They live in SwiftPM's resource
/// bundle, which `build-app.sh` copies into `Contents/Resources` and `swift build` leaves next to the binary.
/// `Bundle.module` is not used: its fallback is the absolute path of the build folder, which a moved `.app` must not
/// depend on.
enum AppResources {
    static let bundleName = "WololoDesk_WololoDesk.bundle"
    /// The built-in themes, in the order Settings lists them.
    static let builtInThemeKeys = ["actual", "aoe"]

    /// The resource bundle's folder of resources, or nil when it is in neither place.
    static let url: URL? = {
        let main = Bundle.main
        let executableFolder = main.executableURL?.resolvingSymlinksInPath().deletingLastPathComponent()
        let candidates = [main.resourceURL, main.bundleURL, executableFolder].compactMap { $0 }
        for folder in candidates {
            let bundleURL = folder.appendingPathComponent(bundleName)
            guard FileManager.default.fileExists(atPath: bundleURL.path) else { continue }
            return Bundle(url: bundleURL)?.resourceURL ?? bundleURL
        }
        return nil
    }()

    static var fontsURL: URL? { url?.appendingPathComponent("Fonts") }
    static var themesURL: URL? { url?.appendingPathComponent("Themes") }

    /// The built-in theme folders, for `ThemeLibrary(builtIns:userDirectory:)`. Empty without the resource bundle.
    static var builtInThemes: [URL] {
        guard let themesURL else { return [] }
        return builtInThemeKeys.map { themesURL.appendingPathComponent($0) }
    }

    /// Makes the bundled fonts available to this process by family name ("Cinzel", "Source Sans 3",
    /// "JetBrains Mono"). Returns what could not be registered, also written to stderr; a theme whose font is missing
    /// falls back to the system font.
    @discardableResult
    static func registerFonts() -> [String] {
        guard let fontsURL else {
            return report(["no está \(bundleName): las fuentes de los temas usan la del sistema"])
        }
        let files = (try? FileManager.default.contentsOfDirectory(at: fontsURL, includingPropertiesForKeys: nil)) ?? []
        var failures: [String] = []
        for file in files where file.pathExtension.lowercased() == "ttf" {
            var error: Unmanaged<CFError>?
            if CTFontManagerRegisterFontsForURL(file as CFURL, .process, &error) { continue }
            guard let error = error?.takeRetainedValue() else {
                failures.append("\(file.lastPathComponent): no se pudo registrar")
                continue
            }
            if CFErrorGetCode(error) == CTFontManagerError.alreadyRegistered.rawValue { continue }
            failures.append("\(file.lastPathComponent): \(CFErrorCopyDescription(error) as String? ?? "no se pudo registrar")")
        }
        return report(failures)
    }

    private static func report(_ failures: [String]) -> [String] {
        for failure in failures {
            FileHandle.standardError.write(Data("fonts: \(failure)\n".utf8))
        }
        return failures
    }
}
