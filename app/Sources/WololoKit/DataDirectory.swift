import Foundation

/// Where wololo keeps its store: `WOLOLO_DATA_DIR`, then the app's own setting, then `~/.claude/wololo`.
public struct DataDirectory: Equatable, Sendable {
    public enum Origin: String, Sendable {
        case environment
        case setting
        case standard
    }

    public static let environmentKey = "WOLOLO_DATA_DIR"
    public static let settingKey = "dataDirectory"

    public let url: URL
    public let origin: Origin

    public var runsURL: URL { url.appendingPathComponent("runs", isDirectory: true) }

    public init(url: URL, origin: Origin = .setting) {
        self.url = url.standardizedFileURL
        self.origin = origin
    }

    public static func standard(home: URL = FileManager.default.homeDirectoryForCurrentUser) -> URL {
        home.appendingPathComponent(".claude/wololo", isDirectory: true)
    }

    /// `setting` is the app's saved value under `settingKey`; the app reads it, so the store never touches defaults.
    public static func resolve(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        setting: String?,
        home: URL = FileManager.default.homeDirectoryForCurrentUser
    ) -> DataDirectory {
        if let path = usable(environment[environmentKey]) {
            return DataDirectory(url: expand(path, home: home), origin: .environment)
        }
        if let path = usable(setting) {
            return DataDirectory(url: expand(path, home: home), origin: .setting)
        }
        return DataDirectory(url: standard(home: home), origin: .standard)
    }

    private static func usable(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else { return nil }
        return trimmed
    }

    private static func expand(_ path: String, home: URL) -> URL {
        if path == "~" { return home }
        if path.hasPrefix("~/") { return home.appendingPathComponent(String(path.dropFirst(2)), isDirectory: true) }
        return URL(fileURLWithPath: path, isDirectory: true)
    }
}
