import AppKit
import WololoKit

/// "Descartar" in the detail's header: after a confirmation, cancels a run no session holds anymore (see `RunDiscard`),
/// so it leaves the board without opening a terminal to resume it and cancel it there.
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
        do {
            try RunDiscard.discard(runDir: runDir)
        } catch {
            let failed = NSAlert()
            failed.alertStyle = .warning
            failed.messageText = "No se pudo descartar el run"
            failed.informativeText = error as? RunDiscard.Failure == .notDiscardable
                ? "Una sesión lo retomó mientras tanto: seguilo desde su terminal."
                : "No se pudo escribir en \(runDir.path)."
            failed.runModal()
        }
        model.refresh()
    }
}
