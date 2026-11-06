import Foundation

/// A theme the app can offer: a built-in one or a folder of the user's themes folder. One with an `error` is listed
/// but cannot be chosen.
public struct ThemeEntry: Equatable, Sendable, Identifiable {
    /// The folder's name, also what Settings saves.
    public let key: String
    public let name: String
    public let isBuiltIn: Bool
    public let directory: URL
    public let error: String?
    /// What it asks for that is not there, such as a missing font or image file. It still works.
    public let warnings: [String]

    /// A user folder may share its key with a built-in theme, so the folder tells them apart.
    public var id: String { directory.path }

    public var isUsable: Bool { error == nil }
}

public enum ThemeLibraryError: Error, Equatable, Sendable, CustomStringConvertible {
    case notFound(String)
    case unusable(key: String, reason: String)
    case noUserDirectory
    case copyFailed(String)

    public var description: String {
        switch self {
        case .notFound(let key): return "no hay un tema \"\(key)\""
        case .unusable(let key, let reason): return "el tema \"\(key)\" no se puede usar: \(reason)"
        case .noUserDirectory: return "no hay carpeta de temas propios"
        case .copyFailed(let detail): return "no se pudo duplicar el tema: \(detail)"
        }
    }
}

/// The themes found at one moment: the built-in folders, in their order, then the user's folders sorted by name.
/// Every theme falls back to `ThemeSpec.actual` for what it does not set. To see changes on disk, build a new one.
public struct ThemeLibrary: Sendable {
    /// Keys a user folder cannot take, so a saved choice always means the same theme.
    public static let reservedKeys: Set<String> = ["actual", "aoe"]
    public static let fileName = "theme.json"

    public let userDirectory: URL?
    public let entries: [ThemeEntry]
    private let specs: [String: ThemeSpec]

    public init(builtIns: [URL], userDirectory: URL?) {
        self.userDirectory = userDirectory
        var entries: [ThemeEntry] = []
        var specs: [String: ThemeSpec] = [:]
        for folder in builtIns {
            let (entry, spec) = Self.load(folder, isBuiltIn: true)
            entries.append(entry)
            if let spec, specs[entry.key] == nil { specs[entry.key] = spec }
        }
        let reserved = Self.reservedKeys.union(builtIns.map { $0.lastPathComponent.lowercased() })
        for folder in userDirectory.map(Self.folders(in:)) ?? [] {
            if reserved.contains(folder.lastPathComponent.lowercased()) {
                entries.append(ThemeEntry(key: folder.lastPathComponent, name: folder.lastPathComponent, isBuiltIn: false,
                                          directory: folder, error: "nombre reservado", warnings: []))
                continue
            }
            let (entry, spec) = Self.load(folder, isBuiltIn: false)
            entries.append(entry)
            if let spec, specs[entry.key] == nil { specs[entry.key] = spec }
        }
        self.entries = entries
        self.specs = specs
    }

    /// The first entry with this key: a built-in one before a user folder of the same name.
    public func entry(_ key: String) -> ThemeEntry? {
        entries.first { $0.key == key }
    }

    /// The complete theme, with its key as `id`.
    public func resolve(_ key: String) throws -> ResolvedTheme {
        guard let entry = entry(key) else { throw ThemeLibraryError.notFound(key) }
        if let error = entry.error { throw ThemeLibraryError.unusable(key: key, reason: error) }
        guard let spec = specs[key] else { throw ThemeLibraryError.notFound(key) }
        return ResolvedTheme(spec: spec, warnings: entry.warnings)
    }

    /// Copies the theme's folder, assets included, into `directory` as `<key>-copia` (or `-copia-2`, …) and names
    /// the copy "<name> (copia)". Creates `directory` when missing. Returns the new key.
    @discardableResult
    public func duplicate(_ key: String, into directory: URL) throws -> String {
        guard let entry = entry(key) else { throw ThemeLibraryError.notFound(key) }
        if let error = entry.error { throw ThemeLibraryError.unusable(key: key, reason: error) }
        let manager = FileManager.default
        do {
            try manager.createDirectory(at: directory, withIntermediateDirectories: true)
        } catch {
            throw ThemeLibraryError.copyFailed(error.localizedDescription)
        }
        let newKey = Self.freeKey(for: key, in: directory)
        let destination = directory.appendingPathComponent(newKey)
        do {
            try manager.copyItem(at: entry.directory, to: destination)
            let file = destination.appendingPathComponent(Self.fileName)
            guard var object = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any] else {
                throw ThemeLibraryError.copyFailed("\(Self.fileName) no es un objeto JSON")
            }
            object["id"] = newKey
            object["name"] = "\(entry.name) (copia)"
            let data = try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
            // Atomic, so a `theme.json` that is a symlink is replaced rather than written through.
            try data.write(to: file, options: .atomic)
        } catch {
            try? manager.removeItem(at: destination)
            if let error = error as? ThemeLibraryError { throw error }
            throw ThemeLibraryError.copyFailed(error.localizedDescription)
        }
        return newKey
    }

    // MARK: Loading

    private static func load(_ folder: URL, isBuiltIn: Bool) -> (ThemeEntry, ThemeSpec?) {
        let key = folder.lastPathComponent
        func failed(_ error: String) -> (ThemeEntry, ThemeSpec?) {
            (ThemeEntry(key: key, name: key, isBuiltIn: isBuiltIn, directory: folder, error: error, warnings: []), nil)
        }
        let file = folder.appendingPathComponent(fileName)
        guard FileManager.default.fileExists(atPath: file.path) else { return failed("falta \(fileName)") }
        do {
            let data = try Data(contentsOf: file)
            let resolved = try ThemeFile.decode(data).resolve(over: .actual, directory: folder)
            var spec = resolved.spec
            spec.id = key
            let entry = ThemeEntry(key: key, name: spec.name, isBuiltIn: isBuiltIn, directory: folder, error: nil,
                                   warnings: resolved.warnings)
            return (entry, spec)
        } catch let error as ThemeError {
            return failed(error.description)
        } catch {
            return failed("no se pudo leer \(fileName): \(error.localizedDescription)")
        }
    }

    /// The visible folders of the user's themes folder, sorted by name. Files and hidden folders are not themes.
    private static func folders(in directory: URL) -> [URL] {
        let manager = FileManager.default
        guard let contents = try? manager.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil,
                                                              options: [.skipsHiddenFiles]) else { return [] }
        return contents
            .filter { url in
                var isDirectory: ObjCBool = false
                return manager.fileExists(atPath: url.path, isDirectory: &isDirectory) && isDirectory.boolValue
            }
            .sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending }
    }

    private static func freeKey(for key: String, in directory: URL) -> String {
        let base = "\(key)-copia"
        var candidate = base
        var number = 2
        while reservedKeys.contains(candidate.lowercased())
                || FileManager.default.fileExists(atPath: directory.appendingPathComponent(candidate).path) {
            candidate = "\(base)-\(number)"
            number += 1
        }
        return candidate
    }
}
