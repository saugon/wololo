import AppKit
import SwiftUI
import WololoKit

/// The board window: resizable, can go full screen, always dark. The content runs under a transparent title bar, so
/// the sidebar reaches the traffic lights as in the mockup.
@MainActor
final class MainWindowController: NSWindowController, NSWindowDelegate {
    private let onClose: (NSWindow?) -> Void

    /// `remembersFrame: false` keeps snapshots at the default size, whatever the person left the window at.
    init(state: AppState, remembersFrame: Bool, openSettings: @escaping () -> Void, onClose: @escaping (NSWindow?) -> Void) {
        self.onClose = onClose
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "Wololo"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 1000, height: 640)
        window.collectionBehavior = [.fullScreenPrimary]
        window.tabbingMode = .disallowed
        window.appearance = NSAppearance(named: .darkAqua)
        window.backgroundColor = state.themes.theme.nsGround

        let hosting = NSHostingController(rootView: ThemedRoot(themes: state.themes) {
            MainView(state: state, openSettings: openSettings)
        })
        hosting.sizingOptions = []
        window.contentViewController = hosting
        // Without this the window gives the focus to its first key view, the sidebar's search field, which would then
        // keep Escape from leaving a run's detail. ⌘F focuses the search.
        window.initialFirstResponder = hosting.view
        window.setContentSize(NSSize(width: 1440, height: 900))
        window.center()
        if remembersFrame { window.setFrameAutosaveName("MainWindow") }

        super.init(window: window)
        window.delegate = self
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    func windowWillClose(_ notification: Notification) {
        onClose(window)
    }
}
