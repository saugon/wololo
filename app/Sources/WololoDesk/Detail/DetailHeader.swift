import AppKit
import SwiftUI
import WololoKit

/// The top of the detail: back, terminal and folder buttons; the title; repo, branch, source, mode, risk and age;
/// and the large progress bar.
struct DetailHeader: View {
    let run: Run
    let now: TimeInterval
    let runDir: URL
    let back: () -> Void
    let goToTerminal: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            actions
            VStack(alignment: .leading, spacing: 8) {
                Text(run.displayTitle)
                    .font(.system(size: 24, weight: .bold))
                    .tracking(-0.36)
                    .foregroundStyle(Theme.text)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                    .accessibilityAddTraits(.isHeader)
                facts
                ProgressBarView(
                    progress: RunProgress(run, now: now),
                    height: 6,
                    captionFont: .system(size: 13),
                    spacing: 14
                )
                .frame(maxWidth: 720)
                .padding(.top, 6)
            }
        }
    }

    private var actions: some View {
        HStack(spacing: 12) {
            Button(action: back) {
                Label("Volver al tablero", systemImage: "arrow.left")
            }
            .buttonStyle(DetailButtonStyle())
            .help("Volver al tablero (Esc)")
            Spacer(minLength: 0)
            Button(action: goToTerminal) {
                Label("Ir a la terminal", systemImage: "terminal")
            }
            .buttonStyle(DetailButtonStyle(isPrimary: true))
            .help(TerminalPlan(run, now: now).triesFocus
                ? "Traer al frente la terminal de la sesión"
                : "Abrir una terminal en la carpeta del run")
            Button(action: openFolder) {
                Label("Abrir carpeta del run", systemImage: "folder")
            }
            .buttonStyle(DetailButtonStyle())
            .help(runDir.path)
        }
    }

    private func openFolder() {
        NSWorkspace.shared.open(runDir)
    }

    /// The facts read in the run's language, like the labels they carry.
    private var es: Bool { run.lang == .es }

    private var facts: some View {
        FlowLayout(spacing: 16, lineSpacing: 8) {
            Text(run.project.display)
                .font(.system(size: 12.5).monospaced())
                .help(run.project.path)
            if let branch = run.project.branch, !branch.isEmpty {
                Text(branch)
                    .font(.system(size: 12.5).monospaced())
                    .help(run.project.worktree ?? run.project.path)
            }
            source
            if !run.mode.isEmpty {
                Text("\(es ? "modo" : "mode") \(run.mode)")
            }
            Text("\(es ? "riesgo" : "risk") \(riskLabel(run.risk, lang: run.lang))")
            if run.createdAt > 0 {
                Text("\(es ? "arrancó" : "started") \(ago(run.createdAt, now: now, lang: run.lang))")
                    .help(Date(timeIntervalSince1970: run.createdAt).formatted(date: .abbreviated, time: .shortened))
            }
            if let finished = run.finishedAt, run.createdAt > 0 {
                Text("\(es ? "duró" : "took") \(duration(finished - run.createdAt))")
            }
        }
        .font(.system(size: 12.5))
        .foregroundStyle(Theme.muted)
        .lineLimit(1)
    }

    @ViewBuilder
    private var source: some View {
        let label = sourceLabel(run)
        if let raw = run.source.url, let url = URL(string: raw), url.scheme != nil {
            Link(destination: url) {
                Text("\(es ? "fuente" : "source") \(Text(label).foregroundStyle(Theme.blue))")
            }
            .help(raw)
        } else {
            Text("\(es ? "fuente" : "source") \(label)")
        }
    }
}
