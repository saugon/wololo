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

    @Environment(\.theme) private var theme

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
        .background(theme.ground)
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
            theme.divider.frame(height: 1)
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

    /// The title and the counts, then the counters and the column picker; when they do not fit beside the title,
    /// they move to a line of their own.
    private func header(_ visible: [Run], now: TimeInterval, runs: [Run]) -> some View {
        let active = visible.filter { isActive($0, now: now) }.count
        let waiting = visible.filter { isWaitingOnPerson($0, now: now) }.count
        let counters = boardCounters(visible, now: now)
        let heading = VStack(alignment: .leading, spacing: 1) {
            Text(title(runs))
                .font(theme.font(.display, size: 16, weight: .bold))
                .tracking(theme.tracking(.display, size: 16))
                .foregroundStyle(theme.title)
                .lineLimit(1)
                .accessibilityAddTraits(.isHeader)
            Text(subtitle(active: active, waiting: waiting))
                .font(theme.font(.body, size: 13))
                .foregroundStyle(theme.muted)
                .lineLimit(1)
        }
        let controls = HStack(spacing: 14) {
            CountersBox(working: counters.working, waiting: counters.waiting)
            ModePicker(mode: $state.boardMode)
        }
        .fixedSize()
        return ViewThatFits(in: .horizontal) {
            HStack(alignment: .center, spacing: 14) {
                heading
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(WindowDragArea())
                controls
            }
            VStack(alignment: .leading, spacing: 8) {
                heading
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(WindowDragArea())
                controls
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, Self.titleBarHeight)
        .padding(.bottom, 10)
    }

    private func title(_ runs: [Run]) -> String {
        guard let key = state.project else { return theme.spec.texts.boardTitle }
        return runs.first { $0.project.key == key }?.project.display ?? key
    }

    private func subtitle(active: Int, waiting: Int) -> String {
        let search = state.search.trimmingCharacters(in: .whitespacesAndNewlines)
        let counts = "\(active) \(active == 1 ? "activo" : "activos") · \(waiting) \(waiting == 1 ? "te espera" : "te esperan")"
        return search.isEmpty ? counts : "\(counts) · buscando “\(search)”"
    }
}

/// "4 trabajando | 3 te esperan": how many runs are working and how many wait on the person, in the theme's words.
/// It only informs; nothing in it is clickable.
private struct CountersBox: View {
    let working: Int
    let waiting: Int

    @Environment(\.theme) private var theme

    var body: some View {
        HStack(spacing: 0) {
            stat(working, theme.spec.texts.counterWorking)
            theme.border.frame(width: 1, height: 22)
            stat(waiting, theme.spec.texts.counterWaiting)
        }
        .background(theme.field, in: RoundedRectangle(cornerRadius: theme.r(8)))
        .overlay(RoundedRectangle(cornerRadius: theme.r(8)).strokeBorder(theme.border, lineWidth: 1))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Runs")
    }

    private func stat(_ count: Int, _ word: String) -> some View {
        HStack(spacing: 7) {
            Text("\(count)")
                .font(theme.font(.body, size: 16, weight: .bold).monospacedDigit())
                .foregroundStyle(theme.title)
            Text(word)
                .font(theme.font(.body, size: 13, weight: .medium))
                .foregroundStyle(theme.secondary)
        }
        .lineLimit(1)
        .padding(.horizontal, 10)
        .frame(minHeight: 40)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(count) \(word)")
    }
}

/// "Por estado" / "Por etapa", as the mockup's segmented control.
private struct ModePicker: View {
    @Binding var mode: BoardMode

    @Environment(\.theme) private var theme

    var body: some View {
        HStack(spacing: 2) {
            segment("Por estado", .byStatus)
            segment("Por etapa", .byStage)
        }
        .padding(3)
        .background(theme.surface, in: RoundedRectangle(cornerRadius: theme.r(8)))
        .overlay(RoundedRectangle(cornerRadius: theme.r(8)).strokeBorder(theme.border, lineWidth: 1))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Agrupar columnas")
    }

    private func segment(_ title: String, _ value: BoardMode) -> some View {
        let isOn = mode == value
        return Button {
            mode = value
        } label: {
            Text(title)
                .font(theme.font(.body, size: 13, weight: .medium))
                .foregroundStyle(isOn ? theme.title : theme.muted)
                .padding(.horizontal, 14)
                .frame(minHeight: 34)
                .background(isOn ? theme.track : .clear, in: RoundedRectangle(cornerRadius: theme.r(6)))
                .contentShape(RoundedRectangle(cornerRadius: theme.r(6)))
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
