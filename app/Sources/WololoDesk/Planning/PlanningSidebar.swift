import SwiftUI
import WololoKit

/// The sidebar on Planificación: "Proyectos" with a "+" for a new project, and under each project its goals with their
/// progress ("2/7" and a bar) and a "+ Objetivo". The chosen goal is drawn on the selection background.
struct PlanningSidebar: View {
    @Bindable var state: AppState

    @Environment(\.theme) private var theme

    var body: some View {
        let model = state.model
        let projects = state.projects
        let runs = RunIndex(runs: model.runs)
        VStack(alignment: .leading, spacing: 6) {
            header
            if projects.isEmpty {
                Text("Todavía no hay proyectos. Tocá + para agregar uno, o arrancá un run y aparece solo.")
                    .font(theme.font(.body, size: 13))
                    .foregroundStyle(theme.faint)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 6)
                Spacer(minLength: 0)
            } else {
                ScrollView(.vertical) {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(projects) { project in
                            projectSection(project, runs: runs, now: model.now)
                        }
                    }
                }
                .scrollIndicators(.never)
            }
        }
        .frame(maxHeight: .infinity, alignment: .top)
    }

    private var header: some View {
        HStack(spacing: 8) {
            SectionHeading(title: "Proyectos")
                .frame(maxWidth: .infinity, alignment: .leading)
            Button {
                // The new project sheet comes with the project editing.
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(theme.secondary)
                    .frame(width: 22, height: 22)
                    .background(theme.field, in: RoundedRectangle(cornerRadius: theme.r(6)))
                    .overlay(RoundedRectangle(cornerRadius: theme.r(6)).strokeBorder(theme.border, lineWidth: 1))
                    .contentShape(RoundedRectangle(cornerRadius: theme.r(6)))
            }
            .buttonStyle(.plain)
            .help("Nuevo proyecto")
            .accessibilityLabel("Nuevo proyecto")
        }
        .padding(.trailing, 8)
    }

    private func projectSection(_ project: PlanningProject, runs: RunIndex, now: TimeInterval) -> some View {
        let goals = state.goals.filter { $0.projectID == project.id }
        let repo = defaultRepo(for: project)
        return VStack(alignment: .leading, spacing: 2) {
            Button {
                state.selectProject(project.id)
            } label: {
                NavRow(isSelected: state.selectedProjectID == project.id && state.selectedGoalID == nil) {
                    ThemeIconView(icon: theme.spec.shapes.projectIcon, color: theme.faint, size: 18)
                    Text(project.name)
                        .font(theme.font(.body, size: 14, weight: .semibold))
                        .foregroundStyle(theme.title)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if let repo {
                        Text(repo)
                            .font(theme.font(.mono, size: 11))
                            .foregroundStyle(theme.faint)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                }
            }
            .buttonStyle(.plain)
            .help(project.path.isEmpty ? project.name : project.path)
            .accessibilityLabel(repo.map { "\(project.name), \($0)" } ?? project.name)
            .accessibilityAddTraits(state.selectedProjectID == project.id && state.selectedGoalID == nil ? .isSelected : [])

            ForEach(goals) { goal in
                let status = goal.status(defaultRepo: repo, runs: runs, now: now)
                GoalRow(goal: goal, done: status.done, total: status.total, fraction: status.fraction,
                        isSelected: state.selectedGoalID == goal.id) {
                    state.selectedProjectID = project.id
                    state.selectedGoalID = goal.id
                }
                .padding(.leading, 22)
            }

            Button {
                state.createGoal(in: project.id)
            } label: {
                Text("+ Objetivo")
                    .font(theme.font(.body, size: 12.5))
                    .foregroundStyle(theme.accent)
                    .frame(minHeight: 24)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.leading, 30)
            .help("Crear un objetivo en \(project.name)")
            .accessibilityLabel("Nuevo objetivo en \(project.name)")
        }
    }
}

/// A goal: its title, "done/total" and a thin progress bar under it.
private struct GoalRow: View {
    let goal: Goal
    let done: Int
    let total: Int
    let fraction: Double
    let isSelected: Bool
    let select: () -> Void

    @State private var isHovered = false
    @Environment(\.theme) private var theme

    var body: some View {
        Button(action: select) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Image(systemName: "scope")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(isSelected ? theme.accent : theme.faint)
                        .frame(width: 14)
                        .accessibilityHidden(true)
                    Text(goal.title.isEmpty ? "Sin título" : goal.title)
                        .font(theme.font(.body, size: 13.5, weight: isSelected ? .semibold : .regular))
                        .foregroundStyle(isSelected || isHovered ? theme.title : theme.secondary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text("\(done)/\(total)")
                        .font(theme.font(.body, size: 12).monospacedDigit())
                        .foregroundStyle(theme.muted)
                }
                GeometryReader { proxy in
                    ZStack(alignment: .leading) {
                        Capsule().fill(theme.track)
                        Capsule()
                            .fill(theme.style(.done).color)
                            .frame(width: proxy.size.width * min(max(fraction, 0), 1))
                    }
                }
                .frame(height: 4)
                .padding(.leading, 22)
            }
            .padding(8)
            .background(background, in: RoundedRectangle(cornerRadius: theme.r(8)))
            .overlay(
                RoundedRectangle(cornerRadius: theme.r(8))
                    .strokeBorder(isSelected ? theme.borderHover : .clear, lineWidth: 1)
            )
            .contentShape(RoundedRectangle(cornerRadius: theme.r(8)))
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
        .help(goal.title)
        .accessibilityLabel(goal.title.isEmpty ? "Sin título" : goal.title)
        .accessibilityValue("\(done) de \(total) pasos hechos")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var background: Color {
        if isSelected { return theme.selection }
        return isHovered ? theme.surfaceHover : .clear
    }
}
