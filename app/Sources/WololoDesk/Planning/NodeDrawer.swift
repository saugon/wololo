import AppKit
import SwiftUI
import WololoKit

/// The floating panel beside the canvas for the selected node (spec 20): its status and title, its issue,
/// its description, what it depends on, the "Estado" control and the action button (spec 21). For the final node it
/// shows the goal: its title, description and progress. Text edits are saved 0.5 s after the last one; linking an issue
/// and picking a state are saved at once. While a field is being edited, ⌫ and Escape are the field's.
struct NodeDrawer: View {
    static let width: CGFloat = 340
    static let inset: CGFloat = 12

    let state: AppState
    let goal: Goal
    let nodeID: String
    let status: GoalStatus
    let repo: String?
    /// Set when the node was just created: its title takes the focus (scenario 2).
    let focusTitle: Bool
    let didFocusTitle: () -> Void
    let close: () -> Void

    private enum Field: Hashable {
        case title, issue, description
    }

    @Environment(\.theme) private var theme
    @FocusState private var focus: Field?
    @State private var issueText = ""
    /// Whether this drawer set `state.isTextFocused`, so it clears it as it goes even when its field lost the focus
    /// first.
    @State private var ownsTextFocus = false

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: theme.r(14))
        VStack(alignment: .leading, spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    top
                    if Goal.isFinal(nodeID) {
                        descriptionSection(text: goalDescription)
                        dependencies
                    } else if let node = goal.node(nodeID) {
                        issueSection(node)
                        descriptionSection(text: nodeDescription)
                        dependencies
                        stateSection(node)
                    }
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollIndicators(.never)
            bottom
                .padding(.horizontal, 20)
                .padding(.bottom, 20)
                .padding(.top, 8)
        }
        .frame(width: Self.width)
        .frame(maxHeight: .infinity)
        .background(theme.ground, in: shape)
        .overlay { shape.strokeBorder(theme.borderHover, lineWidth: 1) }
        .clipShape(shape)
        .shadow(color: .black.opacity(0.55), radius: 25, y: 20)
        .contentShape(shape)
        .onAppear {
            issueText = goal.node(nodeID)?.issue ?? ""
            if focusTitle { DispatchQueue.main.async { takeTitleFocus() } }
        }
        .onChange(of: focusTitle) { if focusTitle { takeTitleFocus() } }
        .onChange(of: goal.node(nodeID)?.issue) { _, issue in
            if focus != .issue { issueText = issue ?? "" }
        }
        .onChange(of: focus) { oldValue, newValue in
            state.isTextFocused = newValue != nil
            ownsTextFocus = newValue != nil
            if oldValue == .issue, newValue != .issue { commitIssue() }
        }
        .onDisappear {
            if focus == .issue { commitIssue() }
            if ownsTextFocus { state.isTextFocused = false }
        }
    }

    private var nodeStatus: NodeStatus? { status.status(of: nodeID) }

    private func takeTitleFocus() {
        focus = .title
        didFocusTitle()
    }

    // MARK: Top

    private var top: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                chip
                Spacer(minLength: 0)
                Button(action: close) {
                    Image(systemName: "xmark")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(theme.secondary)
                        .frame(width: 26, height: 26)
                        .background(theme.field, in: RoundedRectangle(cornerRadius: theme.r(7)))
                        .overlay { RoundedRectangle(cornerRadius: theme.r(7)).strokeBorder(theme.border, lineWidth: 1) }
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help("Cerrar (Esc)")
                .accessibilityLabel("Cerrar detalle")
            }
            TextField("Sin título", text: title, axis: .vertical)
                .textFieldStyle(.plain)
                .font(theme.font(.display, size: 20, weight: .semibold))
                .tracking(theme.tracking(.display, size: 20))
                .foregroundStyle(theme.title)
                .lineLimit(1...4)
                .focused($focus, equals: .title)
                .onSubmit { focus = nil }
                .accessibilityLabel(Goal.isFinal(nodeID) ? "Título del objetivo" : "Título del paso")
        }
    }

    private var chip: some View {
        let label: String
        let color: Color
        if Goal.isFinal(nodeID) {
            label = "Objetivo · \(status.done) de \(status.total)"
            color = nodeStatus?.state.isDone == true ? theme.style(.done).color : theme.secondary
        } else {
            let nodeState = nodeStatus?.state ?? .pending
            label = nodeState.cardLabel
            color = NodeColors.color(of: nodeState, theme: theme)
        }
        return Text(label.uppercased())
            .font(theme.font(.body, size: 11, weight: .bold))
            .tracking(0.4)
            .foregroundStyle(theme.ground)
            .lineLimit(1)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(color, in: RoundedRectangle(cornerRadius: theme.r(6)))
    }

    // MARK: Sections

    private func sectionTitle(_ text: String) -> some View {
        Text(text)
            .font(theme.font(.body, size: 11, weight: .semibold))
            .tracking(0.7)
            .foregroundStyle(theme.muted)
    }

    @ViewBuilder
    private func issueSection(_ node: GoalNode) -> some View {
        let linked = nodeStatus?.issue
        let field = issueText.trimmingCharacters(in: .whitespacesAndNewlines)
        let isValid = issueFieldValue(issueText, defaultRepo: repo).isValid
        VStack(alignment: .leading, spacing: 8) {
            sectionTitle("ISSUE")
            if let linked, node.issue != nil {
                let box = RoundedRectangle(cornerRadius: theme.r(10))
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Image(systemName: "smallcircle.filled.circle")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(theme.style(.done).color)
                        issueField(placeholder: linked.label(defaultRepo: repo))
                    }
                    if let runTitle = nodeStatus?.runTitle, !runTitle.isEmpty {
                        Text(runTitle)
                            .font(theme.font(.body, size: 13))
                            .foregroundStyle(theme.text)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if let url = linked.url.flatMap(URL.init(string:)) {
                        Button("Abrir en GitHub") { NSWorkspace.shared.open(url) }
                            .buttonStyle(.plain)
                            .font(theme.font(.body, size: 12))
                            .foregroundStyle(theme.accent)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.field, in: box)
                .overlay { box.strokeBorder(theme.border, lineWidth: 1) }
            } else {
                let box = RoundedRectangle(cornerRadius: theme.r(10))
                VStack(alignment: .leading, spacing: 8) {
                    Text("Sin issue. El run arranca con la descripción.")
                        .font(theme.font(.body, size: 12.5))
                        .foregroundStyle(theme.secondary)
                    issueField(placeholder: "Vincular: 131, #131, owner/repo#n o URL")
                        .padding(.horizontal, 8)
                        .frame(height: 26)
                        .background(theme.field, in: RoundedRectangle(cornerRadius: theme.r(6)))
                        .overlay { RoundedRectangle(cornerRadius: theme.r(6)).strokeBorder(theme.border, lineWidth: 1) }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .overlay { box.strokeBorder(theme.border, style: StrokeStyle(lineWidth: 1, dash: [4, 3])) }
            }
            if !field.isEmpty, !isValid {
                Text("No reconozco ese issue")
                    .font(theme.font(.body, size: 11.5))
                    .foregroundStyle(theme.style(.blocked).color)
            }
        }
    }

    /// The issue as typed, in mono; saved when the field is left or Return is pressed.
    private func issueField(placeholder: String) -> some View {
        TextField(placeholder, text: $issueText)
            .textFieldStyle(.plain)
            .font(theme.font(.mono, size: 12))
            .foregroundStyle(theme.secondary)
            .focused($focus, equals: .issue)
            .onSubmit {
                commitIssue()
                focus = nil
            }
            .accessibilityLabel("Issue")
    }

    private func descriptionSection(text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionTitle("DESCRIPCIÓN")
            TextField("Qué hay que hacer", text: text, axis: .vertical)
                .textFieldStyle(.plain)
                .font(theme.font(.body, size: 13))
                .foregroundStyle(theme.secondary)
                .lineLimit(2...12)
                .focused($focus, equals: .description)
                .accessibilityLabel("Descripción")
        }
    }

    private var dependencies: some View {
        let ids = goal.predecessors(of: nodeID)
        return VStack(alignment: .leading, spacing: 6) {
            sectionTitle("DEPENDE DE")
            if ids.isEmpty {
                Text(Goal.isFinal(nodeID) ? "Nada todavía: conectá pasos hacia el objetivo." : "Nada: puede arrancar ya.")
                    .font(theme.font(.body, size: 12.5))
                    .foregroundStyle(theme.muted)
            }
            ForEach(ids, id: \.self) { id in
                let predecessor = status.status(of: id)?.state ?? .pending
                let color = NodeColors.color(of: predecessor, theme: theme)
                let name = goal.node(id)?.title ?? ""
                HStack(spacing: 8) {
                    Circle().fill(color).frame(width: 8, height: 8)
                    Text(name.isEmpty ? "Sin título" : name)
                        .font(theme.font(.body, size: 13))
                        .foregroundStyle(theme.secondary)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text(predecessor.label.lowercased())
                        .font(theme.font(.body, size: 12))
                        .foregroundStyle(color)
                        .lineLimit(1)
                }
            }
        }
    }

    private func stateSection(_ node: GoalNode) -> some View {
        let options: [(String, ManualState?)] = [("Auto", nil), ("Pendiente", .pending), ("En curso", .doing),
                                                 ("Hecho", .done)]
        let track = RoundedRectangle(cornerRadius: theme.r(8))
        return VStack(alignment: .leading, spacing: 8) {
            sectionTitle("ESTADO")
            HStack(spacing: 2) {
                ForEach(options, id: \.0) { option in
                    let isOn = node.manualState == option.1
                    Button { setManualState(option.1) } label: {
                        Text(option.0)
                            .font(theme.font(.body, size: 12, weight: isOn ? .semibold : .regular))
                            .foregroundStyle(isOn ? theme.title : theme.muted)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 5)
                            .background(isOn ? theme.surfaceHover : .clear,
                                        in: RoundedRectangle(cornerRadius: theme.r(6)))
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(isOn ? .isSelected : [])
                }
            }
            .padding(2)
            .background(theme.field, in: track)
            .overlay { track.strokeBorder(theme.border, lineWidth: 1) }
            Text(nodeStatus?.stateNote ?? "")
                .font(theme.font(.body, size: 12))
                .foregroundStyle(theme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: Bottom

    @ViewBuilder
    private var bottom: some View {
        if Goal.isFinal(nodeID) {
            VStack(alignment: .leading, spacing: 8) {
                Text(goalSubtitle(projectName: nil, repo: nil, done: status.done, total: status.total))
                    .font(theme.font(.body, size: 13, weight: .semibold))
                    .foregroundStyle(theme.text)
                GeometryReader { geometry in
                    ZStack(alignment: .leading) {
                        Capsule().fill(theme.track)
                        Capsule().fill(theme.style(.done).color)
                            .frame(width: geometry.size.width * status.fraction)
                    }
                }
                .frame(height: 4)
                Text(nodeStatus?.stateNote ?? "")
                    .font(theme.font(.body, size: 12))
                    .foregroundStyle(theme.muted)
            }
        } else if let node = goal.node(nodeID), let nodeStatus,
                  let action = NodeActionPresentation.make(status: nodeStatus, command: NodeRun.command(for: node, goal: goal, state: state),
                                                           folder: NodeRun.folder(for: node, goal: goal, state: state),
                                                           home: FileManager.default.homeDirectoryForCurrentUser.path) {
            VStack(spacing: 8) {
                if action.isTextOnly {
                    Text(action.label)
                        .font(theme.font(.body, size: 14, weight: .semibold))
                        .foregroundStyle(theme.style(.done).color)
                        .frame(maxWidth: .infinity, minHeight: 40)
                } else {
                    ActionButton(action: action) { perform(action.kind) }
                }
                if let subline = action.subline {
                    Text(subline)
                        .font(action.sublineIsCommand ? theme.font(.mono, size: 11.5) : theme.font(.body, size: 12))
                        .foregroundStyle(theme.muted)
                        .multilineTextAlignment(.center)
                        .lineLimit(3)
                        .truncationMode(.middle)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity)
                }
            }
        }
    }

    private func perform(_ kind: NodeActionPresentation.Kind) {
        switch kind {
        case .start(let command, let folder):
            RunLauncher.launch(command: command, folder: folder, state: state)
        case .viewRun(let id):
            state.showRun(id)
        case .openPR(let url):
            if let url = URL(string: url) { NSWorkspace.shared.open(url) }
        case .none:
            break
        }
    }

    // MARK: Editing

    private var title: Binding<String> {
        Binding(
            get: { Goal.isFinal(nodeID) ? goal.title : goal.node(nodeID)?.title ?? "" },
            set: { newValue in editText { goal in
                if Goal.isFinal(nodeID) { goal.title = newValue } else { goal.editNode(nodeID) { $0.title = newValue } }
            } }
        )
    }

    private var nodeDescription: Binding<String> {
        Binding(
            get: { goal.node(nodeID)?.description ?? "" },
            set: { newValue in editText { $0.editNode(nodeID) { $0.description = newValue } } }
        )
    }

    private var goalDescription: Binding<String> {
        Binding(
            get: { goal.description },
            set: { newValue in editText { $0.description = newValue } }
        )
    }

    /// Applies a text edit to the goal as it is now, so edits made elsewhere meanwhile are kept.
    private func editText(_ change: (inout Goal) -> Void) {
        guard var latest = state.goal(id: goal.id) else { return }
        let before = latest
        change(&latest)
        if latest != before { state.updateText(goal: latest) }
    }

    /// Saves the issue field, trimmed; blank unlinks it. Text that names no issue is kept, with its hint.
    private func commitIssue() {
        let value = issueFieldValue(issueText, defaultRepo: repo).value
        guard var latest = state.goal(id: goal.id), let node = latest.node(nodeID), node.issue != value else { return }
        latest.editNode(nodeID) { $0.issue = value }
        state.update(goal: latest)
    }

    /// "Auto" clears the manual state; the others set it (spec 17).
    private func setManualState(_ manual: ManualState?) {
        guard var latest = state.goal(id: goal.id), let node = latest.node(nodeID), node.manualState != manual else { return }
        latest.editNode(nodeID) { $0.manualState = manual }
        state.update(goal: latest)
    }
}

/// The drawer's main button: the accent for a start that can run, the plain surface otherwise, dimmed when disabled.
private struct ActionButton: View {
    let action: NodeActionPresentation
    let perform: () -> Void

    @Environment(\.theme) private var theme

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: theme.r(10))
        Button(action: perform) {
            Text(action.label)
                .font(theme.font(.body, size: 14, weight: .semibold))
                .foregroundStyle(action.isPrimary ? theme.ground : action.isEnabled ? theme.text : theme.muted)
                .frame(maxWidth: .infinity, minHeight: 40)
                .background(action.isPrimary ? theme.accent : action.isEnabled ? theme.field : theme.ground, in: shape)
                .overlay { if !action.isPrimary { shape.strokeBorder(theme.border, lineWidth: 1) } }
                .contentShape(shape)
        }
        .buttonStyle(.plain)
        .disabled(!action.isEnabled)
    }
}

/// The command and folder "Arrancar run" uses for a node of a goal, from its project, and starting it from the
/// context menu ("Arrancar igual").
@MainActor
enum NodeRun {
    static func command(for node: GoalNode, goal: Goal, state: AppState) -> String {
        RunLaunch.command(for: node, projectRepo: state.project(id: goal.projectID).flatMap(defaultRepo(for:)))
    }

    static func folder(for node: GoalNode, goal: Goal, state: AppState) -> LaunchFolder {
        guard let project = state.project(id: goal.projectID) else {
            return .disabled(reason: "El objetivo no tiene un proyecto")
        }
        return RunLaunch.folder(for: node, project: project, projects: state.projects)
    }

    /// Launches the node's run, or says in a toast why it can't.
    static func start(nodeID: String, goal: Goal, state: AppState) {
        guard let node = goal.node(nodeID) else { return }
        switch folder(for: node, goal: goal, state: state) {
        case .folder(let path):
            RunLauncher.launch(command: command(for: node, goal: goal, state: state), folder: path, state: state)
        case .disabled(let reason):
            state.showToast([reason])
        }
    }
}

extension Goal {
    /// Changes the step `id` in place; nothing when there is no such step.
    fileprivate mutating func editNode(_ id: String, _ change: (inout GoalNode) -> Void) {
        guard let index = nodes.firstIndex(where: { $0.id == id }) else { return }
        change(&nodes[index])
    }
}
