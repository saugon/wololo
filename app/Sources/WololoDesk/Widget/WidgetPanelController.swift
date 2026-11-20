import AppKit
import Observation
import SwiftUI

/// The floating widget's panel, after Megadesk's: it does not activate the app, floats over other windows, joins
/// every Space and full-screen apps, and moves by its header and footer. It follows `AppState.isWidgetVisible`,
/// keeps its top edge where it is while its height follows the rows (moving up when it would leave the screen), and
/// remembers where it was left.
@MainActor
final class WidgetPanelController: NSWindowController, NSWindowDelegate {
    private static let autosaveName = "WidgetPanel"
    /// The gap to the screen's edges where the panel first appears, under the menu bar at the top right.
    private static let margin: CGFloat = 20
    /// The header's strip, which must be on a screen for the panel to be reachable: it is where it is dragged from.
    private static let headerHeight: CGFloat = 50

    private let state: AppState
    private let layout = WidgetLayout()
    private var shownVisibility: Bool?
    /// The view's last natural height, to fit the panel again when the screen changes.
    private var naturalHeight: CGFloat = 0
    private var screenObserver: NSObjectProtocol?

    /// `remembersFrame: false` keeps snapshots at the default place and saves nothing.
    init(state: AppState, remembersFrame: Bool, openWindow: @escaping () -> Void, openRun: @escaping (String) -> Void) {
        self.state = state
        let panel = WidgetPanel(
            contentRect: NSRect(x: 0, y: 0, width: WidgetView.width, height: 160),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.level = .floating
        // Out of ⌘` and the window cycle: the panel is reached with the pointer, not the keyboard.
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
        panel.isFloatingPanel = true
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = true
        panel.isReleasedWhenClosed = false
        // Only the header, the footer and the empty state drag it (`WindowDragArea`): a drag on a row is a click.
        panel.isMovableByWindowBackground = false
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = true
        panel.appearance = NSAppearance(named: .darkAqua)
        panel.title = "Wololo: widget"
        panel.setAccessibilityLabel("Widget de Wololo")

        super.init(window: panel)
        panel.delegate = self
        panel.onCancel = { [weak state] in state?.setWidgetVisible(false) }

        let view = WidgetView(
            state: state,
            layout: layout,
            openWindow: openWindow,
            openRun: openRun,
            hide: { [weak state] in state?.setWidgetVisible(false) },
            // Resizing the panel waits for the layout pass that measured the height to end.
            heightChanged: { [weak self] height in DispatchQueue.main.async { self?.fit(height: height) } }
        )
        let hosting = FirstMouseHostingView(rootView: ThemedRoot(themes: state.themes, paintsWindow: false) { view })
        hosting.sizingOptions = []
        panel.contentView = hosting

        placeAtTopRight()
        if remembersFrame {
            panel.setFrameAutosaveName(Self.autosaveName)
            if !isReachable(panel.frame) { placeAtTopRight() }
        }
        updateMaxHeight()
        screenObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.screensChanged() }
        }
        observe()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    /// Shows or hides the panel whenever the state's visibility changes, from the menu or the panel's own button.
    private func observe() {
        withObservationTracking {
            apply(visible: state.isWidgetVisible)
        } onChange: { [weak self] in
            DispatchQueue.main.async { self?.observe() }
        }
    }

    private func apply(visible: Bool) {
        guard visible != shownVisibility, let window else { return }
        shownVisibility = visible
        if visible {
            window.orderFrontRegardless()
        } else {
            window.orderOut(nil)
        }
    }

    /// Anything that closes the panel other than the state (`performClose`, the system) still hides it through the
    /// state, so the saved visibility and the menu's toggle stay true to what is on screen.
    func windowWillClose(_ notification: Notification) {
        shownVisibility = false
        if state.isWidgetVisible { state.setWidgetVisible(false) }
    }

    func windowDidChangeScreen(_ notification: Notification) {
        updateMaxHeight()
        fit(height: naturalHeight)
    }

    /// A display came, went or changed size: the panel comes back to a screen and fits the room it has there.
    private func screensChanged() {
        guard let window else { return }
        if !isReachable(window.frame) { placeAtTopRight() }
        updateMaxHeight()
        fit(height: naturalHeight)
    }

    private var visibleFrame: NSRect? {
        (window?.screen ?? NSScreen.main)?.visibleFrame
    }

    private func updateMaxHeight() {
        let room = visibleFrame.map { $0.height - 2 * Self.margin } ?? WidgetView.maxHeight
        let maxHeight = min(WidgetView.maxHeight, max(room, Self.headerHeight * 3))
        if layout.maxHeight != maxHeight { layout.maxHeight = maxHeight }
    }

    /// Sizes the panel to the view's natural height, keeping its top edge in place, and moves it up when its bottom
    /// would fall below the screen's visible area.
    private func fit(height: CGFloat) {
        guard let window, height > 0 else { return }
        naturalHeight = height
        var frame = window.frame
        let target = min(height.rounded(.up), layout.maxHeight)
        let top = frame.maxY
        frame.size = NSSize(width: WidgetView.width, height: target)
        frame.origin.y = top - target
        if let visible = visibleFrame, frame.minY < visible.minY {
            frame.origin.y = min(visible.minY, visible.maxY - target)
        }
        guard frame != window.frame else { return }
        window.setFrame(frame, display: true)
        // The shadow follows the rounded corners only once it is redrawn for the new shape.
        window.invalidateShadow()
    }

    private func placeAtTopRight() {
        guard let window, let screen = NSScreen.main else { return }
        let visible = screen.visibleFrame
        let size = window.frame.size
        window.setFrameOrigin(NSPoint(
            x: visible.maxX - size.width - Self.margin,
            y: visible.maxY - size.height - Self.margin
        ))
    }

    /// A saved place can be off every screen once a display is gone, or leave the header, the only handle to drag the
    /// panel by, under the menu bar or past an edge.
    private func isReachable(_ frame: NSRect) -> Bool {
        let header = NSRect(x: frame.minX, y: frame.maxY - Self.headerHeight, width: frame.width, height: Self.headerHeight)
        return NSScreen.screens.contains { screen in
            let shown = screen.visibleFrame.intersection(header)
            return shown.height >= header.height - 0.5 && shown.width >= min(120, header.width)
        }
    }
}

/// A borderless panel never becomes key by default; this one may, when a click needs it (keyboard focus on a row),
/// without activating the app, since the panel is non-activating. Escape hides it through the state.
private final class WidgetPanel: NSPanel {
    var onCancel: (() -> Void)?

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    override func cancelOperation(_ sender: Any?) {
        onCancel?()
    }
}

/// Takes the first click, so a row or a button works on the first click even though the panel is not key.
private final class FirstMouseHostingView<Content: View>: NSHostingView<Content> {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}
