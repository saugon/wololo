import Foundation

public func matches(_ run: Run, query: String) -> Bool {
    let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
    if needle.isEmpty { return true }
    let fields = [run.title, run.customTitle ?? "", run.project.display, run.project.key, run.project.branch ?? "", run.source.ref, sourceLabel(run)]
    return fields.contains { $0.range(of: needle, options: [.caseInsensitive, .diacriticInsensitive]) != nil }
}

/// Runs of `project` (a project key, or every project when nil) that match `query`.
public func filterRuns(_ runs: [Run], query: String, project: String? = nil) -> [Run] {
    runs.filter { (project == nil || $0.project.key == project) && matches($0, query: query) }
}
