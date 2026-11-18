import AppKit
import WololoKit

/// "Arrancar run": runs `claude '<command>'` in a new window of the first terminal installed (iTerm2, Ghostty,
/// Terminal), in `folder`, told through AppleScript, which needs the Automation permission. When that fails (permission
/// denied, a terminal without support, no terminal), the terminal opens in the folder as "Ir a la terminal" does, the
/// line goes to the pasteboard and a toast says to paste it, and why when the permission was denied.
@MainActor
enum RunLauncher {
    private enum ScriptResult {
        case ran
        /// macOS denied the Automation permission (-1743, -1744).
        case denied
        case failed
    }

    /// Launches being started, by folder and command, so a second click while the first runs does not open twice.
    private static var pending: Set<String> = []

    static func launch(command: String, folder: String, state: AppState) {
        let key = folder + "\n" + command
        guard !pending.contains(key) else { return }
        pending.insert(key)
        Task { @MainActor in
            defer { pending.remove(key) }
            let (result, terminal) = await launchDirectly(command: command, folder: folder)
            if result == .ran { return }
            let denied = result == .denied ? terminal : nil
            await fallBack(command: command, folder: folder, denied: denied, state: state)
        }
    }

    /// What became of telling the first terminal installed to run the command, and that terminal's name. A folder
    /// that is not there is left to the fallback, which says so.
    private static func launchDirectly(command: String, folder: String) async -> (ScriptResult, String?) {
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: folder, isDirectory: &isDirectory), isDirectory.boolValue,
              let terminal = TerminalAction.terminals.first(where: {
                  NSWorkspace.shared.urlForApplication(withBundleIdentifier: $0.id) != nil
              })
        else { return (.failed, nil) }
        let source: String
        switch terminal.id {
        case TerminalFocuser.iTermID: source = RunLaunch.iTermScript(folder: folder, command: command)
        case TerminalFocuser.ghosttyID: source = RunLaunch.ghosttyScript(folder: folder, command: command)
        default: source = RunLaunch.terminalScript(folder: folder, command: command)
        }
        return (await runScript(source), terminal.name)
    }

    /// On `TerminalFocuser`'s queue, so no two scripts ever run at once. A script that does not compile (a Ghostty
    /// without the dictionary) or fails in any other way is `.failed`.
    private static func runScript(_ source: String) async -> ScriptResult {
        await withCheckedContinuation { continuation in
            TerminalFocuser.queue.async {
                guard let script = NSAppleScript(source: source) else { return continuation.resume(returning: .failed) }
                var error: NSDictionary?
                script.executeAndReturnError(&error)
                guard let error else { return continuation.resume(returning: .ran) }
                switch error[NSAppleScript.errorNumber] as? Int ?? 0 {
                case -1743, -1744: continuation.resume(returning: .denied)
                default: continuation.resume(returning: .failed)
                }
            }
        }
    }

    /// The pasteboard and the toast come first: once the terminal opens it covers the window.
    private static func fallBack(command: String, folder: String, denied: String?, state: AppState) async {
        let target = TerminalAction.TerminalTarget(cwd: folder, projectPath: folder)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(RunLaunch.shellLine(command: command), forType: .string)
        var notes = target.notes
        if let denied { notes.append(TerminalAction.permissionText(denied)) }
        notes.append("Copié el comando: pegalo en la terminal")
        state.showToast(notes, holdsUntilActive: true)
        if let failure = await target.open() {
            state.showToast(notes + [failure], holdsUntilActive: true)
        }
    }
}
