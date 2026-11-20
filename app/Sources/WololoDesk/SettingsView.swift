import AppKit
import ServiceManagement
import SwiftUI
import WololoKit

@MainActor
final class SettingsWindowController: NSWindowController, NSWindowDelegate {
    private let onClose: (NSWindow?) -> Void

    init(state: AppState, onClose: @escaping (NSWindow?) -> Void) {
        self.onClose = onClose
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 560, height: 400),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "Ajustes"
        window.isReleasedWhenClosed = false
        window.tabbingMode = .disallowed
        window.appearance = NSAppearance(named: .darkAqua)
        window.backgroundColor = state.themes.theme.nsGround

        let hosting = NSHostingController(rootView: ThemedRoot(themes: state.themes) { SettingsView(state: state) })
        hosting.sizingOptions = [.preferredContentSize]
        window.contentViewController = hosting
        window.center()

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

struct SettingsView: View {
    let state: AppState

    @State private var path: String
    @AppStorage(SettingsKey.showWidgetAtLaunch) private var showWidgetAtLaunch = true
    @State private var loginItem = LoginItem()
    /// What the last theme button did, until another is pressed or another theme is chosen.
    @State private var themeNote: ThemeNote?
    @Environment(\.theme) private var theme

    init(state: AppState) {
        self.state = state
        _path = State(initialValue: state.savedDataDirectory)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            section("Apariencia") {
                appearance
            }

            section("Datos") {
                Text("Directorio de datos")
                    .font(theme.font(.body, size: 12, weight: .medium))
                    .foregroundStyle(theme.text)
                HStack(spacing: 8) {
                    TextField(DataDirectory.standard().path.abbreviatingTilde, text: $path)
                        .textFieldStyle(.roundedBorder)
                        .font(theme.font(.mono, size: 11.5))
                        .onSubmit(apply)
                    Button("Elegir…", action: choose)
                    Button("Aplicar", action: apply)
                        .disabled(path.trimmingCharacters(in: .whitespacesAndNewlines) == state.savedDataDirectory)
                }
                note(dataDirectoryNote)
            }

            section("Widget") {
                switchRow("Mostrar el widget al iniciar", isOn: $showWidgetAtLaunch)
            }

            section("Sesión") {
                switchRow("Abrir al iniciar sesión", isOn: Binding(
                    get: { loginItem.isEnabled },
                    set: { loginItem.setEnabled($0) }
                ))
                .disabled(!LoginItem.isAvailable)
                if let message = loginItem.note {
                    note(message)
                }
            }
        }
        .toggleStyle(.switch)
        .tint(theme.accent)
        .padding(24)
        .frame(width: 560, alignment: .topLeading)
        .background { ThemeGround() }
    }

    // MARK: Appearance

    private struct ThemeNote {
        let text: String
        let isProblem: Bool
    }

    private var themes: ThemeStore { state.themes }

    @ViewBuilder
    private var appearance: some View {
        HStack(spacing: 8) {
            Text("Tema")
                .font(theme.font(.body, size: 12, weight: .medium))
                .foregroundStyle(theme.text)
            Spacer()
            Picker("Tema", selection: Binding(
                get: { themes.key },
                set: { key in
                    if themes.select(key) {
                        themeNote = nil
                    } else if let entry = themes.entries.first(where: { $0.id == key || $0.key == key }) {
                        // In case the menu lets a disabled option through: say why nothing changed.
                        themeNote = ThemeNote(text: "\(entry.name) no se puede usar: \(entry.error ?? "no se pudo leer").", isProblem: true)
                    }
                }
            )) {
                ForEach(themes.entries.filter(\.isBuiltIn)) { entry in
                    themeOption(entry)
                }
                let own = themes.entries.filter { !$0.isBuiltIn }
                if !own.isEmpty {
                    Divider()
                    ForEach(own) { entry in
                        themeOption(entry)
                    }
                }
            }
            .labelsHidden()
            .pickerStyle(.menu)
            .frame(width: 240)
        }
        ForEach(themes.warnings, id: \.self) { warning in
            Label(warning, systemImage: "exclamationmark.triangle.fill")
                .font(theme.font(.body, size: 11.5))
                .foregroundStyle(theme.style(.waitingUser).color)
                .fixedSize(horizontal: false, vertical: true)
        }
        let unusable = themes.entries.filter { !$0.isUsable }
        if !unusable.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text("No se pueden elegir:")
                ForEach(unusable) { entry in
                    Text("\(entry.name): \(entry.error ?? "")")
                }
            }
            .font(theme.font(.body, size: 11.5))
            .foregroundStyle(theme.muted)
            .fixedSize(horizontal: false, vertical: true)
        }
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) { themeButtons }
            VStack(alignment: .leading, spacing: 8) { themeButtons }
        }
        .disabled(themes.userDirectory == nil)
        .padding(.top, 2)
        if let themeNote {
            Text(themeNote.text)
                .font(theme.font(.body, size: 11.5))
                .foregroundStyle(themeNote.isProblem ? theme.style(.waitingUser).color : theme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        note(themesFolderNote)
    }

    @ViewBuilder
    private var themeButtons: some View {
        Button("Abrir carpeta de temas", action: openThemesFolder)
        Button("Duplicar el tema elegido como tema propio", action: duplicateTheme)
        Button("Recargar temas", action: reloadThemes)
    }

    /// An option of the theme picker; one that cannot be used shows up disabled, with its error below the picker.
    private func themeOption(_ entry: ThemeEntry) -> some View {
        Text(entry.isUsable ? entry.name : "\(entry.name) (no se puede usar)")
            // A broken folder may share its key with a usable theme: its path keeps the tags apart.
            .tag(entry.isUsable ? entry.key : entry.id)
            .disabled(!entry.isUsable)
    }

    private var themesFolderNote: String {
        let folder = themes.userDirectory.map { "Tus temas van en \($0.path.abbreviatingTilde): cada uno es una carpeta con su theme.json." }
            ?? "No hay carpeta de temas propios."
        guard themes.isForced else { return folder }
        return "\(folder) Lo fija WOLOLO_DESK_THEME: lo que elijas acá no se guarda."
    }

    private func openThemesFolder() {
        do {
            NSWorkspace.shared.open(try themes.createUserDirectory())
        } catch {
            themeNote = ThemeNote(text: "No se pudo abrir la carpeta de temas: \(error.localizedDescription)", isProblem: true)
        }
    }

    private func duplicateTheme() {
        let name = themes.library.entry(themes.key)?.name ?? themes.key
        do {
            let copy = try themes.duplicateCurrent()
            if !copy.selected {
                let reason = themes.library.entry(copy.key)?.error ?? "no se pudo leer"
                themeNote = ThemeNote(text: "Dupliqué \(name) en la carpeta \(copy.key), pero la copia no se puede usar: \(reason).", isProblem: true)
            } else if themes.isForced {
                themeNote = ThemeNote(text: "Dupliqué \(name) en la carpeta \(copy.key) y lo estás usando, pero no se guarda: lo fija WOLOLO_DESK_THEME.", isProblem: false)
            } else {
                themeNote = ThemeNote(text: "Dupliqué \(name) en la carpeta \(copy.key) y es el tema elegido.", isProblem: false)
            }
        } catch {
            themeNote = ThemeNote(text: "No se pudo duplicar \(name): \(error)", isProblem: true)
        }
    }

    private func reloadThemes() {
        let previous = themes.key
        let name = themes.library.entry(previous)?.name ?? previous
        themes.reload()
        if themes.key == previous {
            themeNote = ThemeNote(text: "Recargué los temas.", isProblem: false)
        } else {
            let reason = themes.library.entry(previous)?.error ?? "ya no está"
            themeNote = ThemeNote(text: "\(name) no se puede usar (\(reason)): volví a Actual.", isProblem: true)
        }
    }

    // MARK: Data

    private var dataDirectoryNote: String {
        let directory = state.model.dataDirectory
        let runs = directory.runsURL.path.abbreviatingTilde
        let reading: String
        switch state.model.state {
        case .ok:
            let count = state.model.runs.count
            reading = "Lee \(runs): \(count) \(count == 1 ? "run" : "runs")."
        case .missingRunsDirectory:
            reading = "Todavía no existe \(runs): aparece con el primer run que empieces con /wololo <issue>."
        }
        switch directory.origin {
        case .environment:
            return "\(reading) Lo fija WOLOLO_DATA_DIR; este ajuste se usa cuando no está definida."
        case .setting:
            return reading
        case .standard:
            return "\(reading) Es el directorio por defecto, el que usa wololo."
        }
    }

    private func apply() {
        state.setDataDirectory(path)
        path = state.savedDataDirectory
    }

    private func choose() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false
        panel.prompt = "Elegir"
        panel.directoryURL = state.model.dataDirectory.url
        guard panel.runModal() == .OK, let url = panel.url else { return }
        path = url.path.abbreviatingTilde
        apply()
    }

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title.lowercased())
                .font(theme.font(.body, size: 11.5))
                .foregroundStyle(theme.faint)
            VStack(alignment: .leading, spacing: 8, content: content)
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.surface, in: RoundedRectangle(cornerRadius: theme.r(8)))
                .overlay(RoundedRectangle(cornerRadius: theme.r(8)).stroke(theme.border, lineWidth: 1))
        }
        .foregroundStyle(theme.text)
    }

    private func switchRow(_ title: String, isOn: Binding<Bool>) -> some View {
        HStack {
            Text(title)
            Spacer()
            Toggle(title, isOn: isOn)
                .labelsHidden()
        }
    }

    private func note(_ text: String) -> some View {
        Text(text)
            .font(theme.font(.body, size: 11.5))
            .foregroundStyle(theme.muted)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// "Abrir al iniciar sesión" through `SMAppService`, which only works for an installed `.app`: run from
/// `.build/debug` there is no bundle to register.
@MainActor
@Observable
final class LoginItem {
    static var isAvailable: Bool { Bundle.main.bundleIdentifier != nil }

    private(set) var isEnabled = false
    private(set) var note: String?

    @ObservationIgnored private var observers: [NSObjectProtocol] = []

    init() {
        read()
        // Approvals and removals happen in System Settings: read the status again whenever Ajustes comes back.
        for name in [NSWindow.didBecomeKeyNotification, NSApplication.didBecomeActiveNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.read() }
            })
        }
    }

    func setEnabled(_ enabled: Bool) {
        guard Self.isAvailable else { return }
        do {
            if enabled {
                try SMAppService.mainApp.register()
            } else {
                try SMAppService.mainApp.unregister()
            }
            read()
        } catch {
            read()
            note = "No se pudo cambiar: \(error.localizedDescription)"
        }
    }

    private func read() {
        guard Self.isAvailable else {
            isEnabled = false
            note = "Disponible al instalar Wololo.app con app/scripts/build-app.sh."
            return
        }
        let status = SMAppService.mainApp.status
        isEnabled = status == .enabled || status == .requiresApproval
        note = status == .requiresApproval
            ? "Falta aprobarlo en Ajustes del Sistema › General › Ítems de inicio."
            : nil
    }
}

private extension String {
    var abbreviatingTilde: String { (self as NSString).abbreviatingWithTildeInPath }
}
