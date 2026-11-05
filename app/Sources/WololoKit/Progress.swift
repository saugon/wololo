import Foundation

public enum ProgressRole: String, Sendable {
    case waiting
    case working
    case onHold
    case finished
    case failed
}

public struct RunProgress: Equatable, Sendable {
    public let fraction: Double
    /// 1-based, as shown in `n/8`.
    public let stageNumber: Int
    public let stageCount: Int
    public let stageLabel: String
    public let role: ProgressRole
    public let lang: Lang

    public init(_ run: Run, now: TimeInterval) {
        let status = effectiveStatus(run, now: now)
        let index = stageIndex(run)
        let stage = Stage.all[index]
        stageCount = Stage.all.count
        stageNumber = index + 1
        stageLabel = stage.label(run.lang)
        lang = run.lang

        if status == .done {
            fraction = 1
        } else {
            let partial = stage.id == "implement" && run.items.total > 0
                ? min(max(Double(run.items.done) / Double(run.items.total), 0), 1)
                : 0.5
            fraction = (Double(index) + partial) / Double(stageCount)
        }

        switch StatusGroup(status) {
        case .waiting: role = .waiting
        case .working: role = .working
        case .onHold: role = .onHold
        case .finished: role = status == .failed ? .failed : .finished
        }
    }

    public var shortText: String { "\(stageNumber)/\(stageCount)" }

    public var text: String { "\(shortText) · \(stageLabel)" }

    public var accessibilityLabel: String {
        lang == .es
            ? "Etapa \(stageNumber) de \(stageCount): \(stageLabel)"
            : "Stage \(stageNumber) of \(stageCount): \(stageLabel)"
    }
}
