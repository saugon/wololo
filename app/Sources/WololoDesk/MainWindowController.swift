import AppKit
import SwiftUI
import WololoKit

/// The board window: resizable, can go full screen, always dark.
@MainActor
final class MainWindowController: NSWindowController, NSWindowDelegate {
    private let onClose: (NSWindow?) -> Void

    /// `remembersFrame: false` keeps snapshots at the default size, whatever the person left the window at.
    init(state: AppState, remembersFrame: Bool, onClose: @escaping (NSWindow?) -> Void) {
        self.onClose = onClose
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 800),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Wololo Desk"
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 1000, height: 640)
        window.collectionBehavior = [.fullScreenPrimary]
        window.tabbingMode = .disallowed
        window.appearance = NSAppearance(named: .darkAqua)
        window.backgroundColor = Theme.groundColor

        let hosting = NSHostingController(rootView: MainView(state: state))
        hosting.sizingOptions = []
        window.contentViewController = hosting
        window.setContentSize(NSSize(width: 1280, height: 800))
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
