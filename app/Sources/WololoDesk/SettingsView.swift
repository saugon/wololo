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

    init(state: AppState) {
        self.state = state
        _path = State(initialValue: state.savedDataDirectory)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            section("Datos") {
                Text("Directorio de datos")
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.text)
                HStack(spacing: 8) {
                    TextField(DataDirectory.standard().path.abbreviatingTilde, text: $path)
                        .textFieldStyle(.roundedBorder)
                        .font(Theme.Font.mono)
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
        .tint(Theme.blue)
        .padding(24)
        .frame(width: 560, alignment: .topLeading)
        .background(Theme.ground)
    }

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
                .font(Theme.Font.caption)
                .foregroundStyle(Theme.faint)
            VStack(alignment: .leading, spacing: 8, content: content)
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.border, lineWidth: 1))
        }
        .foregroundStyle(Theme.text)
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
            .font(Theme.Font.caption)
            .foregroundStyle(Theme.muted)
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
            note = "Disponible al instalar Wololo Desk.app con app/scripts/build-app.sh."
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
