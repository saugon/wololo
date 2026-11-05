import Foundation

/// What "Ir a la terminal" does with a run. A live session's terminal is looked for and brought to the front; when
/// none is found, or the session is gone (orphaned) or over (finished), a terminal opens in the run's directory and,
/// unless the run finished, `/wololo resume <id>` goes to the pasteboard to pick it up again there.
public struct TerminalPlan: Equatable, Sendable {
    public enum Step: Equatable, Sendable {
        case focus
        case open
        case copyResume
    }

    /// Whether the owning session can still have a terminal to bring to the front.
    public let triesFocus: Bool
    /// What to paste in the new terminal, or nil for a finished run, which has nothing to resume.
    public let resumeCommand: String?

    public init(_ run: Run, now: TimeInterval) {
        self.init(id: run.id, status: effectiveStatus(run, now: now))
    }

    public init(id: String, status: RunStatus) {
        triesFocus = !status.isTerminal && status != .orphaned
        resumeCommand = status.isTerminal ? nil : "/wololo resume \(id)"
    }

    /// The steps once the search is over: `focused` says whether it brought a terminal to the front. A run that was
    /// not looked for counts as not found.
    public func steps(focused: Bool) -> [Step] {
        if triesFocus && focused { return [.focus] }
        return resumeCommand == nil ? [.open] : [.open, .copyResume]
    }
}

/// Where the new terminal opens: the session's directory, else the project's, else home when neither exists.
public enum TerminalDirectory: Equatable, Sendable {
    case cwd(String)
    case project(String)
    case home(String)

    public var path: String {
        switch self {
        case .cwd(let path), .project(let path), .home(let path): return path
        }
    }

    /// `isDirectory` says whether a path is an existing directory; empty paths never are.
    public init(cwd: String, projectPath: String, home: String, isDirectory: (String) -> Bool) {
        if !cwd.isEmpty && isDirectory(cwd) {
            self = .cwd(cwd)
        } else if !projectPath.isEmpty && isDirectory(projectPath) {
            self = .project(projectPath)
        } else {
            self = .home(home)
        }
    }
}

/// A terminal the run's session can be looked for in, in the order they are asked.
public enum TerminalApp: String, Equatable, Sendable, CaseIterable {
    case iTerm2 = "iTerm2"
    case ghostty = "Ghostty"
}

/// An open terminal session, as the terminal reports it: its id (iTerm2's tty, Ghostty's terminal id), the job in the
/// foreground (iTerm2 only) and its directory.
public struct TerminalPane: Equatable, Sendable {
    public var id: String
    public var job: String
    public var path: String

    public init(id: String, job: String, path: String) {
        self.id = id
        self.job = job
        self.path = path
    }
}

/// The sessions one running terminal reported.
public struct TerminalListing: Equatable, Sendable {
    public var app: TerminalApp
    public var panes: [TerminalPane]

    public init(app: TerminalApp, panes: [TerminalPane]) {
        self.app = app
        self.panes = panes
    }
}

public struct PaneMatch: Equatable, Sendable {
    public var app: TerminalApp
    public var pane: TerminalPane
    /// Whether the pane is in the session's own directory, not a folder above it.
    public var isExact: Bool
}

/// The pane the session started in `cwd` most likely runs in, across every terminal's listing. `owner.cwd` is where
/// the shell was when the session started, so a pane in that exact directory wins, in any terminal, the agent's
/// `node` job first, then in listing order. Only when none is exact does a pane in a folder above `cwd` count, and only
/// one inside the project (never home or `/`), the deepest first: a shell left at `~` must not stand for every run.
/// Panes in folders below `cwd` (another worktree of the repo) never count. Paths are compared normalized.
public func matchPane(cwd: String, projectPath: String, home: String, in listings: [TerminalListing]) -> PaneMatch? {
    let target = normalizedPath(cwd)
    guard !target.isEmpty else { return nil }
    let candidates = listings.flatMap { listing in
        listing.panes.compactMap { pane -> (app: TerminalApp, pane: TerminalPane, path: String)? in
            let path = normalizedPath(pane.path)
            return path.isEmpty ? nil : (listing.app, pane, path)
        }
    }
    let exact = candidates.filter { $0.path == target }
    if let best = exact.first(where: { $0.pane.job == "node" }) ?? exact.first {
        return PaneMatch(app: best.app, pane: best.pane, isExact: true)
    }

    let project = normalizedPath(projectPath)
    guard !project.isEmpty else { return nil }
    let excluded: Set<String> = ["/", normalizedPath(home)]
    let ancestors = candidates.filter { candidate in
        !excluded.contains(candidate.path)
            && target.hasPrefix(candidate.path + "/")
            && (candidate.path == project || candidate.path.hasPrefix(project + "/"))
    }
    let best = ancestors.max { lhs, rhs in
        if lhs.path.count != rhs.path.count { return lhs.path.count < rhs.path.count }
        // Ties keep the first: only a `node` job after a shell replaces it.
        return lhs.pane.job != "node" && rhs.pane.job == "node"
    }
    return best.map { PaneMatch(app: $0.app, pane: $0.pane, isExact: false) }
}

/// A path as it can be compared: `~` expanded, `.`/`..` and symlinks resolved, no trailing slash. Empty stays empty.
public func normalizedPath(_ path: String) -> String {
    guard !path.isEmpty else { return "" }
    let standardized = ((path as NSString).expandingTildeInPath as NSString).standardizingPath
    var resolved = (standardized as NSString).resolvingSymlinksInPath
    while resolved.count > 1 && resolved.hasSuffix("/") { resolved.removeLast() }
    return resolved
}

/// Parses the tab-separated `id, job, path` lines the listing scripts return, skipping lines without an id.
public func parsePanes(_ raw: String) -> [TerminalPane] {
    raw.split(whereSeparator: \.isNewline).compactMap { line in
        let columns = line.components(separatedBy: "\t")
        guard columns.count >= 3, !columns[0].isEmpty else { return nil }
        return TerminalPane(
            id: columns[0],
            job: columns[1].trimmingCharacters(in: .whitespaces),
            path: columns[2]
        )
    }
}

/// `text` as an AppleScript string literal, quotes included, safe to put in a script's source.
public func appleScriptString(_ text: String) -> String {
    var literal = "\""
    for scalar in text.unicodeScalars {
        switch scalar {
        case "\\": literal += "\\\\"
        case "\"": literal += "\\\""
        case "\n": literal += "\\n"
        case "\r": literal += "\\r"
        case "\t": literal += "\\t"
        default: literal.unicodeScalars.append(scalar)
        }
    }
    return literal + "\""
}
