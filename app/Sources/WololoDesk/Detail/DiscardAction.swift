import AppKit
import WololoKit

/// "Descartar" in the detail's header: after a confirmation, cancels a run no session holds anymore (see `RunDiscard`),
/// so it leaves the board without opening a terminal to resume it and cancel it there. "Marcar terminado" does the
/// same for a run in review, finishing it as done.
enum DiscardAction {
    @MainActor
    static func confirm(_ run: Run, runDir: URL, model: RunsModel) {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "¿Descartar \(run.displayTitle)?"
        alert.informativeText = """
        El run queda cancelado y sale del tablero. Su worktree, su rama y sus archivos quedan donde están.

        Para seguirlo en vez de descartarlo, usá Ir a la terminal y /wololo resume.
        """
        alert.addButton(withTitle: "Descartar")
        alert.addButton(withTitle: "Cancelar")
        alert.buttons.first?.hasDestructiveAction = true
        NSApp.activate()
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        write(failure: "No se pudo descartar el run", runDir: runDir, model: model) {
            try RunDiscard.discard(runDir: runDir)
        }
    }

    @MainActor
    static func confirmDone(_ run: Run, runDir: URL, model: RunsModel) {
        let alert = NSAlert()
        alert.messageText = "¿Marcar terminado \(run.displayTitle)?"
        alert.informativeText = """
        El run queda terminado y deja de esperar la revisión de su PR. El PR, su worktree y su rama quedan como están.

        Para seguir atendiendo la revisión, usá Ir a la terminal y /wololo resume.
        """
        alert.addButton(withTitle: "Marcar terminado")
        alert.addButton(withTitle: "Cancelar")
        NSApp.activate()
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        write(failure: "No se pudo marcar terminado el run", runDir: runDir, model: model) {
            try RunDiscard.markDone(runDir: runDir)
        }
    }

    /// Runs the write, and tells why when it fails: a session that took the run back wins over the app.
    @MainActor
    private static func write(failure: String, runDir: URL, model: RunsModel, _ body: () throws -> Void) {
        do {
            try body()
        } catch {
            let failed = NSAlert()
            failed.alertStyle = .warning
            failed.messageText = failure
            failed.informativeText = error as? RunDiscard.Failure == .notDiscardable
                ? "Una sesión lo retomó mientras tanto: seguilo desde su terminal."
                : "No se pudo escribir en \(runDir.path)."
            failed.runModal()
        }
        model.refresh()
    }
}
