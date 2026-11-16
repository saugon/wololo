import AppKit
import Observation
import WololoKit

/// The menu bar icon, with how many runs wait on the person next to it, and the app's menu.
@MainActor
final class StatusItemController: NSObject, NSMenuDelegate {
    struct Actions {
        var toggleWidget: () -> Void
        var openWindow: () -> Void
        var openSettings: () -> Void
    }

    private let state: AppState
    private let actions: Actions
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let headerItem = NSMenuItem(title: "", action: nil, keyEquivalent: "")
    private var widgetItem: NSMenuItem?
    private var shownCount: Int?
    private var shownHeader: String?

    init(state: AppState, actions: Actions) {
        self.state = state
        self.actions = actions
        super.init()
        if let button = statusItem.button {
            button.image = Self.icon
            button.imagePosition = .imageLeading
        }
        statusItem.menu = makeMenu()
        observe()
    }

    /// Reads the model inside the tracking block, so any change to the runs or to the clock tick redraws the count.
    private func observe() {
        withObservationTracking {
            update()
        } onChange: { [weak self] in
            DispatchQueue.main.async { self?.observe() }
        }
    }

    private func update() {
        let model = state.model
        let count = menuBarCount(model.runs, now: model.now)
        let header = menuBarHeader(model.runs, now: model.now)
        if count != shownCount, let button = statusItem.button {
            shownCount = count
            button.attributedTitle = count > 0 ? Self.title(count) : NSAttributedString()
            button.setAccessibilityLabel(count == 1 ? "Wololo Desk: 1 run te espera" : "Wololo Desk: \(count) runs te esperan")
        }
        if header != shownHeader {
            shownHeader = header
            headerItem.attributedTitle = NSAttributedString(string: header, attributes: [
                .font: NSFont.systemFont(ofSize: 12),
                .foregroundColor: NSColor.secondaryLabelColor,
            ])
            statusItem.button?.toolTip = header
        }
    }

    private func makeMenu() -> NSMenu {
        let menu = NSMenu(title: "Wololo Desk")
        menu.delegate = self
        menu.autoenablesItems = false
        headerItem.isEnabled = false
        menu.addItem(headerItem)
        menu.addItem(.separator())

        let widget = item("Mostrar widget", #selector(toggleWidget), key: "l", modifiers: [.command, .shift])
        menu.addItem(widget)
        widgetItem = widget
        menu.addItem(item("Abrir ventana", #selector(openWindow), key: "o"))
        menu.addItem(item("Ajustes…", #selector(openSettings), key: ","))
        menu.addItem(.separator())
        let quit = NSMenuItem(title: "Salir de Wololo Desk", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        quit.target = NSApp
        menu.addItem(quit)
        return menu
    }

    private func item(_ title: String, _ action: Selector, key: String, modifiers: NSEvent.ModifierFlags = .command) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.keyEquivalentModifierMask = modifiers
        item.target = self
        return item
    }

    func menuWillOpen(_ menu: NSMenu) {
        widgetItem?.state = state.isWidgetVisible ? .on : .off
    }

    @objc private func toggleWidget() { actions.toggleWidget() }
    @objc private func openWindow() { actions.openWindow() }
    @objc private func openSettings() { actions.openSettings() }

    private static func title(_ count: Int) -> NSAttributedString {
        let size = NSFont.menuBarFont(ofSize: 0).pointSize
        return NSAttributedString(string: " \(count)", attributes: [
            .font: NSFont.monospacedDigitSystemFont(ofSize: size, weight: .semibold),
            .baselineOffset: 0.5,
        ])
    }

    /// The board glyph of the mockup: three columns hanging from the top, each shorter than the last. A template
    /// image, so the menu bar tints it.
    private static let icon: NSImage = {
        let side: CGFloat = 16
        let image = NSImage(size: NSSize(width: side, height: side), flipped: true) { _ in
            let scale = side / 24
            let columns: [NSRect] = [
                NSRect(x: 3, y: 4, width: 5, height: 16),
                NSRect(x: 10, y: 4, width: 5, height: 10),
                NSRect(x: 17, y: 4, width: 4, height: 7),
            ]
            NSColor.black.setStroke()
            for column in columns {
                let rect = NSRect(x: column.minX * scale, y: column.minY * scale,
                                  width: column.width * scale, height: column.height * scale)
                let path = NSBezierPath(roundedRect: rect, xRadius: 1.5 * scale, yRadius: 1.5 * scale)
                path.lineWidth = 2 * scale
                path.stroke()
            }
            return true
        }
        image.isTemplate = true
        image.accessibilityDescription = "Wololo Desk"
        return image
    }()
}
