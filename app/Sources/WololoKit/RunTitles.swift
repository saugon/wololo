import Foundation

/// The titles the person gave runs in the app, by run id, kept in `UserDefaults`: they replace the run's own on every
/// card, row and header, and going back drops them. With `persists: false` (snapshots) nothing is written.
public struct RunTitles {
    public static let key = "runs.customTitles"

    private let defaults: UserDefaults
    public let persists: Bool

    public init(defaults: UserDefaults, persists: Bool) {
        self.defaults = defaults
        self.persists = persists
    }

    public var all: [String: String] {
        (defaults.dictionary(forKey: Self.key) as? [String: String]) ?? [:]
    }

    /// Saves `title` for the run; nil, a blank one or the run's own title drops the custom one.
    public func set(_ title: String?, for id: String, original: String) {
        guard persists else { return }
        var titles = all
        let trimmed = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if trimmed.isEmpty || trimmed == original {
            titles[id] = nil
        } else {
            titles[id] = trimmed
        }
        if titles.isEmpty {
            defaults.removeObject(forKey: Self.key)
        } else {
            defaults.set(titles, forKey: Self.key)
        }
    }
}
