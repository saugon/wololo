import Foundation

public struct StageRow: Equatable, Sendable, Identifiable {
    public enum State: Equatable, Sendable {
        case done
        case current
        case pending
    }

    public let id: String
    public let label: String
    public let isGate: Bool
    public let state: State
    /// Time spent in the stage, adding up every time it was entered. Nil while it is pending.
    public let elapsed: TimeInterval?
    /// The gate's outcome ("aprobado por vos", "pasó solo", "cambios pedidos", "te espera"), for gates with a record.
    public let note: String?

    public var durationText: String { elapsed.map(duration) ?? "" }
}

/// The eight stages with their state, as the mockup draws them: before the current one they are done, the current
/// one is done only when the run finished well, the rest pending. Durations come from `stages[]`.
public func stageRows(_ run: Run, now: TimeInterval) -> [StageRow] {
    let current = run.stage.map { Stage.index(of: $0.id) ?? $0.index } ?? -1
    let finishedWell = run.status == .done || run.outcome == "done"
    let end = run.finishedAt ?? now
    return Stage.all.enumerated().map { index, stage in
        let state: StageRow.State
        if index < current || (finishedWell && index == current) {
            state = .done
        } else if index == current {
            state = .current
        } else {
            state = .pending
        }
        let entries = run.stages.filter { $0.id == stage.id }
        var elapsed: TimeInterval?
        if state != .pending, !entries.isEmpty {
            elapsed = entries.reduce(0) { sum, entry in sum + max(0, (entry.finishedAt ?? end) - entry.startedAt) }
        }
        let note = stage.isGate ? run.gates[stage.id].map { gateNote($0, lang: run.lang) } : nil
        return StageRow(id: stage.id, label: stage.label(run.lang), isGate: stage.isGate, state: state, elapsed: elapsed, note: note)
    }
}

public struct RunDocument: Equatable, Sendable, Identifiable {
    public let name: String
    public let url: URL

    public var id: String { name }
}

/// The documents the Documents tab offers, in the order a run writes them.
public let runDocumentNames = ["source.md", "context.md", "spec.md", "plan.md", "log.md", "summary.md"]

/// Only the documents that exist in the run's directory.
public func runDocuments(runDir: URL) -> [RunDocument] {
    runDocumentNames.compactMap { name in
        let url = runDir.appendingPathComponent(name)
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory), !isDirectory.boolValue else { return nil }
        return RunDocument(name: name, url: url)
    }
}

public struct CostRow: Equatable, Sendable, Identifiable {
    public let id: String
    public let label: String
    public var work: TimeInterval = 0
    public var agents: TimeInterval = 0
    public var tests: TimeInterval = 0
    public var you: TimeInterval = 0
    public var paused: TimeInterval = 0
    public var usd: Double = 0
    public var tokens = 0

    init(id: String, label: String) {
        self.id = id
        self.label = label
    }

    mutating func add(_ other: CostRow) {
        work += other.work
        agents += other.agents
        tests += other.tests
        you += other.you
        paused += other.paused
        usd += other.usd
        tokens += other.tokens
    }
}

public struct CostTable: Equatable, Sendable {
    public let rows: [CostRow]
    public let total: CostRow
}

/// Time and cost per stage from the run's `time` and `usage`, in stage order, with their totals.
/// Only stages that have either; a stage id the app does not know goes last, under its raw id.
public func costTable(_ run: Run) -> CostTable {
    let known = Stage.all.map(\.id)
    let unknown = Set(run.time.keys).union(run.usage.keys).subtracting(known).sorted()
    var rows: [CostRow] = []
    var total = CostRow(id: "total", label: "Total")
    for id in known + unknown {
        let time = run.time[id]
        let usage = run.usage[id]
        guard time != nil || usage != nil else { continue }
        var row = CostRow(id: id, label: Stage.label(of: id, run.lang))
        if let time {
            row.work = time.work
            row.agents = time.agents
            row.tests = time.tests
            row.you = time.you
            row.paused = time.paused
        }
        if let usage {
            row.usd = usage.usd
            row.tokens = usage.tokens
        }
        rows.append(row)
        total.add(row)
    }
    return CostTable(rows: rows, total: total)
}

/// Where a screenshot's image is. The mod stores `screenshots/<file>`, relative to the run's directory;
/// a bare file name is looked up in `screenshots/`, and an absolute path is taken as is.
public func screenshotURL(_ shot: Run.Screenshot, runDir: URL) -> URL? {
    let file = shot.file.trimmingCharacters(in: .whitespaces)
    guard !file.isEmpty else { return nil }
    if file.hasPrefix("/") { return URL(fileURLWithPath: file) }
    let relative = file.contains("/") ? file : "screenshots/\(file)"
    return runDir.appendingPathComponent(relative).standardizedFileURL
}
