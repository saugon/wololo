import AppKit
import WololoKit

/// Brings to the front the terminal a session runs in: every running iTerm2 and Ghostty lists its sessions, and
/// `matchPane` picks one, by the tty of the session's Claude Code process when it is found (`sessionTTY`), else by its
/// directory as Megadesk's `focusByCwd` (the exact directory first, in either terminal), and that one is selected. Only terminals already running are asked, through AppleScript, which needs
/// the Automation permission for each: macOS asks for it with `NSAppleEventsUsageDescription` (`Resources/Info.plist`),
/// and denies the scripts without asking when that key, or under the hardened runtime the
/// `com.apple.security.automation.apple-events` entitlement, is missing.
enum TerminalFocuser {
    enum FocusResult: Equatable, Sendable {
        case found
        case notFound
        /// macOS denied the Automation permission for this terminal ("iTerm2", "Ghostty").
        case denied(String)
    }

    /// Asking iTerm2 for every session's variables is slow, so the scripts run here, off the main thread, one at a
    /// time (`NSAppleScript` is not thread-safe). `RunLauncher`'s run here too, never beside these.
    static let queue = DispatchQueue(label: "com.saugon.wololo-desk.terminal-focuser")

    static let iTermID = "com.googlecode.iterm2"
    static let ghosttyID = "com.mitchellh.ghostty"

    static func bundleID(_ app: TerminalApp) -> String {
        switch app {
        case .iTerm2: return iTermID
        case .ghostty: return ghosttyID
        }
    }

    /// `.denied` only when no session was found and a terminal refused a script.
    static func focus(sessionID: String, cwd: String, projectPath: String) async -> FocusResult {
        guard !cwd.isEmpty || !sessionID.isEmpty else { return .notFound }
        let (result, app) = await withCheckedContinuation { continuation in
            queue.async {
                let tty = sessionTTY(sessionID)
                continuation.resume(returning: search(cwd: cwd, projectPath: projectPath, tty: tty))
            }
        }
        if result == .found && app == .ghostty { await releaseKeyWindow() }
        return result
    }

    /// The result, and the terminal brought to the front.
    private static func search(cwd: String, projectPath: String, tty: String) -> (FocusResult, TerminalApp?) {
        var listings: [TerminalListing] = []
        var denied: TerminalApp?
        for app in TerminalApp.allCases where isRunning(app) {
            switch run(listScript(app), in: app) {
            case .value(let raw): listings.append(TerminalListing(app: app, panes: parsePanes(raw)))
            case .denied: denied = denied ?? app
            case .flag, .failed: break
            }
        }
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let notFound = denied.map { FocusResult.denied($0.rawValue) } ?? .notFound
        guard let match = matchPane(cwd: cwd, projectPath: projectPath, home: home, tty: tty, in: listings) else {
            return (notFound, nil)
        }
        // While a window comes to the front, Ghostty can list its windows half-updated and the script fails midway:
        // one more try, a moment later, before taking the session as not found and opening a terminal beside it.
        var outcome = run(focusScript(match), in: match.app)
        if case .failed = outcome {
            Thread.sleep(forTimeInterval: 0.3)
            outcome = run(focusScript(match), in: match.app)
        }
        switch outcome {
        case .flag(true): return (.found, match.app)
        case .denied: return (.denied(match.app.rawValue), nil)
        case .value, .flag(false), .failed: return (notFound, nil)
        }
    }

    /// The tty of the Claude Code process running the session, or "" when it is not found: its pid from
    /// `~/.claude/sessions`, then `ps`, which also says whether that pid is still a `claude` process.
    private static func sessionTTY(_ sessionID: String) -> String {
        let sessions = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".claude/sessions")
        guard let pid = sessionPID(sessionID, in: sessions) else { return "" }
        let ps = Process()
        ps.executableURL = URL(fileURLWithPath: "/bin/ps")
        ps.arguments = ["-o", "tty=,comm=", "-p", String(pid)]
        let out = Pipe()
        ps.standardOutput = out
        ps.standardError = FileHandle.nullDevice
        guard (try? ps.run()) != nil else { return "" }
        let data = out.fileHandleForReading.readDataToEndOfFile()
        ps.waitUntilExit()
        let columns = String(decoding: data, as: UTF8.self).split(whereSeparator: \.isWhitespace)
        guard columns.count >= 2, (columns.last.map { ($0 as NSString).lastPathComponent } ?? "") == "claude" else { return "" }
        return ttyPath(String(columns[0]))
    }

    private static func isRunning(_ app: TerminalApp) -> Bool {
        !NSRunningApplication.runningApplications(withBundleIdentifier: bundleID(app)).isEmpty
    }

    // MARK: Scripts

    /// One `id <tab> job <tab> path <tab> tty` line per session: iTerm2's tty, foreground job, directory and tty again;
    /// Ghostty's terminal id, working directory and tty (it does not report the job).
    private static func listScript(_ app: TerminalApp) -> String {
        switch app {
        case .iTerm2:
            return """
            tell application "iTerm2"
                set d to (character id 9)
                set out to ""
                repeat with w in windows
                    repeat with t in tabs of w
                        repeat with s in sessions of t
                            set p to ""
                            try
                                set p to (variable s named "path")
                            end try
                            set jn to ""
                            try
                                set jn to (variable s named "jobName")
                            end try
                            set out to out & (tty of s) & d & jn & d & p & d & (tty of s) & linefeed
                        end repeat
                    end repeat
                end repeat
                return out
            end tell
            """
        case .ghostty:
            return """
            tell application "Ghostty"
                set d to (character id 9)
                set out to ""
                repeat with w in windows
                    repeat with t in tabs of w
                        repeat with term in terminals of t
                            set p to ""
                            try
                                set p to (working directory of term)
                            end try
                            set y to ""
                            try
                                set y to (tty of term)
                            end try
                            set out to out & ((id of term) as text) & d & d & p & d & y & linefeed
                        end repeat
                    end repeat
                end repeat
                return out
            end tell
            """
        }
    }

    private static func focusScript(_ match: PaneMatch) -> String {
        let id = appleScriptString(match.pane.id)
        switch match.app {
        case .iTerm2:
            return """
            tell application "iTerm2"
                repeat with w in windows
                    repeat with t in tabs of w
                        repeat with s in sessions of t
                            if (tty of s) is \(id) then
                                tell t to select
                                tell s to select
                                tell w to select
                                activate
                                return true
                            end if
                        end repeat
                    end repeat
                end repeat
                return false
            end tell
            """
        case .ghostty:
            // `activate window` brings that window to the front: the app's own `activate` brings back the window that
            // was last active instead, whichever holds the terminal.
            return """
            tell application "Ghostty"
                repeat with w in windows
                    repeat with t in tabs of w
                        repeat with term in terminals of t
                            if ((id of term) as text) is \(id) then
                                activate window w
                                select tab t
                                focus term
                                return true
                            end if
                        end repeat
                    end repeat
                end repeat
                return false
            end tell
            """
        }
    }

    /// A click from a non-activating panel can leave it holding the keyboard: give up the key window. Ghostty is not
    /// activated from here: activating the app brings back its last active window, not the one the script raised.
    @MainActor
    private static func releaseKeyWindow() {
        NSApp.keyWindow?.resignKey()
    }

    // MARK: AppleScript

    private enum Outcome {
        case value(String)
        case flag(Bool)
        case denied
        case failed
    }

    /// -1743 and -1744: the Automation permission is denied or would need asking. -600 says the terminal is not
    /// running: if it quit meanwhile it was simply not found, but while it still runs it is how a denied permission
    /// sometimes shows. Other errors (a window closing mid-script, a terminal without scripting) mean not found.
    private static func run(_ source: String, in app: TerminalApp) -> Outcome {
        guard let script = NSAppleScript(source: source) else { return .failed }
        var error: NSDictionary?
        let descriptor = script.executeAndReturnError(&error)
        if let error {
            switch error[NSAppleScript.errorNumber] as? Int ?? 0 {
            case -1743, -1744: return .denied
            case -600: return isRunning(app) ? .denied : .failed
            default: return .failed
            }
        }
        switch descriptor.descriptorType {
        case typeTrue: return .flag(true)
        case typeFalse: return .flag(false)
        case typeBoolean: return .flag(descriptor.booleanValue)
        default: return .value(descriptor.stringValue ?? "")
        }
    }
}
