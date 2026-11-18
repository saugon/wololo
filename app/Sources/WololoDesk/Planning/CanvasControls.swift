import SwiftUI
import WololoKit

/// The zoom control in the bar under the canvas: − / the zoom (back to 100 %) / + | Ajustar.
struct CanvasControls: View {
    let zoom: Double
    let zoomBy: (Double) -> Void
    let fit: () -> Void

    @Environment(\.theme) private var theme

    var body: some View {
        HStack(spacing: 2) {
            control("−", label: "Alejar", width: 28) { zoomBy(1 / 1.25) }
                .disabled(zoom <= Viewport.minZoom)
            control("\(Int((zoom * 100).rounded()))%", label: "Zoom al 100 %", width: 44) { zoomBy(1 / zoom) }
            control("+", label: "Acercar", width: 28) { zoomBy(1.25) }
                .disabled(zoom >= Viewport.maxZoom)
            theme.border.frame(width: 1, height: 16).padding(.horizontal, 4)
            control("Ajustar", label: "Ajustar a la ventana", width: nil, action: fit)
        }
        .padding(.horizontal, 4)
        .frame(height: 32)
        .background(theme.surface, in: RoundedRectangle(cornerRadius: theme.r(8)))
        .overlay { RoundedRectangle(cornerRadius: theme.r(8)).strokeBorder(theme.border, lineWidth: 1) }
    }

    private func control(_ text: String, label: String, width: CGFloat?, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(text)
                .font(theme.font(.body, size: 12).monospacedDigit())
                .foregroundStyle(theme.secondary)
                .padding(.horizontal, width == nil ? 8 : 0)
                .frame(width: width, height: 26)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(label)
        .accessibilityLabel(label)
    }
}

/// The hint in the bar under the canvas, beside the zoom control.
struct CanvasHint: View {
    @Environment(\.theme) private var theme

    var body: some View {
        (Text("Doble clic en el lienzo crea un nodo · arrastrá desde ")
            + Text("●").foregroundStyle(theme.focus)
            + Text(" hasta otro nodo para conectarlos"))
            .font(theme.font(.body, size: 12))
            .foregroundStyle(theme.faint)
            .lineLimit(1)
            .allowsHitTesting(false)
    }
}
