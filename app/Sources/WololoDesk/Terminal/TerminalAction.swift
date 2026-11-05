import AppKit
import WololoKit

/// "Ir a la terminal", from the detail's header and the widget's rows: a live run's terminal comes to the front; when
/// it is not found, or the session is gone or over, a terminal opens in the run's directory and, unless the run
/// finished, `/wololo resume <id>` goes to the pasteboard. What happened that the person cannot see shows in a toast.
@MainActor
enum TerminalAction {
    /// The terminals a new window opens in, the first one installed.
    private static let terminals: [(id: String, name: String)] = [
        (TerminalFocuser.iTermID, "iTerm2"),
        (TerminalFocuser.ghosttyID, "Ghostty"),
        ("com.apple.Terminal", "Terminal"),
    ]

    /// Runs whose terminal is being looked for, so a second click waits for the first instead of opening twice.
    private static var pending: Set<String> = []
    /// Terminals whose denied permission was already explained with an alert; afterwards a toast reminds it.
    private static var explained: Set<String> = []

    static func go(to run: Run, now: TimeInterval, state: AppState) {
        guard !pending.contains(run.id) else { return }
        pending.insert(run.id)
        let plan = TerminalPlan(run, now: now)
        Task { @MainActor in
            defer { pending.remove(run.id) }
            var notes: [String] = []
            var focused = false
            if plan.triesFocus {
                // An app can only hand the focus to another while it is active itself (the widget does not activate it).
                NSApp.activate()
                switch await TerminalFocuser.focus(cwd: run.owner.cwd, projectPath: run.project.path) {
                case .found:
                    focused = true
                case .notFound:
                    break
                case .denied(let terminal):
                    if !explainDenied(terminal) { notes.append(permissionText(terminal)) }
                }
            }
            let steps = plan.steps(focused: focused)
            guard steps.contains(.open) else {
                state.showToast(notes)
                return
            }
            // The pasteboard and the toast come first: once the terminal opens it covers the window.
            let target = TerminalTarget(cwd: run.owner.cwd, projectPath: run.project.path)
            notes += target.notes
            if steps.contains(.copyResume), let command = plan.resumeCommand {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(command, forType: .string)
                notes.append("Copié \(command): pegalo en la terminal")
            }
            state.showToast(notes, holdsUntilActive: true)
            if let failure = await target.open() {
                state.showToast(notes + [failure], holdsUntilActive: true)
            }
        }
    }

    /// Where a new terminal window opens and with which terminal: the session's directory, or the project's, or
    /// home, in the first terminal installed. No AppleScript: the terminal opens the folder it is given.
    @MainActor
    struct TerminalTarget {
        let directory: TerminalDirectory
        let terminal: (url: URL, name: String)?
        let cwd: String

        init(cwd: String, projectPath: String) {
            self.cwd = cwd
            let home = FileManager.default.homeDirectoryForCurrentUser.path
            directory = TerminalDirectory(cwd: cwd, projectPath: projectPath, home: home) { path in
                var isDirectory: ObjCBool = false
                return FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory) && isDirectory.boolValue
            }
            terminal = terminals.lazy.compactMap { terminal in
                NSWorkspace.shared.urlForApplication(withBundleIdentifier: terminal.id).map { (url: $0, name: terminal.name) }
            }.first
        }

        /// What to tell the person before opening: the folder used instead of the session's, or no terminal at all.
        var notes: [String] {
            guard terminal != nil else { return ["No encontré iTerm2, Ghostty ni Terminal para abrir"] }
            switch directory {
            case .cwd: return []
            case .project(let path): return ["\(missing(cwd)): abrí \(tilde(path))"]
            case .home: return ["\(missing(cwd)): abrí tu carpeta personal"]
            }
        }

        /// Opens the window; returns what went wrong, if anything.
        func open() async -> String? {
            guard let terminal else { return nil }
            let url = URL(fileURLWithPath: directory.path, isDirectory: true)
            do {
                _ = try await NSWorkspace.shared.open([url], withApplicationAt: terminal.url, configuration: NSWorkspace.OpenConfiguration())
                return nil
            } catch {
                return "No pude abrir \(terminal.name): \(error.localizedDescription)"
            }
        }
    }

    private static func missing(_ cwd: String) -> String {
        cwd.isEmpty ? "El run no dice en qué carpeta corre" : "Ya no existe \(tilde(cwd))"
    }

    private static func tilde(_ path: String) -> String {
        (path as NSString).abbreviatingWithTildeInPath
    }

    private static func permissionText(_ terminal: String) -> String {
        "Wololo Desk necesita permiso de Automatización para \(terminal): Ajustes del Sistema › Privacidad y seguridad › Automatización"
    }

    /// The first time a terminal refuses, an alert explains it and offers the settings pane; returns false when it
    /// was already explained, for a toast to remind it instead.
    private static func explainDenied(_ terminal: String) -> Bool {
        guard !explained.contains(terminal) else { return false }
        explained.insert(terminal)
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "Wololo Desk no puede traer \(terminal) al frente"
        alert.informativeText = """
        \(permissionText(terminal)), y activá \(terminal) debajo de Wololo Desk.

        Mientras tanto se abre una terminal nueva en la carpeta del run.
        """
        alert.addButton(withTitle: "Abrir Ajustes")
        alert.addButton(withTitle: "Cerrar")
        NSApp.activate()
        if alert.runModal() == .alertFirstButtonReturn,
           let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation") {
            NSWorkspace.shared.open(url)
        }
        return true
    }
}
