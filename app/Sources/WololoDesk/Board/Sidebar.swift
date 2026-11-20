import SwiftUI
import WololoKit

/// The Operación | Planificación tabs, then, on Operación: search, the runs waiting on the person, the projects (the chosen one with its active runs nested under it) and
/// Ajustes at the foot, as the reference draws them: small headings in the display font, rows with a bullet or an
/// icon, and the chosen row on a subtle background with a 1 pt border. Choosing a project goes back to the board.
/// Planificación lists the projects and their goals instead (`PlanningSidebar`).
struct Sidebar: View {
    static let width: CGFloat = 240

    @Bindable var state: AppState
    let openSettings: () -> Void

    @FocusState private var isSearchFocused: Bool
    @Environment(\.theme) private var theme

    var body: some View {
        let model = state.model
        let waiting = widgetRuns(model.runs, now: model.now).filter { isWaitingOnPerson($0, now: model.now) }
        VStack(alignment: .leading, spacing: 20) {
            // The window's traffic lights sit here, in the transparent title bar.
            Color.clear.frame(height: MainView.titleBarHeight)
            brand
            SidebarTabs(tab: $state.tab, waiting: waiting.count)
            switch state.tab {
            case .operation:
                search
                ScrollView(.vertical) {
                    VStack(alignment: .leading, spacing: 16) {
                        waitingSection(waiting, now: model.now)
                        projectsSection(model.runs, now: model.now)
                    }
                }
                .scrollIndicators(.never)
            case .planning:
                PlanningSidebar(state: state)
            }
            footer(model.dataDirectory)
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 16)
        .frame(width: Self.width)
        .frame(maxHeight: .infinity, alignment: .top)
        // A theme's texture runs under the sidebar too, and its divider image replaces the 1 pt line.
        .background(theme.backgroundTile == nil ? theme.sidebar : .clear)
        .overlay(alignment: .trailing) {
            if theme.dividerTile == nil {
                theme.divider.frame(width: 1)
            }
        }
    }

    private var brand: some View {
        HStack(spacing: 10) {
            if theme.drawsHoods {
                HoodIcon(color: theme.muted, face: theme.ground)
                    .frame(width: 24, height: 27)
            } else {
                BoardGlyph()
                    .stroke(theme.accent, style: StrokeStyle(lineWidth: 1.8, lineCap: .round, lineJoin: .round))
                    .frame(width: 22, height: 22)
            }
            Text("Wololo")
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
        VStack(alignment: .leading, spacing: 2) {
            SectionHeading(title: "\(theme.spec.texts.waitingSection) · \(runs.count)")
            if runs.isEmpty {
                Text("Nadie te espera")
                    .font(theme.font(.body, size: 13))
                    .foregroundStyle(theme.faint)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 6)
            }
            ForEach(runs, id: \.id) { run in
                runRow(run, now: now)
            }
        }
    }

    // MARK: Proyectos

    private func projectsSection(_ runs: [Run], now: TimeInterval) -> some View {
        let projects = projectSummaries(runs, now: now)
        let active = runs.filter { isActive($0, now: now) }.count
        return VStack(alignment: .leading, spacing: 2) {
            SectionHeading(title: theme.spec.texts.projectsSection)

            ProjectRow(icon: nil, title: theme.spec.texts.all, count: active, isSelected: state.project == nil) {
                state.project = nil
                state.selectedRunID = nil
            }

            ForEach(projects, id: \.key) { project in
                let isSelected = state.project == project.key
                VStack(alignment: .leading, spacing: 2) {
                    ProjectRow(
                        icon: theme.spec.shapes.projectIcon,
                        title: project.display,
                        count: project.active,
                        isSelected: isSelected
                    ) {
                        state.project = isSelected ? nil : project.key
                        state.selectedRunID = nil
                    }
                    if isSelected {
                        let members = widgetRuns(runs.filter { $0.project.key == project.key }, now: now)
                        VStack(alignment: .leading, spacing: 2) {
                            ForEach(members, id: \.id) { run in
                                runRow(run, now: now, indent: 20)
                            }
                        }
                        .padding(.bottom, 4)
                    }
                }
            }
        }
    }

    private func runRow(_ run: Run, now: TimeInterval, indent: CGFloat = 0) -> some View {
        SidebarRunRow(run: run, now: now, indent: indent, isSelected: state.selectedRunID == run.id) {
            state.selectedRunID = run.id
        }
    }

    // MARK: Ajustes

    /// A plain row; its tooltip says which folder the app reads.
    private func footer(_ directory: DataDirectory) -> some View {
        let path = (directory.url.path as NSString).abbreviatingWithTildeInPath
        return Button(action: openSettings) {
            NavRow(isSelected: false) {
                Text("Ajustes")
                    .font(theme.font(.body, size: 14))
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .buttonStyle(.plain)
        .help("lee \(path)")
        .accessibilityLabel("Ajustes")
        .accessibilityHint("Lee los runs de \(path)")
    }
}

/// "Operación | Planificación" as a segmented control. Operación carries the count of runs waiting on the person
/// (the same as "Te esperan"), so it is seen from Planificación too; at 0 there is no badge.
private struct SidebarTabs: View {
    @Binding var tab: PlanningTab
    let waiting: Int

    @Environment(\.theme) private var theme

    var body: some View {
        HStack(spacing: 2) {
            segment("Operación", .operation, badge: waiting)
            segment("Planificación", .planning, badge: 0)
        }
        .padding(3)
        .themeFrame(theme, fill: theme.field) { picker in
            picker
                .background(theme.field, in: RoundedRectangle(cornerRadius: theme.r(9)))
                .overlay(RoundedRectangle(cornerRadius: theme.r(9)).strokeBorder(theme.border, lineWidth: 1))
        }
        .padding(.horizontal, 4)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Vista")
    }

    private func segment(_ title: String, _ value: PlanningTab, badge: Int) -> some View {
        let isOn = tab == value
        let waitingStyle = theme.style(.waitingUser)
        return Button {
            tab = value
        } label: {
            HStack(spacing: 6) {
                Text(title)
                    .font(theme.font(.body, size: 13, weight: isOn ? .semibold : .medium))
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
                if badge > 0 {
                    Text("\(badge)")
                        .font(theme.font(.body, size: 10.5, weight: .bold).monospacedDigit())
                        .foregroundStyle(waitingStyle.badgeText)
                        .padding(.horizontal, 4)
                        .frame(minWidth: 16, minHeight: 16)
                        .background(waitingStyle.badge, in: Capsule())
                }
            }
            .foregroundStyle(isOn ? theme.title : theme.muted)
            .frame(maxWidth: .infinity, minHeight: 28)
            .background(isOn ? theme.track : .clear, in: RoundedRectangle(cornerRadius: theme.r(7)))
            .contentShape(RoundedRectangle(cornerRadius: theme.r(7)))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(badge > 0 ? "\(title), \(badge) te esperan" : title)
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }
}

/// "Te esperan · 3", "Proyectos": small, in the display font.
struct SectionHeading: View {
    let title: String

    @Environment(\.theme) private var theme

    var body: some View {
        Text(title)
            .font(theme.font(.display, size: 12, weight: .semibold))
            .tracking(theme.tracking(.display, size: 12))
            .foregroundStyle(theme.faint)
            .lineLimit(1)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .accessibilityAddTraits(.isHeader)
    }
}

/// A sidebar row: at least 36 pt tall, white on a subtle background with a 1 pt border when chosen, lighter when
/// hovered.
struct NavRow<Content: View>: View {
    let isSelected: Bool
    @ViewBuilder let content: Content

    @State private var isHovered = false
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(spacing: 9) {
            content
        }
        .foregroundStyle(isSelected || isHovered ? theme.title : theme.secondary)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .frame(minHeight: 36)
        .background(background, in: RoundedRectangle(cornerRadius: theme.r(8)))
        .overlay(
            RoundedRectangle(cornerRadius: theme.r(8))
                .strokeBorder(isSelected ? theme.borderHover : .clear, lineWidth: 1)
        )
        .contentShape(RoundedRectangle(cornerRadius: theme.r(8)))
        .onHover { isHovered = $0 }
    }

    private var background: Color {
        if isSelected { return theme.selection }
        return isHovered ? theme.surfaceHover : .clear
    }
}

/// "Todos" (no icon) or a project with the theme's project icon, and its active runs.
private struct ProjectRow: View {
    let icon: ThemeIcon?
    let title: String
    let count: Int
    let isSelected: Bool
    let pick: () -> Void

    @Environment(\.theme) private var theme

    var body: some View {
        Button(action: pick) {
            NavRow(isSelected: isSelected) {
                if let icon {
                    ThemeIconView(icon: icon, color: theme.faint, size: 20)
                }
                Text(title)
                    .font(theme.font(.body, size: 14, weight: icon == nil || isSelected ? .semibold : .regular))
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text("\(count)")
                    .font(theme.font(.body, size: icon == nil ? 14 : 13, weight: icon == nil ? .semibold : .regular)
                        .monospacedDigit())
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(title), \(count) activos")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

/// A run waiting on the person, or one nested under the chosen project: its status bullet and its title.
private struct SidebarRunRow: View {
    let run: Run
    let now: TimeInterval
    let indent: CGFloat
    let isSelected: Bool
    let select: () -> Void

    @Environment(\.theme) private var theme

    var body: some View {
        let status = effectiveStatus(run, now: now)
        Button(action: select) {
            NavRow(isSelected: isSelected) {
                bullet(theme.dot(status))
                Text(run.displayTitle)
                    .font(theme.font(.body, size: 14))
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.leading, indent)
        }
        .buttonStyle(.plain)
        .help(run.displayTitle)
        .accessibilityLabel(run.displayTitle)
        .accessibilityValue(status.label(run.lang))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    @ViewBuilder
    private func bullet(_ color: Color) -> some View {
        switch theme.spec.shapes.bullet {
        case .gem:
            Gem(color: color)
        case .dot:
            Circle()
                .fill(color)
                .frame(width: 7, height: 7)
                .frame(width: 8, height: 8)
        }
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
