import Foundation

public let orphanAfterSeconds: TimeInterval = 90

public enum RunStatus: Hashable, Sendable {
    case running
    case waitingUser
    case waitingPermission
    case waitingAgents
    case waitingCI
    case waitingTests
    case blocked
    case stalled
    case pausing
    case paused
    case orphaned
    case done
    case failed
    case cancelled
    case unknown(String)

    public static let known: [RunStatus] = [
        .running, .waitingUser, .waitingPermission, .waitingAgents, .waitingCI, .waitingTests, .blocked,
        .stalled, .pausing, .paused, .orphaned, .done, .failed, .cancelled,
    ]

    public init(rawValue: String) {
        self = Self.known.first { $0.rawValue == rawValue } ?? .unknown(rawValue)
    }

    public var rawValue: String {
        switch self {
        case .running: return "running"
        case .waitingUser: return "waiting_user"
        case .waitingPermission: return "waiting_permission"
        case .waitingAgents: return "waiting_agents"
        case .waitingCI: return "waiting_ci"
        case .waitingTests: return "waiting_tests"
        case .blocked: return "blocked"
        case .stalled: return "stalled"
        case .pausing: return "pausing"
        case .paused: return "paused"
        case .orphaned: return "orphaned"
        case .done: return "done"
        case .failed: return "failed"
        case .cancelled: return "cancelled"
        case .unknown(let raw): return raw
        }
    }

    public var isTerminal: Bool {
        self == .done || self == .failed || self == .cancelled
    }

    public var isWaitingOnPerson: Bool {
        self == .waitingUser || self == .waitingPermission || self == .blocked || self == .stalled
    }
}

extension RunStatus: Decodable {
    public init(from decoder: Decoder) throws {
        self.init(rawValue: try decoder.singleValueContainer().decode(String.self))
    }
}

public func effectiveStatus(_ run: Run, now: TimeInterval) -> RunStatus {
    if run.status.isTerminal || run.status == .paused { return run.status }
    return now - run.owner.heartbeatAt > orphanAfterSeconds ? .orphaned : run.status
}
