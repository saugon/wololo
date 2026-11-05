import SwiftUI
import WololoKit

/// No runs to show: says where the app reads from and how a run starts.
struct EmptyStateView: View {
    let directory: DataDirectory
    let isMissing: Bool
    let openSettings: () -> Void

    var body: some View {
        let runs = (directory.runsURL.path as NSString).abbreviatingWithTildeInPath
        VStack(alignment: .leading, spacing: 18) {
            BoardGlyph()
                .stroke(Theme.faint, style: StrokeStyle(lineWidth: 1.6, lineCap: .round, lineJoin: .round))
                .frame(width: 40, height: 40)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 8) {
                Text("Todavía no hay runs")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(Theme.text)
                Text(isMissing
                     ? "Wololo Desk lee los runs de wololo en esta carpeta, que todavía no existe:"
                     : "Wololo Desk lee los runs de wololo en esta carpeta, que está vacía:")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                code(runs)
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Empezá un run desde Claude Code, en el repo que quieras, y aparece acá solo:")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                code("/wololo <issue>")
            }

            HStack(spacing: 12) {
                Text("¿wololo guarda sus datos en otro lado?")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.muted)
                Button("Cambiar en Ajustes…", action: openSettings)
            }
        }
        .padding(32)
        .frame(maxWidth: 560, alignment: .leading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.border, lineWidth: 1))
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func code(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 13).monospaced())
            .foregroundStyle(Theme.text)
            .textSelection(.enabled)
            .lineLimit(2)
            .truncationMode(.middle)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.ground, in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Theme.border, lineWidth: 1))
    }
}
