import AppKit
import SwiftUI
import WololoKit

/// What the project sheet is for: a new project, or editing one (a derived one too: saving stores it).
enum ProjectSheetMode: Identifiable, Equatable {
    case create
    case edit(PlanningProject)

    var id: String {
        switch self {
        case .create: return "new"
        case .edit(let project): return "edit:\(project.id)"
        }
    }
}

/// "Nuevo proyecto" and "Editar proyecto" (spec 6 and 7): the local folder, chosen with the system's folder picker,
/// the name and the GitHub repo. Picking a folder fills the name with the folder's and the repo with its `origin`
/// remote, unless the person already typed them. It can't be saved while the folder doesn't exist, the name is empty,
/// the repo isn't one, or another project already collects that repo's runs.
struct ProjectSheet: View {
    let state: AppState
    let mode: ProjectSheetMode

    private enum Field: Hashable {
        case path, name, repo
    }

    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focus: Field?
    @State private var path = ""
    @State private var name = ""
    @State private var repoText = ""
    /// The name and repo the sheet filled in itself: a folder picked later replaces them, but not what was typed.
    @State private var autoName: String?
    @State private var autoRepo: String?
    @State private var didAppear = false

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 4) {
                Text(isCreating ? "Nuevo proyecto" : "Editar proyecto")
                    .font(theme.font(.display, size: 18, weight: .semibold))
                    .tracking(theme.tracking(.display, size: 18))
                    .foregroundStyle(theme.title)
                    .accessibilityAddTraits(.isHeader)
                Text("Un proyecto es una carpeta de tu máquina con su repo. Sus objetivos arrancan los runs ahí.")
                    .font(theme.font(.body, size: 12.5))
                    .foregroundStyle(theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }

            folderField

            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top, spacing: 12) {
                    labeled("Nombre") {
                        input("shop", text: $name, field: .name, mono: false)
                            .accessibilityLabel("Nombre")
                    }
                    labeled("Repo de GitHub") {
                        input("owner/nombre", text: $repoText, field: .repo, mono: true)
                            .accessibilityLabel("Repo de GitHub")
                    }
                }
                if let problem = repoProblem {
                    warning(problem)
                } else {
                    (Text("Nombre y repo salen solos del ")
                        + Text("git remote").font(theme.font(.mono, size: 11.5))
                        + Text(" de la carpeta. Si ya hubo runs ahí, el proyecto ya aparece en el sidebar."))
                        .font(theme.font(.body, size: 12))
                        .foregroundStyle(theme.faint)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            if isCreating {
                storageNote
            }

            HStack(spacing: 8) {
                Spacer(minLength: 0)
                SheetButton(title: "Cancelar", isAccent: false, isEnabled: true) { dismiss() }
                    .keyboardShortcut(.cancelAction)
                SheetButton(title: isCreating ? "Crear proyecto" : "Guardar", isAccent: true,
                            isEnabled: result != nil, action: save)
                    .keyboardShortcut(.defaultAction)
                    .disabled(result == nil)
            }
        }
        .padding(28)
        .frame(width: 560)
        .background(theme.surface)
        .onAppear(perform: fill)
        .onChange(of: focus) { oldValue, newValue in
            if oldValue == .path, newValue != .path { applyFolderDefaults() }
        }
    }

    private var isCreating: Bool { mode == .create }

    // MARK: Fields

    private var folderField: some View {
        labeled("Carpeta local") {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    input("~/code/shop", text: $path, field: .path, mono: true)
                        .onSubmit { applyFolderDefaults() }
                        .accessibilityLabel("Carpeta local")
                    SheetButton(title: "Elegir…", isAccent: false, isEnabled: true, action: chooseFolder)
                        .help("Elegir la carpeta del proyecto")
                }
                if !trimmedPath.isEmpty, !folderExists {
                    warning("Esa carpeta no existe")
                }
            }
        }
    }

    private func labeled(_ title: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(theme.font(.body, size: 12, weight: .semibold))
                .foregroundStyle(theme.secondary)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func input(_ placeholder: String, text: Binding<String>, field: Field, mono: Bool) -> some View {
        let shape = RoundedRectangle(cornerRadius: theme.r(8))
        return TextField(placeholder, text: text)
            .textFieldStyle(.plain)
            .font(mono ? theme.font(.mono, size: 12.5) : theme.font(.body, size: 13))
            .foregroundStyle(theme.text)
            .focused($focus, equals: field)
            .padding(.horizontal, 10)
            .frame(height: 34)
            .background(theme.field, in: shape)
            .overlay { shape.strokeBorder(focus == field ? theme.focus : theme.border, lineWidth: 1) }
    }

    private func warning(_ text: String) -> some View {
        Text(text)
            .font(theme.font(.body, size: 12))
            .foregroundStyle(theme.style(.blocked).color)
            .fixedSize(horizontal: false, vertical: true)
    }

    /// Where the goals are kept, and the copy for the plugin when the data directory has one.
    private var storageNote: some View {
        let store = state.goalSession.store
        return VStack(alignment: .leading, spacing: 8) {
            Text("Dónde se guardan sus objetivos")
                .font(theme.font(.body, size: 12, weight: .semibold))
                .foregroundStyle(theme.secondary)
            (Text("En Wololo Desk (")
                + Text(tilde(store.directory.path) + "/").font(theme.font(.mono, size: 11.5))
                + Text("). Funciona sin el plugin."))
                .font(theme.font(.body, size: 12))
                .foregroundStyle(theme.muted)
                .fixedSize(horizontal: false, vertical: true)
            if let mirror = store.mirror {
                (Text("Si el data directory de wololo existe, también se copian a ")
                    + Text(tilde(mirror.path) + "/").font(theme.font(.mono, size: 11.5))
                    + Text(": una copia de solo lectura para el plugin; la app es la única que escribe."))
                    .font(theme.font(.body, size: 12))
                    .foregroundStyle(theme.faint)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.ground, in: RoundedRectangle(cornerRadius: theme.r(10)))
        .overlay { RoundedRectangle(cornerRadius: theme.r(10)).strokeBorder(theme.border, lineWidth: 1) }
    }

    // MARK: Values

    private var trimmedPath: String { path.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// The folder as a normalized absolute path, with `~` expanded; nil when it isn't absolute.
    private var folderPath: String? {
        let expanded = (trimmedPath as NSString).expandingTildeInPath
        guard expanded.hasPrefix("/") else { return nil }
        return URL(fileURLWithPath: expanded).standardizedFileURL.path
    }

    /// The folder, when it is an absolute path to a directory that exists.
    private var existingFolder: String? {
        guard let folderPath else { return nil }
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: folderPath, isDirectory: &isDirectory), isDirectory.boolValue else {
            return nil
        }
        return folderPath
    }

    private var folderExists: Bool { existingFolder != nil }

    private var trimmedRepo: String { repoText.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// The repo as `owner/name`; nil when the field is empty or isn't a repo.
    private var repo: String? { normalizeRepoInput(trimmedRepo) }

    /// Why the repo blocks saving: it isn't a repo, or another project already collects its runs.
    private var repoProblem: String? {
        guard !trimmedRepo.isEmpty else { return nil }
        guard let repo else { return "No reconozco ese repo: escribí owner/nombre o pegá la URL de GitHub" }
        let key = PlanningProject.key(forRepo: repo)
        if let other = project(matchingKey: key, in: state.goalSession.storedProjects), other.id != editedID {
            return "Ya existe un proyecto para \(defaultRepo(for: other) ?? repo)"
        }
        return nil
    }

    private var editedID: String? {
        if case .edit(let project) = mode { return project.id }
        return nil
    }

    /// The project to save, or nil while something blocks it.
    private var result: PlanningProject? {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let folderPath = existingFolder, !name.isEmpty, repoProblem == nil else { return nil }
        switch mode {
        case .create:
            return PlanningProject(id: UUID().uuidString.lowercased(), name: name, path: folderPath, repo: repo,
                                   key: repo.map(PlanningProject.key(forRepo:)))
        case .edit(let project):
            return projectEditing(project, name: name, path: folderPath, repo: repo)
        }
    }

    // MARK: Actions

    /// The project's values when editing; what was filled from its folder counts as filled in by the sheet.
    private func fill() {
        guard !didAppear else { return }
        didAppear = true
        guard case .edit(let project) = mode else {
            DispatchQueue.main.async { focus = .path }
            return
        }
        path = tilde(project.path)
        name = project.name
        repoText = defaultRepo(for: project) ?? ""
        if !project.path.isEmpty {
            if project.name == defaultProjectName(forFolder: project.path) { autoName = project.name }
            if let origin = originRepo(forFolder: project.path), origin == repoText { autoRepo = origin }
        }
    }

    private func chooseFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = true
        panel.prompt = "Elegir"
        panel.message = "Elegí la carpeta del proyecto"
        if let folder = existingFolder { panel.directoryURL = URL(fileURLWithPath: folder, isDirectory: true) }
        guard panel.runModal() == .OK, let url = panel.url else { return }
        path = tilde(url.path)
        applyFolderDefaults()
    }

    /// The folder's name and `origin` repo, where the person hasn't typed their own.
    private func applyFolderDefaults() {
        guard let folderPath = existingFolder else { return }
        if name.trimmingCharacters(in: .whitespaces).isEmpty || name == autoName {
            let folderName = defaultProjectName(forFolder: folderPath)
            name = folderName
            autoName = folderName
        }
        if trimmedRepo.isEmpty || repoText == autoRepo {
            let origin = originRepo(forFolder: folderPath) ?? ""
            repoText = origin
            autoRepo = origin
        }
    }

    private func save() {
        guard let project = result else { return }
        if state.save(project: project) { dismiss() }
    }

    private func tilde(_ path: String) -> String {
        (path as NSString).abbreviatingWithTildeInPath
    }
}

/// "Cancelar" and "Elegir…" (secondary), and the sheet's accent button.
private struct SheetButton: View {
    let title: String
    let isAccent: Bool
    let isEnabled: Bool
    let action: () -> Void

    @Environment(\.theme) private var theme

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: theme.r(8))
        Button(action: action) {
            Text(title)
                .font(theme.font(.body, size: 13, weight: isAccent ? .semibold : .regular))
                .foregroundStyle(isAccent ? theme.ground : theme.secondary)
                .padding(.horizontal, 14)
                .frame(height: 34)
                .background(isAccent ? theme.accent : theme.field, in: shape)
                .overlay { if !isAccent { shape.strokeBorder(theme.border, lineWidth: 1) } }
                .opacity(isEnabled ? 1 : 0.45)
                .contentShape(shape)
        }
        .buttonStyle(.plain)
        .fixedSize()
    }
}
