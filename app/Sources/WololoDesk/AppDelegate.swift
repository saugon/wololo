import AppKit
import Observation
import WololoKit

enum SettingsKey {
    static let dataDirectory = DataDirectory.settingKey
    static let showWidgetAtLaunch = "showWidgetAtLaunch"
    static let widgetVisible = "widgetVisible"
}

/// What every view reads: the live run list, rebuilt when the data directory setting changes, and whether the widget
/// is shown.
@MainActor
@Observable
final class AppState {
    private(set) var model: RunsModel
    private(set) var isWidgetVisible: Bool

    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let persists: Bool

    /// With `persists: false` (snapshots) nothing the app does is written to the settings.
    init(defaults: UserDefaults = .standard, persists: Bool = true) {
        defaults.register(defaults: [SettingsKey.showWidgetAtLaunch: true, SettingsKey.widgetVisible: true])
        self.defaults = defaults
        self.persists = persists
        model = RunsModel(dataDirectory: DataDirectory.resolve(setting: defaults.string(forKey: SettingsKey.dataDirectory)))
        isWidgetVisible = false
    }

    /// The widget comes back at launch if the setting allows it and it was not hidden when the app last quit.
    var showsWidgetAtLaunch: Bool {
        defaults.bool(forKey: SettingsKey.showWidgetAtLaunch) && defaults.bool(forKey: SettingsKey.widgetVisible)
    }

    var savedDataDirectory: String {
        defaults.string(forKey: SettingsKey.dataDirectory) ?? ""
    }

    func start() {
        model.start()
    }

    /// Saves the setting (empty goes back to the default) and reads the runs from where it now points.
    /// `WOLOLO_DATA_DIR` still wins while it is set.
    func setDataDirectory(_ path: String) {
        let trimmed = path.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            defaults.removeObject(forKey: SettingsKey.dataDirectory)
        } else {
            defaults.set(trimmed, forKey: SettingsKey.dataDirectory)
        }
        let next = DataDirectory.resolve(setting: defaults.string(forKey: SettingsKey.dataDirectory))
        guard next != model.dataDirectory else { return }
        model.stop()
        model = RunsModel(dataDirectory: next)
        model.start()
    }

    func setWidgetVisible(_ visible: Bool) {
        isWidgetVisible = visible
        if persists { defaults.set(visible, forKey: SettingsKey.widgetVisible) }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let options: LaunchOptions
    private let state: AppState
    private var statusItem: StatusItemController?
    private var mainWindow: MainWindowController?
    private var settingsWindow: SettingsWindowController?

    private var isSnapshot: Bool { options.snapshotURL != nil }

    override init() {
        options = LaunchOptions()
        state = AppState(persists: options.snapshotURL == nil)
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.appearance = NSAppearance(named: .darkAqua)
        NSApp.setActivationPolicy(.accessory)
        NSApp.mainMenu = MainMenu.make(openSettings: #selector(openSettings), target: self)

        state.start()
        statusItem = StatusItemController(state: state, actions: .init(
            toggleWidget: { [weak self] in self?.toggleWidget() },
            openWindow: { [weak self] in self?.openWindow() },
            openSettings: { [weak self] in self?.openSettings() }
        ))

        if let url = options.snapshotURL {
            open(options.open ?? .window)
            Snapshot.take(of: { [weak self] in self?.snapshotWindow() }, to: url, state: state)
            return
        }
        if let target = options.open {
            open(target)
        }
        if state.showsWidgetAtLaunch {
            state.setWidgetVisible(true)
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    /// Opening the app again (Finder, Spotlight, `open`) brings up the window.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { openWindow() }
        return true
    }

    private func open(_ target: LaunchOptions.Target) {
        switch target {
        case .window, .run:
            openWindow()
        case .settings:
            openSettings()
        case .widget:
            state.setWidgetVisible(true)
        }
    }

    private func toggleWidget() {
        state.setWidgetVisible(!state.isWidgetVisible)
    }

    private func openWindow() {
        if mainWindow == nil {
            mainWindow = MainWindowController(state: state, remembersFrame: !isSnapshot) { [weak self] window in
                self?.regularWindowDidClose(window)
            }
        }
        show(mainWindow)
    }

    @objc private func openSettings() {
        if settingsWindow == nil {
            settingsWindow = SettingsWindowController(state: state) { [weak self] window in
                self?.regularWindowDidClose(window)
            }
        }
        show(settingsWindow)
    }

    /// Like Megadesk: the app is in the Dock and the app switcher only while one of its windows is open.
    private func show(_ controller: NSWindowController?) {
        guard let window = controller?.window else { return }
        if isSnapshot {
            window.orderFrontRegardless()
        } else {
            NSApp.setActivationPolicy(.regular)
            if window.isMiniaturized { window.deminiaturize(nil) }
            controller?.showWindow(nil)
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    private func regularWindowDidClose(_ window: NSWindow?) {
        let stillOpen = [mainWindow?.window, settingsWindow?.window]
            .compactMap { $0 }
            .contains { $0 !== window && ($0.isVisible || $0.isMiniaturized) }
        if !stillOpen { NSApp.setActivationPolicy(.accessory) }
    }

    private func snapshotWindow() -> NSWindow? {
        switch options.open ?? .window {
        case .window, .run: return mainWindow?.window
        case .settings: return settingsWindow?.window
        case .widget: return nil // item 9 adds the widget panel; item 7 routes .run to its detail and tab

        }
    }
}
