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
    /// Where the person's own themes go: `WOLOLO_DESK_THEMES_DIR` or Application Support. It may not exist yet.
    let userDirectory: URL?
    /// `WOLOLO_DESK_THEME` chose the theme for this launch, so a choice made now is not saved.
    let isForced: Bool

    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let persists: Bool

    /// With `persists: false` (snapshots) or a theme forced by `WOLOLO_DESK_THEME`, a choice is not saved.
    init(options: LaunchOptions, defaults: UserDefaults, persists: Bool) {
        self.defaults = defaults
        self.persists = persists && options.theme == nil
        isForced = options.theme != nil
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

    /// Copies the theme in use into the user's folder, reads the folder again and uses the copy. Returns its key,
    /// also the name of its folder, and whether the copy could be used.
    func duplicateCurrent() throws -> (key: String, selected: Bool) {
        guard let directory = userDirectory else { throw ThemeLibraryError.noUserDirectory }
        let copy = try library.duplicate(key, into: directory)
        reload()
        return (copy, select(copy))
    }

    /// The user's themes folder, created when missing so it can be opened in the Finder.
    func createUserDirectory() throws -> URL {
        guard let directory = userDirectory else { throw ThemeLibraryError.noUserDirectory }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
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
        let images: [(String, ThemeAsset?)] = [
            ("background", spec.images.background?.file), ("divider", spec.images.divider?.file),
            ("frame", spec.images.frame?.file), ("band", spec.images.band?.file),
        ]
        for case let (name, asset?) in images
        where FileManager.default.fileExists(atPath: asset.url.path) && theme.image(asset) == nil {
            // A missing file already warned when the theme was read; one that is there but is not an image warns here.
            warnings.append("images.\(name).file: no se pudo cargar \(asset.path)")
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
