import AppKit
import SwiftUI
import WololoKit

/// The window: the project sidebar and, beside it, the chosen run's detail, the board of the runs that match the
/// search and the chosen project, or the empty state when the store has no runs at all.
struct MainView: View {
    /// The transparent title bar the content runs under: nothing clickable goes in this strip.
    static let titleBarHeight: CGFloat = 28

    @Bindable var state: AppState
    let openSettings: () -> Void

    var body: some View {
        let model = state.model
        HStack(spacing: 0) {
            Sidebar(state: state, openSettings: openSettings)
            Group {
                if let id = state.selectedRunID {
                    RunDetailView(state: state, runID: id)
                        .id(id)
                } else if model.runs.isEmpty {
                    EmptyStateView(
                        directory: model.dataDirectory,
                        isMissing: model.state == .missingRunsDirectory,
                        openSettings: openSettings
                    )
                } else {
                    board(model)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .toast(state.toast(from: .window))
        }
        .background(Theme.ground)
        .overlay(alignment: .top) {
            WindowDragArea()
                .frame(height: Self.titleBarHeight)
        }
        .ignoresSafeArea()
        .preferredColorScheme(.dark)
    }

    private func board(_ model: RunsModel) -> some View {
        let visible = filterRuns(model.runs, query: state.search, project: state.project)
        let board = Board(runs: visible, now: model.now, mode: state.boardMode)
        return VStack(spacing: 0) {
            header(visible, now: model.now, runs: model.runs)
            Theme.divider.frame(height: 1)
            BoardView(
                board: board,
                mode: state.boardMode,
                now: model.now,
                selectedRunID: state.selectedRunID
            ) { id in
                state.selectedRunID = id
            }
        }
    }

    private func header(_ visible: [Run], now: TimeInterval, runs: [Run]) -> some View {
        let active = visible.filter { isActive($0, now: now) }.count
        let waiting = visible.filter { isWaitingOnPerson($0, now: now) }.count
        return HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title(runs))
                    .font(.system(size: 20, weight: .bold))
                    .tracking(-0.2)
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                    .accessibilityAddTraits(.isHeader)
                Text(subtitle(active: active, waiting: waiting))
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.muted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(WindowDragArea())
            ModePicker(mode: $state.boardMode)
        }
        .padding(.horizontal, 24)
        .padding(.top, Self.titleBarHeight + 2)
        .padding(.bottom, 16)
    }

    private func title(_ runs: [Run]) -> String {
        guard let key = state.project else { return "Todos los runs" }
        return runs.first { $0.project.key == key }?.project.display ?? key
    }

    private func subtitle(active: Int, waiting: Int) -> String {
        let search = state.search.trimmingCharacters(in: .whitespacesAndNewlines)
        let counts = "\(active) \(active == 1 ? "activo" : "activos") · \(waiting) \(waiting == 1 ? "te espera" : "te esperan")"
        return search.isEmpty ? counts : "\(counts) · buscando “\(search)”"
    }
}

/// "Por estado" / "Por etapa", as the mockup's segmented control.
private struct ModePicker: View {
    @Binding var mode: BoardMode

    var body: some View {
        HStack(spacing: 2) {
            segment("Por estado", .byStatus)
            segment("Por etapa", .byStage)
        }
        .padding(3)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Theme.border, lineWidth: 1))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Agrupar columnas")
    }

    private func segment(_ title: String, _ value: BoardMode) -> some View {
        let isOn = mode == value
        return Button {
            mode = value
        } label: {
            Text(title)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(isOn ? Color.white : Theme.muted)
                .padding(.horizontal, 14)
                .padding(.vertical, 7)
                .background(isOn ? Theme.track : .clear, in: RoundedRectangle(cornerRadius: 6))
                .contentShape(RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }
}

/// Empty chrome that moves the window, as a title bar would: the strip under the transparent title bar and the
/// header's title area. Double-click zooms, following the system setting, unless `zooms` is false (the widget).
struct WindowDragArea: NSViewRepresentable {
    var zooms = true

    func makeNSView(context: Context) -> NSView {
        let view = DragView()
        view.zooms = zooms
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        (nsView as? DragView)?.zooms = zooms
    }

    private final class DragView: NSView {
        var zooms = true

        override var mouseDownCanMoveWindow: Bool { true }

        /// The widget's panel is never active, so a drag must start on the first click.
        override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

        override func mouseDown(with event: NSEvent) {
            guard let window else { return }
            if event.clickCount == 2 {
                guard zooms else { return }
                let action = UserDefaults.standard.string(forKey: "AppleActionOnDoubleClick") ?? "Maximize"
                if action == "Minimize" {
                    window.performMiniaturize(nil)
                } else if action != "None" {
                    window.performZoom(nil)
                }
            } else {
                window.performDrag(with: event)
            }
        }
    }
}
