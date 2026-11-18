import Foundation

/// The projects the planning sidebar lists: the stored ones plus one per project key the runs name, so a project with
/// runs shows up before anyone creates it. A stored project whose key matches a run's (ignoring case) absorbs it and
/// keeps its own name, path and repo (a missing path is filled from the runs). Derived projects carry the key as their
/// id, made unique when a stored project already uses it, and are only written to `projects.json` when their first
/// goal is created.
public func mergedProjects(stored: [PlanningProject], runs: [Run]) -> [PlanningProject] {
    var merged = stored
    for var derived in derivedProjects(runs) {
        if let index = merged.firstIndex(where: { $0.effectiveKey?.lowercased() == derived.id.lowercased() }) {
            if merged[index].path.isEmpty {
                merged[index].path = derived.path
            }
        } else {
            derived.id = uniqueID(derived.id, among: merged)
            merged.append(derived)
        }
    }
    return merged.sorted { a, b in
        let order = a.name.localizedCaseInsensitiveCompare(b.name)
        return order == .orderedSame ? a.id < b.id : order == .orderedAscending
    }
}

/// A stored project keeps the id it was derived with after its repo is edited, so the runs of its old key need
/// another id.
private func uniqueID(_ id: String, among projects: [PlanningProject]) -> String {
    var candidate = id
    var suffix = 2
    while projects.contains(where: { $0.id == candidate }) {
        candidate = "\(id)~\(suffix)"
        suffix += 1
    }
    return candidate
}

/// One project per non-empty key, ignoring case, with the path of the newest run that has one. The id and key are the
/// spelling the first run used.
func derivedProjects(_ runs: [Run]) -> [PlanningProject] {
    var order: [String] = []
    var groups: [String: [Run]] = [:]
    for run in runs where !run.project.key.isEmpty {
        let group = run.project.key.lowercased()
        if groups[group] == nil { order.append(group) }
        groups[group, default: []].append(run)
    }
    return order.compactMap { groups[$0] }.map { members in
        let key = members[0].project.key
        let path = members.filter { !$0.project.path.isEmpty }
            .max { $0.createdAt < $1.createdAt }?.project.path ?? ""
        let name = key.hasPrefix("local__") && !path.isEmpty
            ? defaultProjectName(forFolder: path) : projectName(fromKey: key)
        return PlanningProject(id: key, name: name, path: path, repo: repo(fromProjectKey: key), key: key)
    }
}

/// The name a project key reads as in the planning sidebar: the part after `owner__` (`acme__shop` → `shop`).
public func projectName(fromKey key: String) -> String {
    guard let range = key.range(of: "__"), range.upperBound < key.endIndex else { return key }
    return String(key[range.upperBound...])
}

/// The repo a project's bare issue numbers belong to and its runs are launched against.
public func defaultRepo(for project: PlanningProject) -> String? {
    project.repo ?? project.key.flatMap(repo(fromProjectKey:))
}

/// The name "Nuevo proyecto" suggests for a folder: its last path component.
public func defaultProjectName(forFolder path: String) -> String {
    (path as NSString).lastPathComponent
}

/// The stored project whose key (or the one its repo gives) is `key`, ignoring case, so a new project doesn't repeat
/// one that already collects those runs.
public func project(matchingKey key: String, in projects: [PlanningProject]) -> PlanningProject? {
    let key = key.lowercased()
    return projects.first { $0.effectiveKey?.lowercased() == key }
}

/// Whether `project` is written to `projects.json`, rather than derived from the runs.
public func isStored(_ project: PlanningProject, in stored: [PlanningProject]) -> Bool {
    stored.contains { $0.id == project.id }
}

/// The stored projects with `project` saved: replacing the one with its id, or added at the end.
public func upserting(_ project: PlanningProject, into stored: [PlanningProject]) -> [PlanningProject] {
    var result = stored
    if let index = result.firstIndex(where: { $0.id == project.id }) {
        result[index] = project
    } else {
        result.append(project)
    }
    return result
}

/// `project` with what the edit sheet changed. A new repo brings its key along, so the project collects that repo's
/// runs; clearing the repo keeps the key, so the runs it already collects stay with it.
public func projectEditing(_ project: PlanningProject, name: String, path: String,
                           repo: String?) -> PlanningProject {
    var edited = project
    edited.name = name
    edited.path = path
    let repo = repo?.trimmingCharacters(in: .whitespaces)
    if let repo, !repo.isEmpty {
        edited.repo = repo
        edited.key = PlanningProject.key(forRepo: repo)
    } else {
        edited.key = project.effectiveKey
        edited.repo = nil
    }
    return edited
}

/// What deleting a project leaves: the other projects, and the ids of the goals that go with it. A project whose runs
/// are still around shows up again as a derived project, without goals.
public func projectRemoving(id: String, from projects: [PlanningProject],
                            goals: [Goal]) -> (projects: [PlanningProject], goalIDs: [String]) {
    (projects.filter { $0.id != id }, goals.filter { $0.projectID == id }.map(\.id))
}

/// The `config` file git reads for `folder`: that of the nearest `.git` in it or a parent directory, or
/// `folder/.git/config` when there is none. A worktree or submodule has a `.git` file pointing (`gitdir: …`) at its
/// git directory; a worktree's directory names the shared one in `commondir`, which is where `config` lives.
public func gitConfigURL(forFolder folder: String,
                         read: (URL) -> String? = { try? String(contentsOf: $0, encoding: .utf8) }) -> URL {
    let folderURL = URL(fileURLWithPath: folder, isDirectory: true).standardizedFileURL
    var directory = folderURL
    while true {
        if let config = gitConfigURL(inDirectory: directory, read: read) { return config }
        let parent = directory.deletingLastPathComponent().standardizedFileURL
        if parent.path == directory.path || directory.path == "/" { break }
        directory = parent
    }
    return folderURL.appendingPathComponent(".git").appendingPathComponent("config")
}

/// The `config` of the `.git` right in `directory`, or nil when it has none.
private func gitConfigURL(inDirectory directory: URL, read: (URL) -> String?) -> URL? {
    let dotGit = directory.appendingPathComponent(".git")
    guard let pointer = read(dotGit).flatMap(gitdir(fromDotGitFile:)) else {
        let config = dotGit.appendingPathComponent("config")
        return read(config) == nil ? nil : config
    }
    let gitDir = URL(fileURLWithPath: pointer, isDirectory: true, relativeTo: directory).standardizedFileURL
    let common = read(gitDir.appendingPathComponent("commondir"))?.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let common, !common.isEmpty else { return gitDir.appendingPathComponent("config") }
    return URL(fileURLWithPath: common, isDirectory: true, relativeTo: gitDir).standardizedFileURL
        .appendingPathComponent("config")
}

/// The `owner/name` of a folder's `origin` remote on GitHub, read from its git config without running `git`.
public func originRepo(forFolder folder: String,
                       read: (URL) -> String? = { try? String(contentsOf: $0, encoding: .utf8) }) -> String? {
    read(gitConfigURL(forFolder: folder, read: read)).flatMap(originRepo(gitConfig:))
}

/// The `owner/name` of the `[remote "origin"]` url in a git config, or nil when there is no origin or it isn't on
/// GitHub.
public func originRepo(gitConfig: String) -> String? {
    var inOrigin = false
    for rawLine in gitConfig.components(separatedBy: .newlines) {
        let line = rawLine.trimmingCharacters(in: .whitespaces)
        if line.hasPrefix("[") {
            inOrigin = isOriginSection(line)
            continue
        }
        guard inOrigin, let equals = line.firstIndex(of: "=") else { continue }
        let name = line[..<equals].trimmingCharacters(in: .whitespaces).lowercased()
        guard name == "url" else { continue }
        return githubRepo(fromRemoteURL: configValue(String(line[line.index(after: equals)...])))
    }
    return nil
}

/// The `owner/name` of a GitHub remote url: `https://github.com/o/n(.git)`, `git@github.com:o/n(.git)` or
/// `ssh://git@github.com/o/n(.git)`, also on `www.github.com` and `ssh.github.com`. An scp-like url whose host has no
/// dot (`github-work:o/n.git`) is taken as an SSH host alias for GitHub.
func githubRepo(fromRemoteURL url: String) -> String? {
    var rest = url
    if let scheme = rest.range(of: "://") {
        rest = String(rest[scheme.upperBound...])
        guard let slash = rest.firstIndex(of: "/") else { return nil }
        guard githubHosts.contains(hostDroppingUserAndPort(String(rest[..<slash]))) else { return nil }
        rest = String(rest[rest.index(after: slash)...])
    } else {
        guard let colon = rest.firstIndex(of: ":") else { return nil }
        let host = hostDroppingUserAndPort(String(rest[..<colon]))
        guard githubHosts.contains(host) || (!host.isEmpty && !host.contains(".") && !host.contains("/")) else {
            return nil
        }
        rest = String(rest[rest.index(after: colon)...])
    }
    while rest.hasSuffix("/") { rest.removeLast() }
    if rest.lowercased().hasSuffix(".git") { rest.removeLast(4) }
    let parts = rest.split(separator: "/", omittingEmptySubsequences: false)
    guard parts.count == 2, parts.allSatisfy({ !$0.isEmpty }) else { return nil }
    return "\(parts[0])/\(parts[1])"
}

private let githubHosts: Set<String> = ["github.com", "www.github.com", "ssh.github.com"]

private func hostDroppingUserAndPort(_ authority: String) -> String {
    var host = authority
    if let at = host.lastIndex(of: "@") { host = String(host[host.index(after: at)...]) }
    if let colon = host.firstIndex(of: ":") { host = String(host[..<colon]) }
    return host.lowercased()
}

/// `[remote "origin"]`, allowing the spacing and case git itself accepts for the section name.
private func isOriginSection(_ line: String) -> Bool {
    guard let close = line.firstIndex(of: "]") else { return false }
    let inside = line[line.index(after: line.startIndex)..<close].trimmingCharacters(in: .whitespaces)
    guard let quote = inside.firstIndex(of: "\"") else { return false }
    let section = inside[..<quote].trimmingCharacters(in: .whitespaces).lowercased()
    let subsection = inside[inside.index(after: quote)...]
    return section == "remote" && subsection == "origin\""
}

/// A config value with any trailing comment and surrounding quotes removed.
private func configValue(_ raw: String) -> String {
    var value = raw.trimmingCharacters(in: .whitespaces)
    if value.hasPrefix("\""), let end = value.dropFirst().firstIndex(of: "\"") {
        return String(value[value.index(after: value.startIndex)..<end])
    }
    if let comment = value.firstIndex(where: { $0 == "#" || $0 == ";" }) {
        value = String(value[..<comment])
    }
    return value.trimmingCharacters(in: .whitespaces)
}

private func gitdir(fromDotGitFile contents: String) -> String? {
    for line in contents.components(separatedBy: .newlines) {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard trimmed.lowercased().hasPrefix("gitdir:") else { continue }
        let path = trimmed.dropFirst("gitdir:".count).trimmingCharacters(in: .whitespaces)
        return path.isEmpty ? nil : path
    }
    return nil
}
