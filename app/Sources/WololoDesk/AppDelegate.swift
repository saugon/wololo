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

    /// The board's filters, shared so the widget and the menu can open the window on a run.
    var search = ""
    /// A project key, or nil for every project.
    var project: String?
    var boardMode: BoardMode = .byStatus
    /// The run whose detail the window shows instead of the board. Another run opens on its timeline.
    var selectedRunID: String? {
        didSet {
            if selectedRunID != oldValue { detailTab = .timeline }
        }
    }
    var detailTab: LaunchOptions.DetailTab = .timeline
    /// While the sidebar's search field has the focus, Escape is the field's and does not leave the detail.
    var isSearchFocused = false
    /// The message on screen for a moment, set through `showToast`.
    var toast: Toast?

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

    /// The board filters `WOLOLO_DESK_SEARCH`, `_PROJECT` and `_COLUMNS` ask for.
    func apply(_ options: LaunchOptions) {
        if let search = options.search { self.search = search }
        if let project = options.project { self.project = project }
        if let columns = options.columns { boardMode = columns }
    }

    /// Shows the run's detail, on `tab` or else on its timeline.
    func showRun(_ id: String, tab: LaunchOptions.DetailTab? = nil) {
        selectedRunID = id
        if let tab { detailTab = tab }
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
    private var widgetPanel: WidgetPanelController?
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

        state.apply(options)
        state.start()
        statusItem = StatusItemController(state: state, actions: .init(
            toggleWidget: { [weak self] in self?.toggleWidget() },
            openWindow: { [weak self] in self?.openWindow() },
            openSettings: { [weak self] in self?.openSettings() }
        ))
        widgetPanel = WidgetPanelController(
            state: state,
            remembersFrame: !isSnapshot,
            openWindow: { [weak self] in self?.openWindow() },
            openRun: { [weak self] id in self?.openRun(id) }
        )

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
        case .window:
            openWindow()
        case .run(let id, let tab):
            state.showRun(id, tab: tab)
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

    /// From the widget: the window, in front and active, on the run's detail.
    private func openRun(_ id: String) {
        state.showRun(id)
        openWindow()
    }

    private func openWindow() {
        if mainWindow == nil {
            mainWindow = MainWindowController(
                state: state,
                remembersFrame: !isSnapshot,
                openSettings: { [weak self] in self?.openSettings() },
                onClose: { [weak self] window in self?.regularWindowDidClose(window) }
            )
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
        case .widget: return widgetPanel?.window
        }
    }
}
