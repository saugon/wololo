import SwiftUI
import WololoKit

/// How tall the panel may grow where it is now: `WidgetView.maxHeight`, or less on a short screen. The panel's
/// controller keeps it up to date.
@MainActor
@Observable
final class WidgetLayout {
    var maxHeight = WidgetView.maxHeight
}

/// The floating widget: the header with how many runs wait on the person, one row per active run (those waiting
/// first), and a footer with the active count and the last run that finished. With no active run it says so and
/// shows the last one that finished. A toast from the widget's own buttons shows above the footer, inside the panel's
/// height, and goes away on a click.
struct WidgetView: View {
    static let width: CGFloat = 400
    /// The tallest the panel grows to; past it the rows scroll.
    static let maxHeight: CGFloat = 600

    let state: AppState
    let layout: WidgetLayout
    let openWindow: () -> Void
    let openRun: (String) -> Void
    let hide: () -> Void
    /// The panel's natural height, for the controller to size the panel to it.
    let heightChanged: (CGFloat) -> Void

    @State private var rowsHeight: CGFloat = 0
    @State private var chromeHeight: CGFloat = 0
    @State private var bottomHeight: CGFloat = 0
    @Environment(\.theme) private var theme

    var body: some View {
        let model = state.model
        let runs = widgetRuns(model.runs, now: model.now)
        let last = lastFinished(model.runs, now: model.now)
        VStack(spacing: 0) {
            VStack(spacing: 0) {
                header(waiting: menuBarCount(model.runs, now: model.now))
                theme.cardDivider.frame(height: 1)
            }
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { chromeHeight = $0 }

            if runs.isEmpty {
                empty(last: last, now: model.now)
            } else {
                list(runs, now: model.now)
            }

            VStack(spacing: 0) {
                toast(state.toast(from: .widget))
                if !runs.isEmpty {
                    footer(active: runs.count, last: last, now: model.now)
                }
            }
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { bottomHeight = $0 }
        }
        .frame(width: Self.width)
        .fixedSize(horizontal: false, vertical: true)
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { heightChanged($0) }
        .frame(maxHeight: .infinity, alignment: .top)
        .background { ThemeGround(color: theme.widget) }
        .clipShape(RoundedRectangle(cornerRadius: theme.r(12)))
        .overlay(RoundedRectangle(cornerRadius: theme.r(12)).strokeBorder(theme.widgetBorder, lineWidth: 1))
        .preferredColorScheme(.dark)
    }

    private func header(waiting: Int) -> some View {
        HStack(spacing: 10) {
            if theme.drawsHoods {
                HoodIcon(color: theme.muted, face: theme.widget)
                    .frame(width: 18, height: 18)
            } else {
                AppIconMark(side: 22)
            }
            Text("wololo")
                .font(theme.font(.display, size: 13, weight: .bold))
                .tracking(theme.tracking(.display, size: 13))
                .foregroundStyle(theme.text)
            if waiting > 0 {
                Text(waitingLabel(waiting))
                    .font(theme.font(.body, size: 11.5, weight: .semibold))
                    .foregroundStyle(theme.style(.waitingUser).badgeText)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(theme.style(.waitingUser).badge, in: Capsule())
                    .fixedSize()
            }
            Spacer(minLength: 0)
            Button(action: openWindow) {
                Image(systemName: "arrow.up.forward.square")
                    .font(.system(size: 13, weight: .medium))
                    .frame(width: 28, height: 28)
                    .contentShape(RoundedRectangle(cornerRadius: theme.r(6)))
            }
            .buttonStyle(WidgetIconButtonStyle())
            .help("Abrir la ventana")
            .accessibilityLabel("Abrir la ventana")
            Button(action: hide) {
                Image(systemName: "minus")
                    .font(.system(size: 13, weight: .semibold))
                    .frame(width: 28, height: 28)
                    .contentShape(RoundedRectangle(cornerRadius: theme.r(6)))
            }
            .buttonStyle(WidgetIconButtonStyle())
            .help("Ocultar el widget (⌘⇧L)")
            .accessibilityLabel("Ocultar el widget")
        }
        .padding(.leading, 14)
        .padding(.trailing, 12)
        .padding(.top, 12)
        .padding(.bottom, 10)
        .background(WindowDragArea(zooms: false))
    }

    /// The rows at their natural height, up to what leaves the panel at its largest; past that they scroll.
    private func list(_ runs: [Run], now: TimeInterval) -> some View {
        let room = max(layout.maxHeight - chromeHeight - bottomHeight, 80)
        return ScrollView(.vertical) {
            VStack(spacing: 0) {
                ForEach(runs, id: \.id) { run in
                    WidgetRow(
                        run: run,
                        now: now,
                        open: { openRun(run.id) },
                        goToTerminal: { TerminalAction.go(to: run, now: state.model.now, state: state, origin: .widget) }
                    )
                    theme.rowDivider.frame(height: 1)
                }
            }
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { rowsHeight = $0 }
        }
        .scrollIndicators(.automatic)
        .frame(height: min(rowsHeight, room))
    }

    private func footer(active: Int, last: Run?, now: TimeInterval) -> some View {
        VStack(spacing: 0) {
            theme.cardDivider.frame(height: 1)
            HStack(spacing: 8) {
                Text(activeLabel(active))
                    .fixedSize()
                if let last {
                    Text("·")
                        .accessibilityHidden(true)
                    HStack(spacing: 0) {
                        Text("último terminado: \(last.displayTitle)")
                            .lineLimit(1)
                            .truncationMode(.tail)
                        Text(", \(ago(finishedAt(last), now: now, lang: .es))")
                            .fixedSize()
                    }
                    .help(last.displayTitle)
                }
                Spacer(minLength: 0)
            }
            .font(theme.font(.body, size: 11.5))
            .foregroundStyle(theme.faint)
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(WindowDragArea(zooms: false))
        }
        .accessibilityElement(children: .combine)
    }

    /// The toast in the flow of the panel rather than over the rows, so the panel grows to show it whole and the
    /// rows stay clickable; a click on it dismisses it.
    private func toast(_ toast: Toast?) -> some View {
        ZStack {
            if let toast {
                ToastView(toast: toast)
                    .id(toast.id)
                    .contentShape(RoundedRectangle(cornerRadius: theme.r(10)))
                    .onTapGesture { state.dismissToast(toast.id) }
                    .help("Click para cerrar")
                    .accessibilityAction(named: "Cerrar") { state.dismissToast(toast.id) }
                    .padding(10)
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.2), value: toast)
    }

    private func empty(last: Run?, now: TimeInterval) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Sin runs activos")
                .font(theme.font(.body, size: 13, weight: .semibold))
                .foregroundStyle(theme.secondary)
            if let last {
                HStack(alignment: .firstTextBaseline, spacing: 0) {
                    Text("Último terminado: \(last.displayTitle)")
                        .lineLimit(1)
                        .truncationMode(.tail)
                    Text(", \(ago(finishedAt(last), now: now, lang: .es))")
                        .fixedSize()
                }
                .font(theme.font(.body, size: 12))
                .foregroundStyle(theme.faint)
                .contentShape(Rectangle())
                .onTapGesture { openRun(last.id) }
                .help("Abrir el detalle de \(last.displayTitle)")
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(.isButton)
                .accessibilityAction(.default) { openRun(last.id) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 14)
        .padding(.vertical, 16)
        .background(WindowDragArea(zooms: false))
    }

    private func finishedAt(_ run: Run) -> TimeInterval {
        run.finishedAt ?? run.updatedAt
    }
}
