import Foundation
import Observation

/// The goals and projects the app has open, and when they are written: a structural change at once, a text edit
/// `textSaveDelay` after the last keystroke (so typing doesn't write a file per key), and whatever is still waiting
/// when `flush` is called. A failure is passed to `report` and what changed stays on screen.
@MainActor
@Observable
public final class GoalSession {
    public private(set) var goals: [Goal] = []
    /// The projects written to `projects.json`.
    public private(set) var storedProjects: [PlanningProject] = []
    /// `projects.json` is there but can't be read: the projects are never saved over it.
    public private(set) var projectsUnreadable = false
    /// Goal files that are there but can't be read, by id.
    public private(set) var unreadableGoalIDs: Set<String> = []

    @ObservationIgnored public private(set) var store: GoalStore
    /// Called with the lines to tell the person when something can't be read or written.
    @ObservationIgnored public var report: ([String]) -> Void = { _ in }
    @ObservationIgnored public let textSaveDelay: Duration
    @ObservationIgnored private let clock: () -> TimeInterval
    /// Goals whose text changed and are saved `textSaveDelay` after the last change, by id.
    @ObservationIgnored private var pendingTextSaves: [String: Task<Void, Never>] = [:]

    public init(store: GoalStore, textSaveDelay: Duration = .milliseconds(500),
                clock: @escaping () -> TimeInterval = { Date().timeIntervalSince1970 }) {
        self.store = store
        self.textSaveDelay = textSaveDelay
        self.clock = clock
    }

    public var hasPendingSaves: Bool { !pendingTextSaves.isEmpty }

    public func goal(id: String) -> Goal? {
        goals.first { $0.id == id }
    }

    /// Brings in the copy's goals this machine doesn't have, then reads the goals and projects. A `projects.json` that
    /// can't be read is reported once, not on every load while it stays that way.
    public func load() {
        let imported = store.importMirror()
        let snapshot = store.load().merging(imported: imported)
        storedProjects = snapshot.projects
        goals = snapshot.goals
        unreadableGoalIDs = snapshot.unreadableGoalIDs
        if snapshot.projectsUnreadable && !projectsUnreadable {
            report(["No pude leer projects.json", "Tus proyectos no se van a guardar hasta que se arregle"])
        }
        projectsUnreadable = snapshot.projectsUnreadable
    }

    /// Saves what is waiting with the store in use, then reads everything again from `store`.
    public func replaceStore(_ store: GoalStore) {
        flush()
        self.store = store
        load()
    }

    /// A new goal in the project, with only its final node, saved. A project that so far only came from the runs is
    /// saved first, so the goal has a project to come back to; when that save fails (and not just because
    /// `projects.json` can't be read, which is reported once already) there is no goal, nil, and it is reported.
    @discardableResult
    public func createGoal(in project: PlanningProject, title: String = "Objetivo nuevo") -> Goal? {
        if !isStored(project, in: storedProjects), !saveProjects(upserting(project, into: storedProjects)),
           !projectsUnreadable {
            report(["No creé el objetivo: no pude guardar su proyecto"])
            return nil
        }
        let goal = Goal(id: UUID().uuidString.lowercased(), projectID: project.id, title: title, updatedAt: clock())
        goals.append(goal)
        save(goal)
        return self.goal(id: goal.id) ?? goal
    }

    /// A structural change (a node added, moved, connected or removed): saved now, with any text edit pending for
    /// the goal folded in.
    public func update(_ goal: Goal) {
        pendingTextSaves.removeValue(forKey: goal.id)?.cancel()
        replace(goal)
        save(goal)
    }

    /// A text edit (a title, a description, an issue): shown now and saved `textSaveDelay` after the last one.
    public func updateText(_ goal: Goal) {
        replace(goal)
        pendingTextSaves.removeValue(forKey: goal.id)?.cancel()
        let id = goal.id
        let delay = textSaveDelay
        pendingTextSaves[id] = Task { @MainActor [weak self] in
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled, let self else { return }
            self.pendingTextSaves.removeValue(forKey: id)
            if let latest = self.goal(id: id) { self.save(latest) }
        }
    }

    /// Saves every text edit still waiting, as the app quits or the store changes.
    public func flush() {
        let ids = Array(pendingTextSaves.keys)
        for id in ids {
            pendingTextSaves.removeValue(forKey: id)?.cancel()
            if let goal = goal(id: id) { save(goal) }
        }
    }

    /// Removes the goal and its copy. If its file can't be removed it is reported, stays on screen and this returns
    /// false.
    @discardableResult
    public func deleteGoal(id: String) -> Bool {
        pendingTextSaves.removeValue(forKey: id)?.cancel()
        do {
            try store.delete(goalID: id)
        } catch {
            report(["No pude borrar el objetivo", error.localizedDescription])
            return false
        }
        goals.removeAll { $0.id == id }
        return true
    }

    /// Removes a project and its goals (`projectRemoving`): each goal as `deleteGoal` does, then `projects.json` without
    /// the project. It stops at the first goal it can't remove, before touching the projects, and returns false; so
    /// does it, without removing anything, while `projects.json` can't be read. A project whose runs are still around
    /// comes back as a derived project, without goals.
    @discardableResult
    public func deleteProject(id: String) -> Bool {
        guard !projectsUnreadable else {
            report(["No borré el proyecto: projects.json no se puede leer"])
            return false
        }
        let removal = projectRemoving(id: id, from: storedProjects, goals: goals)
        for goalID in removal.goalIDs {
            guard deleteGoal(id: goalID) else { return false }
        }
        guard storedProjects.contains(where: { $0.id == id }) else { return true }
        return saveProjects(removal.projects)
    }

    /// Replaces the stored projects and writes `projects.json`. While the one on disk can't be read the change stays
    /// on screen only, so the projects in that file aren't lost; a write that fails leaves the stored projects as they
    /// were. Returns whether `projects.json` was written.
    @discardableResult
    public func saveProjects(_ projects: [PlanningProject]) -> Bool {
        guard !projectsUnreadable else {
            storedProjects = projects
            report(["No guardé los proyectos: projects.json no se puede leer"])
            return false
        }
        do {
            try store.saveProjects(projects, at: clock())
        } catch {
            report(["No pude guardar los proyectos", error.localizedDescription])
            return false
        }
        storedProjects = projects
        return true
    }

    private func replace(_ goal: Goal) {
        if let index = goals.firstIndex(where: { $0.id == goal.id }) {
            goals[index] = goal
        } else {
            goals.append(goal)
        }
    }

    /// Stamps the goal with the time and writes it; a failure is reported and the goal stays on screen.
    private func save(_ goal: Goal) {
        var stamped = goal
        stamped.updatedAt = clock()
        if let index = goals.firstIndex(where: { $0.id == goal.id }) { goals[index].updatedAt = stamped.updatedAt }
        do {
            try store.save(stamped)
        } catch {
            report(["No pude guardar el objetivo", error.localizedDescription])
        }
    }
}
