import Foundation

/// Where goals live: one `<id>.json` per goal and a `projects.json`, in a folder only the app writes to (the source of
/// truth). Every save also leaves the same bytes in `<data>/goals/`, the copy wololo's data directory carries to
/// another machine; `importMirror` brings back from there the goals this machine doesn't have yet.
///
/// The file IO is synchronous: goal files are small and the app calls the store from the main actor.
public struct GoalStore: Sendable {
    public enum Failure: Error, Equatable {
        case invalidGoal(String)
        /// `projects.json` is there but can't be read (damaged, or written by a newer app): saving over it would lose
        /// the projects it holds.
        case unreadableProjectsFile
    }

    public static let projectsFileName = "projects.json"

    /// The source of truth: `~/Library/Application Support/Wololo Desk/Goals` in the app.
    public let directory: URL
    /// `<data>/goals`, or nil to keep no copy. It is only written while the data directory itself exists.
    public let mirror: URL?
    /// With `writes: false` (snapshots) nothing touches the disk: saving, deleting and importing only read.
    public let writes: Bool
    private let log: @Sendable (String) -> Void

    public init(directory: URL, mirror: URL?, writes: Bool, log: @escaping @Sendable (String) -> Void = { _ in }) {
        self.directory = directory
        self.mirror = mirror
        self.writes = writes
        self.log = log
    }

    /// `~/Library/Application Support/Wololo Desk/Goals`. It may not exist yet.
    public static func defaultDirectory() -> URL {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support")
        return support.appendingPathComponent("Wololo Desk/Goals", isDirectory: true)
    }

    public static func mirrorDirectory(dataDirectory: URL) -> URL {
        dataDirectory.appendingPathComponent("goals", isDirectory: true)
    }

    // MARK: - Reading

    /// Every project and goal in the source of truth. A file that can't be read or decoded is skipped, logged and
    /// reported in the snapshot, so the caller can tell it from one that isn't there.
    public func load() -> GoalStoreSnapshot {
        read(directory)
    }

    // MARK: - Writing

    /// Writes `<id>.json` and its copy. The goal is written as it is: the caller stamps `updatedAt` before saving.
    public func save(_ goal: Goal) throws {
        guard Goal.isValidID(goal.id) else { throw Failure.invalidGoal("A goal needs an id that can name its file") }
        guard !goal.projectID.isEmpty else { throw Failure.invalidGoal("A goal needs a project") }
        guard writes else { return }
        try write(goal.encoded(), named: "\(goal.id).json")
    }

    /// Writes `projects.json`, stamped with `now`, and its copy. It refuses while the local `projects.json` can't be
    /// read, so the projects in it aren't lost. The copy also keeps the projects only it has that a goal in the copy
    /// still uses: those of goals another machine wrote that this one hasn't imported yet. While a goal in the copy
    /// can't be read it keeps all of them, since that goal may use any; while the copy's `projects.json` can't be read
    /// the copy isn't written at all.
    public func saveProjects(_ projects: [PlanningProject], at now: TimeInterval) throws {
        guard writes else { return }
        guard !readProjects(in: directory).unreadable else { throw Failure.unreadableProjectsFile }
        let data = try PlanningProjectsFile(updatedAt: now, projects: projects).encoded()
        var mirrorData: Data?
        if let mirror = writableMirror() {
            let remote = read(mirror)
            guard !remote.projectsUnreadable else {
                log("Did not copy \(Self.projectsFileName) to \(mirror.path): the one there can't be read")
                try writeAtomically(data, to: directory.appendingPathComponent(Self.projectsFileName))
                return
            }
            let localIDs = Set(projects.map(\.id))
            let usedIDs = Set(remote.goals.map(\.projectID))
            let keepsAll = !remote.unreadableGoalIDs.isEmpty
            let kept = remote.projects.filter { !localIDs.contains($0.id) && (keepsAll || usedIDs.contains($0.id)) }
            if !kept.isEmpty {
                mirrorData = try PlanningProjectsFile(updatedAt: now, projects: projects + kept).encoded()
            }
        }
        try write(data, mirrorData: mirrorData, named: Self.projectsFileName)
    }

    /// Removes the copy of the goal, then the goal. A file that is already gone (or a copy folder that isn't there or
    /// isn't a folder) is fine. If the copy is there but can't be removed the goal stays: removing only the local one
    /// would bring it back on the next import.
    public func delete(goalID: String) throws {
        guard Goal.isValidID(goalID) else { throw Failure.invalidGoal("A goal needs an id that can name its file") }
        guard writes else { return }
        let name = "\(goalID).json"
        if let copy = mirror?.appendingPathComponent(name), FileManager.default.fileExists(atPath: copy.path) {
            try remove(copy)
        }
        try remove(directory.appendingPathComponent(name))
    }

    /// Removes a project: its goals (`goalIDs`), then `projects.json` saved with `projects` minus it. It stops at the
    /// first goal it can't remove, before touching the projects.
    public func deleteProject(id: String, goalIDs: [String], remaining projects: [PlanningProject],
                              at now: TimeInterval) throws {
        for goalID in goalIDs {
            try delete(goalID: goalID)
        }
        try saveProjects(projects.filter { $0.id != id }, at: now)
    }

    /// The goals in the copy whose id this machine doesn't have, and the projects that the goals it imports or already
    /// has need and it doesn't have (so a project that failed to save is retried on the next import). They are written to the source of truth (unless `writes` is false), so they are this machine's from now
    /// on. A goal that has a file locally is never touched, even if that file can't be read; unreadable files in the
    /// copy are ignored. While the local `projects.json` can't be read the projects are returned but not written.
    public func importMirror() -> (projects: [PlanningProject], goals: [Goal]) {
        guard let mirror else { return ([], []) }
        let local = load()
        let remote = read(mirror)
        let localGoalIDs = goalFileIDs(in: directory)
        let localProjectIDs = Set(local.projects.map(\.id))
        let goals = remote.goals.filter { !localGoalIDs.contains($0.id) }

        var imported: [Goal] = []
        if writes {
            for goal in goals {
                do {
                    try writeAtomically(goal.encoded(), to: directory.appendingPathComponent("\(goal.id).json"))
                    imported.append(goal)
                } catch {
                    log("Could not import goal \(goal.id): \(error.localizedDescription)")
                }
            }
        } else {
            imported = goals
        }
        // Every goal kept here counts, not only those imported now: a project that couldn't be saved last time is
        // asked for again until it is.
        let neededProjectIDs = Set((local.goals + imported).map(\.projectID)).subtracting(localProjectIDs)
        let projects = remote.projects.filter { neededProjectIDs.contains($0.id) }
        guard writes, !projects.isEmpty else { return (projects, imported) }
        guard !local.projectsUnreadable else {
            log("Did not save the projects of the copied goals: \(Self.projectsFileName) can't be read")
            return (projects, imported)
        }
        do {
            let updatedAt = max(projectsFile(in: directory)?.updatedAt ?? 0, projectsFile(in: mirror)?.updatedAt ?? 0)
            let file = PlanningProjectsFile(updatedAt: updatedAt, projects: local.projects + projects)
            try writeAtomically(file.encoded(), to: directory.appendingPathComponent(Self.projectsFileName))
            return (projects, imported)
        } catch {
            log("Could not import the projects of the copied goals: \(error.localizedDescription)")
            return ([], imported)
        }
    }

    // MARK: - Files

    private func read(_ folder: URL) -> GoalStoreSnapshot {
        let projects = readProjects(in: folder)
        var snapshot = GoalStoreSnapshot(projects: projects.file?.projects ?? [], goals: [],
                                         projectsUnreadable: projects.unreadable, unreadableGoalIDs: [])
        for id in goalFileIDs(in: folder).sorted() {
            let file = folder.appendingPathComponent("\(id).json")
            do {
                let goal = try Goal.decode(from: Data(contentsOf: file))
                // Saving writes a goal under its id, so one filed under another name would end up twice.
                guard goal.id == id else {
                    log("Skipped \(file.path): it holds goal \(goal.id)")
                    snapshot.unreadableGoalIDs.insert(id)
                    continue
                }
                snapshot.goals.append(goal)
            } catch {
                log("Skipped \(file.path): \(error.localizedDescription)")
                snapshot.unreadableGoalIDs.insert(id)
            }
        }
        return snapshot
    }

    /// The ids of the goal files in `folder`, from their names alone: whether they can be read doesn't matter.
    private func goalFileIDs(in folder: URL) -> Set<String> {
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: folder.path) else { return [] }
        return Set(names.compactMap { name -> String? in
            guard name.hasSuffix(".json"), name != Self.projectsFileName else { return nil }
            let id = String(name.dropLast(".json".count))
            return Goal.isValidID(id) ? id : nil
        })
    }

    /// The `projects.json` in `folder`, or nil with `unreadable` set when it is there but can't be read or decoded.
    private func readProjects(in folder: URL) -> (file: PlanningProjectsFile?, unreadable: Bool) {
        let file = folder.appendingPathComponent(Self.projectsFileName)
        guard FileManager.default.fileExists(atPath: file.path) else { return (nil, false) }
        do {
            return (try PlanningProjectsFile.decode(from: Data(contentsOf: file)), false)
        } catch {
            log("Skipped \(file.path): \(error.localizedDescription)")
            return (nil, true)
        }
    }

    private func projectsFile(in folder: URL) -> PlanningProjectsFile? {
        readProjects(in: folder).file
    }

    /// The copy's folder, while the data directory it lives in exists.
    private func writableMirror() -> URL? {
        guard let mirror else { return nil }
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: mirror.deletingLastPathComponent().path, isDirectory: &isDirectory),
              isDirectory.boolValue
        else { return nil }
        return mirror
    }

    /// Writes the source of truth, then the copy (`mirrorData`, or the same bytes). The copy is only written while the
    /// data directory exists, and a failure there is logged: it never stops a save.
    private func write(_ data: Data, mirrorData: Data? = nil, named name: String) throws {
        try writeAtomically(data, to: directory.appendingPathComponent(name))
        guard let mirror = writableMirror() else { return }
        do {
            try writeAtomically(mirrorData ?? data, to: mirror.appendingPathComponent(name))
        } catch {
            log("Could not copy \(name) to \(mirror.path): \(error.localizedDescription)")
        }
    }

    /// Like `RunDiscard`: a staging file renamed into place, so a reader never sees half a file.
    private func writeAtomically(_ data: Data, to file: URL) throws {
        let folder = file.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let staging = folder.appendingPathComponent("\(file.lastPathComponent).desk-\(UUID().uuidString.prefix(6)).tmp")
        do {
            try data.write(to: staging)
        } catch {
            try? FileManager.default.removeItem(at: staging)
            throw error
        }
        guard rename(staging.path, file.path) == 0 else {
            let code = errno
            try? FileManager.default.removeItem(at: staging)
            throw CocoaError(.fileWriteUnknown, userInfo: [NSFilePathErrorKey: file.path,
                                                           NSUnderlyingErrorKey: POSIXError(POSIXErrorCode(rawValue: code) ?? .EIO)])
        }
    }

    private func remove(_ file: URL) throws {
        do {
            try FileManager.default.removeItem(at: file)
        } catch let error as CocoaError where error.code == .fileNoSuchFile {
            return
        }
    }
}

extension GoalStore {
    public static let directoryEnvironmentKey = "WOLOLO_DESK_GOALS_DIR"

    /// Where the app keeps the goals: `WOLOLO_DESK_GOALS_DIR`, else for a snapshot an empty folder that isn't there
    /// (a snapshot never reads the person's goals), else `standard`.
    public static func directory(options: LaunchOptions, standard: @autoclosure () -> URL = defaultDirectory()) -> URL {
        if let chosen = options.goalsDirectory { return chosen }
        if options.snapshotURL != nil {
            return FileManager.default.temporaryDirectory
                .appendingPathComponent("wololo-desk-snapshot-\(UUID().uuidString)/Goals", isDirectory: true)
        }
        return standard()
    }

    /// Whether the app writes goals to disk. Never in a snapshot (`persists: false`). On the sample data only into a
    /// folder chosen with `WOLOLO_DESK_GOALS_DIR`: otherwise its goal would be imported into the person's own goals.
    public static func writesGoals(persists: Bool, dataDirectory: URL, options: LaunchOptions) -> Bool {
        guard persists else { return false }
        return options.goalsDirectory != nil || !DataDirectory.isSampleData(dataDirectory)
    }
}

/// What `GoalStore.load` found. A file that is there but can't be read shows up in `projectsUnreadable` or
/// `unreadableGoalIDs` rather than looking like it isn't there.
public struct GoalStoreSnapshot: Equatable, Sendable {
    public var projects: [PlanningProject]
    public var goals: [Goal]
    public var projectsUnreadable: Bool
    public var unreadableGoalIDs: Set<String>

    public init(projects: [PlanningProject] = [], goals: [Goal] = [], projectsUnreadable: Bool = false,
                unreadableGoalIDs: Set<String> = []) {
        self.projects = projects
        self.goals = goals
        self.projectsUnreadable = projectsUnreadable
        self.unreadableGoalIDs = unreadableGoalIDs
    }
}

extension GoalStoreSnapshot {
    /// What the app shows at launch: the loaded goals and projects plus what `importMirror` returned, each id once.
    /// A store that writes has already put the imported files into the folder `load` read, and one that doesn't
    /// (snapshots) hasn't, so imported entries whose id was loaded are dropped and the loaded one is kept.
    public func merging(imported: (projects: [PlanningProject], goals: [Goal])) -> GoalStoreSnapshot {
        var merged = self
        var projectIDs = Set(projects.map(\.id))
        for project in imported.projects where projectIDs.insert(project.id).inserted {
            merged.projects.append(project)
        }
        var goalIDs = Set(goals.map(\.id))
        for goal in imported.goals where goalIDs.insert(goal.id).inserted {
            merged.goals.append(goal)
        }
        return merged
    }
}
