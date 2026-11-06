import SwiftUI
import WololoKit

/// Search, the runs waiting on the person, the projects (the chosen one with its active runs nested under it) and
/// Ajustes at the foot. Section headers are muted with an icon; the chosen project is white and semibold on a
/// rounded background. Choosing a project goes back to the board, as in the mockup.
struct Sidebar: View {
    static let width: CGFloat = 240

    @Bindable var state: AppState
    let openSettings: () -> Void

    @State private var isWaitingOpen = true
    @FocusState private var isSearchFocused: Bool
    @Environment(\.theme) private var theme

    var body: some View {
        let model = state.model
        let waiting = widgetRuns(model.runs, now: model.now).filter { isWaitingOnPerson($0, now: model.now) }
        VStack(alignment: .leading, spacing: 20) {
            // The window's traffic lights sit here, in the transparent title bar.
            Color.clear.frame(height: MainView.titleBarHeight)
            brand
            search
            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 22) {
                    waitingSection(waiting, now: model.now)
                    projectsSection(model.runs, now: model.now)
                }
            }
            .scrollIndicators(.never)
            footer(model.dataDirectory)
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 16)
        .frame(width: Self.width)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(theme.sidebar)
        .overlay(alignment: .trailing) {
            theme.divider.frame(width: 1)
        }
    }

    private var brand: some View {
        HStack(spacing: 10) {
            BoardGlyph()
                .stroke(theme.accent, style: StrokeStyle(lineWidth: 1.8, lineCap: .round, lineJoin: .round))
                .frame(width: 22, height: 22)
            Text("Wololo Desk")
                .font(theme.font(.display, size: 17, weight: .bold))
                .tracking(-0.17 + theme.tracking(.display, size: 17))
                .foregroundStyle(theme.title)
        }
        .padding(.horizontal, 8)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    private var search: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(theme.faint)
                .accessibilityHidden(true)
            TextField("Buscar", text: $state.search, prompt: Text("Buscar").foregroundStyle(theme.faint))
                .textFieldStyle(.plain)
                .font(theme.font(.body, size: 14))
                .foregroundStyle(theme.text)
                .accessibilityLabel("Buscar runs")
                .focused($isSearchFocused)
                .onChange(of: isSearchFocused) { state.isSearchFocused = isSearchFocused }
            if !state.search.isEmpty {
                Button {
                    state.search = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(theme.faint)
                }
                .buttonStyle(.plain)
                .help("Borrar la búsqueda")
                .accessibilityLabel("Borrar la búsqueda")
            }
        }
        .padding(.horizontal, 12)
        .frame(height: 40)
        .background(theme.field, in: RoundedRectangle(cornerRadius: theme.r(10)))
        .background {
            // The window opens with nothing focused; ⌘F goes to the search.
            Button("Buscar") { isSearchFocused = true }
                .keyboardShortcut("f", modifiers: .command)
                .opacity(0)
                .frame(width: 0, height: 0)
                .accessibilityHidden(true)
        }
        .help("Busca por título, proyecto, rama o ref (⌘F)")
    }

    // MARK: Te esperan

    private func waitingSection(_ runs: [Run], now: TimeInterval) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Button {
                isWaitingOpen.toggle()
            } label: {
                SectionHeader(symbol: "bell", title: "Te esperan", count: runs.count, chevron: isWaitingOpen ? "chevron.down" : "chevron.right")
            }
            .buttonStyle(.plain)
            .accessibilityValue(isWaitingOpen ? "abierto" : "cerrado")

            if isWaitingOpen {
                if runs.isEmpty {
                    Text("Nadie te espera")
                        .font(theme.font(.body, size: 13))
                        .foregroundStyle(theme.faint)
                        .padding(.leading, 34)
                        .padding(.vertical, 6)
                }
                ForEach(runs, id: \.id) { run in
                    runRow(run, now: now)
                }
            }
        }
    }

    // MARK: Proyectos

    private func projectsSection(_ runs: [Run], now: TimeInterval) -> some View {
        let projects = projectSummaries(runs, now: now)
        let active = runs.filter { isActive($0, now: now) }.count
        return VStack(alignment: .leading, spacing: 4) {
            SectionHeader(symbol: "folder", title: "Proyectos")

            ProjectRow(
                symbol: "square.grid.2x2",
                title: "Todos",
                count: active,
                waitingTitle: nil,
                isSelected: state.project == nil
            ) {
                state.project = nil
                state.selectedRunID = nil
            }

            ForEach(projects, id: \.key) { project in
                let isSelected = state.project == project.key
                VStack(alignment: .leading, spacing: 2) {
                    ProjectRow(
                        symbol: "folder",
                        title: project.display,
                        count: project.active,
                        waitingTitle: project.hasWaiting
                            ? (project.waiting == 1 ? "1 run te espera" : "\(project.waiting) runs te esperan")
                            : nil,
                        isSelected: isSelected
                    ) {
                        state.project = isSelected ? nil : project.key
                        state.selectedRunID = nil
                    }
                    if isSelected {
                        let members = widgetRuns(runs.filter { $0.project.key == project.key }, now: now)
                        VStack(alignment: .leading, spacing: 2) {
                            ForEach(members, id: \.id) { run in
                                runRow(run, now: now)
                            }
                        }
                        .padding(.top, 4)
                        .padding(.bottom, 6)
                    }
                }
            }
        }
    }

    private func runRow(_ run: Run, now: TimeInterval) -> some View {
        SidebarRunRow(run: run, now: now, isSelected: state.selectedRunID == run.id) {
            state.selectedRunID = run.id
        }
    }

    // MARK: Ajustes

    private func footer(_ directory: DataDirectory) -> some View {
        let path = (directory.url.path as NSString).abbreviatingWithTildeInPath
        return VStack(alignment: .leading, spacing: 6) {
            Button(action: openSettings) {
                HStack(spacing: 10) {
                    Image(systemName: "gearshape")
                        .font(.system(size: 15))
                        .frame(width: 17, height: 17)
                    Text("Ajustes")
                        .font(theme.font(.body, size: 14))
                }
                .foregroundStyle(theme.secondary)
                .frame(minHeight: 36)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Text("lee \(path)")
                .font(theme.font(.mono, size: 11))
                .foregroundStyle(theme.faint)
                .lineLimit(1)
                .truncationMode(.middle)
                .help(directory.runsURL.path)
        }
        .padding(.horizontal, 8)
    }
}

/// "Te esperan", "Proyectos": muted, with an icon, not uppercase.
private struct SectionHeader: View {
    let symbol: String
    let title: String
    var count: Int?
    var chevron: String?

    @Environment(\.theme) private var theme

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: symbol)
                .font(.system(size: 13, weight: .medium))
                .frame(width: 16, height: 16)
            Text(title)
                .font(theme.font(.body, size: 14, weight: .medium))
            if let chevron {
                Image(systemName: chevron)
                    .font(.system(size: 10, weight: .semibold))
                    .frame(width: 14, height: 14)
            }
            Spacer(minLength: 0)
            if let count {
                Text("\(count)")
                    .font(theme.font(.body, size: 12.5).monospacedDigit())
            }
        }
        .foregroundStyle(theme.faint)
        .padding(.horizontal, 8)
        .padding(.bottom, 4)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

private struct ProjectRow: View {
    let symbol: String
    let title: String
    let count: Int
    /// "2 runs te esperan" when the project has runs waiting on the person: an amber dot with this tooltip.
    let waitingTitle: String?
    let isSelected: Bool
    let pick: () -> Void

    @State private var isHovered = false
    @Environment(\.theme) private var theme

    var body: some View {
        Button(action: pick) {
            HStack(spacing: 12) {
                Image(systemName: symbol)
                    .font(.system(size: 14, weight: .regular))
                    .foregroundStyle(isSelected ? theme.text : theme.faint)
                    .frame(width: 17, height: 17)
                Text(title)
                    .font(theme.font(.body, size: 14.5, weight: isSelected ? .semibold : .medium))
                    .foregroundStyle(isSelected ? theme.title : theme.secondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let waitingTitle {
                    Circle()
                        .fill(theme.dot(.waitingUser))
                        .frame(width: 7, height: 7)
                        .help(waitingTitle)
                        .accessibilityLabel(waitingTitle)
                }
                Text("\(count)")
                    .font(theme.font(.body, size: 12.5).monospacedDigit())
                    .foregroundStyle(theme.faint)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 9)
            .background(background, in: RoundedRectangle(cornerRadius: theme.r(10)))
            .contentShape(RoundedRectangle(cornerRadius: theme.r(10)))
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
        .accessibilityLabel(waitingTitle.map { "\(title), \(count) activos, \($0)" } ?? "\(title), \(count) activos")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var background: Color {
        if isSelected { return theme.selection }
        return isHovered ? theme.surfaceHover : .clear
    }
}

/// A run nested under its section or project: indented, with its status dot and its title in light gray.
private struct SidebarRunRow: View {
    let run: Run
    let now: TimeInterval
    let isSelected: Bool
    let select: () -> Void

    @State private var isHovered = false
    @Environment(\.theme) private var theme

    var body: some View {
        let status = effectiveStatus(run, now: now)
        Button(action: select) {
            HStack(spacing: 12) {
                Circle()
                    .fill(theme.dot(status))
                    .frame(width: 8, height: 8)
                Text(run.displayTitle)
                    .font(theme.font(.body, size: 14))
                    .foregroundStyle(isSelected ? theme.text : theme.secondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.leading, 34)
            .padding(.trailing, 10)
            .padding(.vertical, 7)
            .background(isSelected || isHovered ? theme.surfaceHover : .clear, in: RoundedRectangle(cornerRadius: theme.r(8)))
            .contentShape(RoundedRectangle(cornerRadius: theme.r(8)))
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
        .help(run.displayTitle)
        .accessibilityLabel(run.displayTitle)
        .accessibilityValue(status.label(run.lang))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

/// The app's board glyph: three columns hanging from the top, each shorter than the last (as the menu bar icon).
struct BoardGlyph: Shape {
    func path(in rect: CGRect) -> Path {
        let scale = min(rect.width, rect.height) / 24
        let columns = [
            CGRect(x: 3, y: 4, width: 5, height: 16),
            CGRect(x: 10, y: 4, width: 5, height: 10),
            CGRect(x: 17, y: 4, width: 4, height: 7),
        ]
        var path = Path()
        for column in columns {
            let scaled = CGRect(
                x: rect.minX + column.minX * scale,
                y: rect.minY + column.minY * scale,
                width: column.width * scale,
                height: column.height * scale
            )
            path.addRoundedRect(in: scaled, cornerSize: CGSize(width: 1.5 * scale, height: 1.5 * scale))
        }
        return path
    }
}
