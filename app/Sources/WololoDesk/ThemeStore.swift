import AppKit
import CoreText
import Observation
import WololoKit

/// The themes the app can offer and the one in use. A new choice is applied at once wherever a `ThemedRoot` reads
/// `theme`. `WOLOLO_DESK_THEME` picks the theme for one launch without touching the saved choice.
@MainActor
@Observable
final class ThemeStore {
    /// `~/Library/Application Support/Wololo Desk/Themes`, where the person's own themes go.
    static let defaultUserDirectory: URL? = FileManager.default
        .urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
        .appendingPathComponent("Wololo Desk/Themes", isDirectory: true)

    private(set) var library: ThemeLibrary
    /// The key of the theme in use.
    private(set) var key: String
    private(set) var theme: AppTheme
    /// What the theme in use asks for that is not there, such as a missing image or font: it is drawn without it.
    private(set) var warnings: [String]

    var entries: [ThemeEntry] { library.entries }

    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let persists: Bool
    @ObservationIgnored private let userDirectory: URL?

    /// With `persists: false` (snapshots) or a theme forced by `WOLOLO_DESK_THEME`, a choice is not saved.
    init(options: LaunchOptions, defaults: UserDefaults, persists: Bool) {
        self.defaults = defaults
        self.persists = persists && options.theme == nil
        let userDirectory = options.themesDirectory ?? Self.defaultUserDirectory
        let library = ThemeLibrary(builtIns: AppResources.builtInThemes, userDirectory: userDirectory)
        self.userDirectory = userDirectory
        self.library = library
        let key = library.startingKey(forced: options.theme, saved: defaults.string(forKey: SettingsKey.theme))
        (self.key, theme, warnings) = Self.load(key, from: library)
    }

    /// Uses the theme and saves the choice. Returns false, changing nothing, when the theme cannot be used.
    @discardableResult
    func select(_ key: String) -> Bool {
        guard library.entry(key)?.isUsable == true else { return false }
        apply(key)
        if persists { defaults.set(key, forKey: SettingsKey.theme) }
        return true
    }

    /// Reads the themes folder again and redraws the theme in use from disk; if it is gone or broken now, Actual.
    func reload() {
        library = ThemeLibrary(builtIns: AppResources.builtInThemes, userDirectory: userDirectory)
        apply(library.startingKey(forced: nil, saved: key))
    }

    private func apply(_ key: String) {
        (self.key, theme, warnings) = Self.load(key, from: library)
    }

    /// The theme with its fonts registered, or Actual as it was before themes when not even the built-in
    /// Actual can be read (no resource bundle).
    private static func load(_ key: String, from library: ThemeLibrary) -> (String, AppTheme, [String]) {
        guard let resolved = try? library.resolve(key) else {
            return (ThemeLibrary.defaultKey, AppTheme.actual, [])
        }
        let spec = resolved.spec
        let theme = AppTheme(spec: spec)
        var warnings = resolved.warnings
        let fonts: [(String, AppTheme.FontRole, ThemeSpec.FontSpec)] = [
            ("display", .display, spec.fonts.display), ("body", .body, spec.fonts.body), ("mono", .mono, spec.fonts.mono),
        ]
        for (name, role, font) in fonts {
            if let file = font.file, let failure = register(file.url) {
                warnings.append("fonts.\(name).file: \(failure)")
            }
            if let family = font.family, !theme.hasFamily(role) {
                warnings.append("fonts.\(name).family: no está \(family), se usa la del sistema")
            }
        }
        return (spec.id, theme, warnings)
    }

    /// Makes a theme's font file available to this process; returns why it could not, if it could not.
    private static func register(_ url: URL) -> String? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        var error: Unmanaged<CFError>?
        if CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error) { return nil }
        guard let error = error?.takeRetainedValue() else { return "no se pudo registrar \(url.lastPathComponent)" }
        if CFErrorGetCode(error) == CTFontManagerError.alreadyRegistered.rawValue { return nil }
        return CFErrorCopyDescription(error) as String? ?? "no se pudo registrar \(url.lastPathComponent)"
    }
}
