import Foundation

/// Where "Arrancar run" runs `claude`: a folder, or why the button is disabled.
public enum LaunchFolder: Equatable, Sendable {
    case folder(String)
    case disabled(reason: String)
}

/// What "Arrancar run" launches from a goal's node: the `/wololo` command, the folder it runs in, and how each terminal
/// is told to open a new window there running `claude '<command>'`.
public enum RunLaunch {
    /// `/wololo #<n>` for an issue of the project's repo (or a bare number with no repo to tell it apart),
    /// `/wololo <issue url>` for another repo's, and `/wololo <title>. <description>` on one line for a node without
    /// an issue: only the parts written, and no period after a title that already ends one. Text in the issue field
    /// that names no issue counts as no issue.
    public static func command(for node: GoalNode, projectRepo: String?) -> String {
        if let ref = issue(of: node, projectRepo: projectRepo) {
            if let url = ref.url, !ref.isIn(repo: projectRepo) { return "/wololo \(url)" }
            return "/wololo #\(ref.number)"
        }
        let title = oneLine(node.title)
        let description = oneLine(node.description)
        guard !title.isEmpty, !description.isEmpty else { return oneLine("/wololo \(title)\(description)") }
        let separator = [".", "!", "?"].contains(where: title.hasSuffix) ? " " : ". "
        return "/wololo \(title)\(separator)\(description)"
    }

    /// The project's folder, or for another repo's issue the folder of the project with that repo. A node with no
    /// issue, title or description has nothing to launch, and neither has one whose issue field names no issue.
    public static func folder(for node: GoalNode, project: PlanningProject, projects: [PlanningProject]) -> LaunchFolder {
        let projectRepo = defaultRepo(for: project)
        let ref = issue(of: node, projectRepo: projectRepo)
        if let ref, let repo = ref.repo, !ref.isIn(repo: projectRepo) {
            guard let other = WololoKit.project(matchingKey: PlanningProject.key(forRepo: repo), in: projects),
                  !other.path.isEmpty
            else { return .disabled(reason: "Agregá un proyecto para \(repo)") }
            return .folder(other.path)
        }
        if ref == nil, oneLine(node.title).isEmpty, oneLine(node.description).isEmpty {
            return .disabled(reason: "Escribí un título o vinculá un issue")
        }
        if ref == nil, !oneLine(node.issue ?? "").isEmpty { return .disabled(reason: "No reconozco ese issue") }
        guard !project.path.isEmpty else { return .disabled(reason: "Elegí una carpeta para \(project.name)") }
        return .folder(project.path)
    }

    /// `text` as one shell word: single-quoted, each `'` closed, escaped and reopened (`'\''`).
    public static func shellQuote(_ text: String) -> String {
        "'" + text.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    /// `claude '<command>'`, what goes to the pasteboard when the terminal could not be told to run it.
    public static func shellLine(command: String) -> String {
        "claude \(shellQuote(command))"
    }

    /// `cd '<folder>' && claude '<command>'`, what a new iTerm2 or Terminal window runs.
    public static func cdLine(folder: String, command: String) -> String {
        "cd \(shellQuote(folder)) && \(shellLine(command: command))"
    }

    /// Types the `cd … && claude …` line in a new iTerm2 window with the default profile. When iTerm2 was not running
    /// it opens a window of its own as it starts: the line goes there instead of in a second one.
    public static func iTermScript(folder: String, command: String) -> String {
        let line = appleScriptString(cdLine(folder: folder, command: command))
        return """
        set wasRunning to application "iTerm2" is running
        tell application "iTerm2"
            activate
            if not wasRunning then
                repeat 50 times
                    if (count of windows) > 0 then exit repeat
                    delay 0.1
                end repeat
            end if
            if not wasRunning and (count of windows) > 0 then
                set w to current window
            else
                set w to (create window with default profile)
            end if
            tell current session of w to write text \(line)
        end tell
        """
    }

    /// Runs the `cd … && claude …` line in a new Terminal window. When Terminal was not running it opens a window of
    /// its own as it starts: the line runs there instead of in a second one.
    public static func terminalScript(folder: String, command: String) -> String {
        let line = appleScriptString(cdLine(folder: folder, command: command))
        return """
        set wasRunning to application "Terminal" is running
        tell application "Terminal"
            activate
            if not wasRunning then
                repeat 50 times
                    if (count of windows) > 0 then exit repeat
                    delay 0.1
                end repeat
            end if
            if not wasRunning and (count of windows) > 0 then
                do script \(line) in window 1
            else
                do script \(line)
            end if
        end tell
        """
    }

    /// Opens a new Ghostty window in `folder` and types `claude '<command>'` and a return in it, through the
    /// dictionary Ghostty 1.4 ships (`Ghostty.sdef`); an older Ghostty fails to compile it and falls back.
    public static func ghosttyScript(folder: String, command: String) -> String {
        """
        tell application "Ghostty"
            set c to new surface configuration
            set initial working directory of c to \(appleScriptString(folder))
            set initial input of c to \(appleScriptString(shellLine(command: command) + "\n"))
            new window with configuration c
            activate
        end tell
        """
    }

    private static func issue(of node: GoalNode, projectRepo: String?) -> IssueRef? {
        guard let raw = node.issue else { return nil }
        return IssueRef.parse(raw, defaultRepo: projectRepo)
    }

    /// Every run of whitespace, newlines included, as one space, and none at the ends.
    private static func oneLine(_ text: String) -> String {
        text.split(whereSeparator: { $0.isWhitespace || $0.isNewline }).joined(separator: " ")
    }
}
