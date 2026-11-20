import AppKit
import Carbon.HIToolbox
import Observation
import WololoKit

enum SettingsKey {
    static let dataDirectory = DataDirectory.settingKey
    static let showWidgetAtLaunch = "showWidgetAtLaunch"
    static let widgetVisible = "widgetVisible"
    /// The chosen theme's key. `WOLOLO_DESK_THEME` overrides it without writing it.
    static let theme = "theme"
}

/// What every view reads: the live run list, rebuilt when the data directory setting changes, and whether the widget
/// is shown.
@MainActor
@Observable
final class AppState {
    private(set) var model: RunsModel
    private(set) var isWidgetVisible: Bool
    /// The theme every window draws with.
    let themes: ThemeStore

    /// The board's filters, shared so the widget and the menu can open the window on a run.
    var search = ""
    /// A project key, or nil for every project.
    var project: String?
    var boardMode: BoardMode = .byStatus {
        didSet { if boardMode != oldValue { planningPrefs.boardMode = boardMode } }
    }
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

    // MARK: Planning

    /// Operación (the board) or Planificación (the goals).
    var tab: PlanningTab = .operation {
        didSet { if tab != oldValue { planningPrefs.tab = tab } }
    }
    var selectedProjectID: String? {
        didSet { if selectedProjectID != oldValue, remembersSelection { planningPrefs.selectedProjectID = selectedProjectID } }
    }
    /// The goal the planning view shows.
    var selectedGoalID: String? {
        didSet {
            guard selectedGoalID != oldValue else { return }
            if remembersSelection { planningPrefs.selectedGoalID = selectedGoalID }
            selectedNodeID = nil
            selectedEdge = nil
        }
    }
    /// The node selected on the goal's canvas; the drawer shows it.
    var selectedNodeID: String?
    /// The arrow selected on the goal's canvas, instead of a node; ⌫ removes it.
    var selectedEdge: GoalEdge?
    /// Bumped when the canvas creates a node, so the drawer puts the focus on its title.
    var focusTitleRequest = 0
    /// While a text field of the planning view has the focus, ⌫ and Escape are the field's and not the canvas's.
    var isTextFocused = false
    /// The project sheet on screen: "Nuevo proyecto" or editing one.
    var projectSheet: ProjectSheetMode?
    /// The goal whose title the header should put the focus on ("Renombrar" in the sidebar); the header clears it.
    var renameGoalRequest: String?
    /// The goals and projects, and when they are written.
    let goalSession: GoalSession
    @ObservationIgnored let planningPrefs: PlanningPrefs
    /// Off while a selection that is gone is cleared: the preference keeps it, in case it comes back.
    @ObservationIgnored private var remembersSelection = true
    @ObservationIgnored private let options: LaunchOptions

    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let persists: Bool

    /// With `persists: false` (snapshots) nothing the app does is written to the settings, nor to the goals.
    init(options: LaunchOptions = LaunchOptions(environment: [:]), defaults: UserDefaults = .standard, persists: Bool = true) {
        defaults.register(defaults: [SettingsKey.showWidgetAtLaunch: true, SettingsKey.widgetVisible: true])
        self.defaults = defaults
        self.persists = persists
        self.options = options
        themes = ThemeStore(options: options, defaults: defaults, persists: persists)
        let dataDirectory = DataDirectory.resolve(setting: defaults.string(forKey: SettingsKey.dataDirectory))
        model = RunsModel(dataDirectory: dataDirectory)
        isWidgetVisible = false
        planningPrefs = PlanningPrefs(defaults: defaults, persists: persists)
        let goalsDirectory = GoalStore.directory(options: options, dataDirectory: dataDirectory.url)
        goalSession = GoalSession(store: Self.makeGoalStore(directory: goalsDirectory, dataDirectory: dataDirectory,
                                                            options: options, persists: persists))
        // A snapshot starts where `WOLOLO_DESK_OPEN` says, not where the person left the app.
        if persists {
            tab = planningPrefs.tab
            boardMode = planningPrefs.boardMode
            selectedProjectID = planningPrefs.selectedProjectID
            selectedGoalID = planningPrefs.selectedGoalID
        }
        goalSession.report = { [weak self] in self?.showToast($0) }
        loadGoals()
    }

    /// The widget comes back at launch if the setting allows it and it was not hidden when the app last quit.
    var showsWidgetAtLaunch: Bool {
        defaults.bool(forKey: SettingsKey.showWidgetAtLaunch) && defaults.bool(forKey: SettingsKey.widgetVisible)
    }

    var savedDataDirectory: String {
        defaults.string(forKey: SettingsKey.dataDirectory) ?? ""
    }

    /// Reads the runs; the chosen project is checked once they are read, since it may be one only they name.
    func start() {
        model.start()
        dropMissingSelection()
    }

    /// The board filters `WOLOLO_DESK_SEARCH`, `_PROJECT` and `_COLUMNS` ask for.
    func apply(_ options: LaunchOptions) {
        if let search = options.search { self.search = search }
        if let project = options.project { self.project = project }
        if let columns = options.columns { boardMode = columns }
    }

    /// Shows the run's detail on the Operación tab, on `tab` or else on its timeline.
    func showRun(_ id: String, tab: LaunchOptions.DetailTab? = nil) {
        self.tab = .operation
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
        // Going to or from the sample data changes where the goals are read from, not only their copy.
        let goalsDirectory = GoalStore.directory(options: options, dataDirectory: next.url)
        goalSession.replaceStore(Self.makeGoalStore(directory: goalsDirectory, dataDirectory: next, options: options,
                                                    persists: persists))
        dropMissingSelection()
    }

    func setWidgetVisible(_ visible: Bool) {
        isWidgetVisible = visible
        if persists { defaults.set(visible, forKey: SettingsKey.widgetVisible) }
    }
}

// MARK: - Goals

extension AppState {
    var goals: [Goal] { goalSession.goals }

    /// The projects the planning sidebar lists: the stored ones and those the runs name.
    var projects: [PlanningProject] {
        mergedProjects(stored: goalSession.storedProjects, runs: model.runs)
    }

    var selectedGoal: Goal? {
        selectedGoalID.flatMap(goal(id:))
    }

    func goal(id: String) -> Goal? {
        goalSession.goal(id: id)
    }

    func project(id: String) -> PlanningProject? {
        projects.first { $0.id == id }
    }

    /// Shows a goal on the Planificación tab, with its project chosen.
    func showGoal(_ id: String) {
        tab = .planning
        selectedGoalID = id
        if let goal = goal(id: id) { selectedProjectID = goal.projectID }
    }

    /// Chooses a project on its own, with no goal shown.
    func selectProject(_ id: String) {
        selectedProjectID = id
        selectedGoalID = nil
    }

    /// A new goal in the project, with only its final node, saved and chosen (spec 5).
    @discardableResult
    func createGoal(in projectID: String) -> Goal? {
        guard let project = project(id: projectID) else { return nil }
        guard let goal = goalSession.createGoal(in: project) else { return nil }
        selectedProjectID = project.id
        selectedGoalID = goal.id
        return goal
    }

    /// A structural change: saved now.
    func update(goal: Goal) {
        goalSession.update(goal)
    }

    /// A text edit: shown now and saved 0.5 s after the last one.
    func updateText(goal: Goal) {
        goalSession.updateText(goal)
    }

    /// Saves every text edit still waiting, as the app quits.
    func flushPendingSaves() {
        goalSession.flush()
    }

    /// Removes the goal, its copy and its saved viewport. If its file can't be removed it stays on screen.
    func deleteGoal(id: String) {
        guard goalSession.deleteGoal(id: id) else { return }
        planningPrefs.removeViewport(forGoal: id)
        if selectedGoalID == id { selectedGoalID = nil }
    }

    @discardableResult
    func saveProjects(_ projects: [PlanningProject]) -> Bool {
        goalSession.saveProjects(projects)
    }

    /// Saves a project from the sheet (a new one, an edited one or a derived one being stored) and chooses it.
    @discardableResult
    func save(project: PlanningProject) -> Bool {
        guard goalSession.saveProjects(upserting(project, into: goalSession.storedProjects)) else { return false }
        if selectedGoal?.projectID != project.id { selectProject(project.id) }
        return true
    }

    /// Removes a project, its goals and their saved viewports (spec 7). One whose runs are still around comes back
    /// as a derived project, without goals.
    func deleteProject(id: String) {
        let goalIDs = goals.filter { $0.projectID == id }.map(\.id)
        let deleted = goalSession.deleteProject(id: id)
        for goalID in goalIDs where goal(id: goalID) == nil {
            planningPrefs.removeViewport(forGoal: goalID)
        }
        if let goalID = selectedGoalID, goal(id: goalID) == nil { selectedGoalID = nil }
        if deleted, selectedProjectID == id { selectedProjectID = nil }
    }

    /// Shows the goal with the focus on its title in the header.
    func renameGoal(_ id: String) {
        showGoal(id)
        renameGoalRequest = id
    }

    fileprivate func loadGoals() {
        goalSession.load()
        dropMissingSelection()
    }

    /// Clears, on screen only, a chosen goal that is no longer there (one whose file can't be read is kept) and, once
    /// the runs are read, a chosen project no list names.
    fileprivate func dropMissingSelection() {
        remembersSelection = false
        defer { remembersSelection = true }
        if let id = selectedGoalID, goal(id: id) == nil, !goalSession.unreadableGoalIDs.contains(id) {
            selectedGoalID = nil
        }
        if model.isStarted, let id = selectedProjectID, project(id: id) == nil {
            selectedProjectID = nil
        }
    }

    /// `directory` (see `GoalStore.directory`), with its copy in `<data>/goals`. On the sample data the goals
    /// are only written to a folder chosen with `WOLOLO_DESK_GOALS_DIR` (see `GoalStore.writesGoals`).
    fileprivate static func makeGoalStore(directory: URL, dataDirectory: DataDirectory, options: LaunchOptions,
                                          persists: Bool) -> GoalStore {
        GoalStore(directory: directory, mirror: GoalStore.mirrorDirectory(dataDirectory: dataDirectory.url),
                  writes: GoalStore.writesGoals(persists: persists, dataDirectory: dataDirectory.url, options: options),
                  log: { NSLog("Wololo goals: %@", $0) })
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let options: LaunchOptions
    private let state: AppState
    private var statusItem: StatusItemController?
    /// ⌘⇧L shows or hides the widget from any app.
    private var widgetHotKey: GlobalHotKey?
    private var mainWindow: MainWindowController?
    private var widgetPanel: WidgetPanelController?
    private var settingsWindow: SettingsWindowController?

    private var isSnapshot: Bool { options.snapshotURL != nil }

    override init() {
        options = LaunchOptions()
        // Before the themes are read, so a bundled family such as Cinzel is not reported missing.
        AppResources.registerFonts()
        state = AppState(options: options, persists: options.snapshotURL == nil)
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

        if !isSnapshot {
            widgetHotKey = GlobalHotKey(keyCode: kVK_ANSI_L, modifiers: cmdKey | shiftKey) { [weak self] in self?.toggleWidget() }
        }

        if let url = options.snapshotURL {
            open(options.open ?? .window)
            Snapshot.take(of: { [weak self] in self?.snapshotWindow() }, to: url, state: state)
            return
        }
        // Opening the app opens its window, on whatever WOLOLO_DESK_OPEN asks for or else the board.
        open(options.open ?? .window)
        if state.showsWidgetAtLaunch {
            state.setWidgetVisible(true)
        }
    }

    /// Text edits still waiting for their 0.5 s are saved before the app goes.
    func applicationWillTerminate(_ notification: Notification) {
        state.flushPendingSaves()
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
        case .planning:
            state.tab = .planning
            openWindow()
        case .goal(let id):
            state.showGoal(id)
            state.selectedNodeID = options.node
            openWindow()
        case .newProject:
            state.tab = .planning
            state.projectSheet = .create
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
        case .window, .run, .planning, .goal: return mainWindow?.window
        case .newProject: return mainWindow?.window?.attachedSheet ?? mainWindow?.window
        case .settings: return settingsWindow?.window
        case .widget: return widgetPanel?.window
        }
    }
}
