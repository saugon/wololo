export type PolicyContext = {
  branch: string | null
  workdir: string
  runDir: string
  commands: readonly string[]
  patterns: readonly RegExp[]
  // config.env as the run puts it before each project command; a segment that starts with exactly it is judged without it.
  envPrefix?: string
}

const SAFE_SEGMENTS: readonly RegExp[] = [
  /^git (status|diff|log|show|add|commit|rev-parse|fetch|ls-files|merge-base)\b/,
  /^git branch( --show-current)?$/,
  /^git -c commit\.gpgsign=false commit\b/,
  /^git rebase (-f |--force-rebase )?--exec (["'])git commit --amend --no-edit -S\2 [\w./-]+$/,
  /^git worktree (add|list)\b/,
  /^gh pr (ready|view|checks|diff)\b/,
  /^gh issue view\b/,
  /^gh run (view|watch|list)\b/,
  /^gh repo view\b/,
  /^(head|tail|grep|wc|cat|jq|sort|uniq)\b/,
]

export function segments(command: string): string[] {
  // A lone & runs what precedes it in the background and goes on with what follows: two commands, like ; .
  return command
    .split(/&&|\|\||;|\||\n|&/)
    .map(part => part.trim())
    .filter(part => part.length > 0)
}

// Inside a segment that otherwise looks safe, these write files or run other commands: output redirection,
// command and process substitution.
const HIDDEN_EFFECTS = /\$\(|`|<\(|>/

export function hasHiddenEffects(segment: string): boolean {
  return HIDDEN_EFFECTS.test(segment)
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// git's global options before the subcommand, which can point the push at another repository: -C <dir>, -c <k=v>,
// --git-dir=<dir>, --work-tree=<dir>.
const GIT_OPTIONS = String.raw`(?:(?:-C|-c)\s+\S+\s+|--(?:git-dir|work-tree)(?:=|\s+)\S+\s+)*`

export function isPush(segment: string): boolean {
  return new RegExp(`^git\\s+${GIT_OPTIONS}push\\b`).test(segment)
}

export function isAllowedPush(segment: string, branch: string | null): boolean {
  if (!branch || /\s(-f|--force|--force-with-lease|--mirror|--all|--tags|--delete|-d)\b/.test(segment)) return false
  const target = new RegExp(`^git\\s+push(\\s+(-u|--set-upstream))?\\s+origin\\s+(HEAD:)?(refs/heads/)?${escape(branch)}\\s*$`)
  return target.test(segment)
}

export function hasPush(command: string): boolean {
  return segments(command).some(isPush)
}

// current: the branch the run's worktree is on, when it differs from the run's, to say why the push is refused.
export function pushDenial(command: string, branch: string | null, current: string | null = null): string | null {
  for (const segment of segments(command)) {
    if (isPush(segment) && !isAllowedPush(segment, branch)) {
      if (!branch) return 'wololo: this run has no branch to push.'
      const rule = `wololo: during a run, push only the run branch, exactly as \`git push -u origin ${branch}\`.`
      return current && current !== branch
        ? `${rule} The worktree is on \`${current}\`, which wololo does not take as the run's branch: a branch created beside it, or the base, is no rename. To push under the new name, rename the run's branch itself (\`git branch -m ${branch} <new name>\`); otherwise switch back to \`${branch}\`.`
        : rule
    }
  }
  return null
}

// The run's branch was renamed when it no longer exists and the worktree is on another branch that is not the base: the
// name to record, or null. A branch created beside it (switch -c, checkout -b) leaves the run's in place, and is no rename.
export function renamedBranch(branch: string | null, current: string | null, branchExists: boolean, base: string): string | null {
  if (!branch || !current || current === branch || branchExists) return null
  if (current === base.replace(/^origin\//, '')) return null
  return current
}

// What writes to GitHub: during a run that goes through the publish tool only, which checks the config and GitHub's limits.
const GH_WRITES: readonly RegExp[] = [
  /^gh\s+pr\s+(create|comment|edit|merge|close|reopen|review)\b/,
  /^gh\s+issue\s+(create|comment|edit|close|reopen|delete|transfer|lock|pin)\b/,
  /^gh\s+(release|label|repo)\s+(create|edit|delete|upload)\b/,
  /^gh\s+api\b.*\s(-X|--method)\s*(POST|PATCH|PUT|DELETE)\b/i,
  /^gh\s+api\b.*\s(-f|-F|--field|--raw-field|--input)\b/,
]
const MCP_GITHUB_WRITE = /^mcp__github__(create|update|add|push|merge|fork|delete)/

export function githubWriteDenial(tool: string, input: Record<string, unknown>): string | null {
  const reason = 'wololo: during a run, GitHub writes go through its publish tool (mcp__wololo__publish), which keeps the config and GitHub limits; when the person asked for the write, pass person_asked: true.'
  if (MCP_GITHUB_WRITE.test(tool)) return reason
  if (tool === 'Bash' && typeof input.command === 'string' && segments(input.command).some(segment => GH_WRITES.some(write => write.test(segment))))
    return reason
  return null
}

export function isInside(path: string, dir: string): boolean {
  const base = dir.replace(/\/+$/, '')
  return path === base || path.startsWith(`${base}/`)
}

function isAllowedSegment(segment: string, ctx: PolicyContext): boolean {
  if (ctx.envPrefix && segment.startsWith(`${ctx.envPrefix} `)) return isAllowedSegment(segment.slice(ctx.envPrefix.length + 1), { ...ctx, envPrefix: '' })
  const cd = /^cd\s+("?)(.+)\1$/.exec(segment)
  if (cd?.[2]) {
    const target = cd[2]
    if (!target.startsWith('/')) return !target.startsWith('~') && !target.split('/').includes('..')
    return isInside(target, ctx.workdir) || isInside(target, ctx.runDir)
  }
  const chmod = /^chmod\s+[ugoa]*\+x\s+(.+)$/.exec(segment)
  if (chmod?.[1]) return chmod[1].split(/\s+/).every(file => isInside(file, ctx.workdir) || !file.startsWith('/'))
  if (isPush(segment)) return isAllowedPush(segment, ctx.branch)
  // The project's own commands are trusted exactly as configured, redirections included.
  if (ctx.commands.some(command => segments(command).includes(segment))) return true
  if (hasHiddenEffects(segment)) return false
  if (ctx.patterns.some(pattern => pattern.test(segment))) return true
  return SAFE_SEGMENTS.some(pattern => pattern.test(segment))
}

export function isAllowedBash(command: string, ctx: PolicyContext): boolean {
  const parts = segments(command)
  return parts.length > 0 && parts.every(segment => isAllowedSegment(segment, ctx))
}

export function isAllowedPath(path: string, ctx: PolicyContext): boolean {
  return isInside(path, ctx.workdir) || isInside(path, ctx.runDir)
}

export function isReadInside(tool: string, input: Record<string, unknown>, ctx: PolicyContext): boolean {
  if (!['Read', 'Grep', 'Glob', 'LS'].includes(tool)) return false
  const path = typeof input.file_path === 'string' ? input.file_path : typeof input.path === 'string' ? input.path : null
  return path !== null && isAllowedPath(path, ctx)
}

export function commandRules(templates: readonly string[], escape: (template: string) => RegExp): { commands: string[]; patterns: RegExp[] } {
  const commands: string[] = []
  const patterns: RegExp[] = []
  for (const template of templates) {
    for (const segment of segments(template)) {
      if (segment.includes('{files}')) patterns.push(escape(segment))
      else commands.push(segment)
    }
  }
  return { commands, patterns }
}

// A command that starts a server: it stays up on its own and is no work in progress. Not one of the project's start commands, which
// are known by name, but a dev server started by hand: a `*.run` make target, phx.server, vite, a package script's dev or start, or
// one given a port.
const SERVER_COMMANDS: readonly RegExp[] = [
  /\bmake\s+(?:-\S+\s+)*(?:[\w-]+\.)*run(?:\.[\w-]+)*\b/,
  /\bphx\.server\b/,
  /\bvite\b(?!\s+(?:build|preview\s+--build))/,
  /\b(?:pnpm|npm|yarn|bun)\b[^;&|]*\s(?:run\s+)?(?:dev|start|serve)\b/,
  /\bnext\s+(?:dev|start)\b/,
  /\brails\s+s(?:erver)?\b/,
  /\b(?:uvicorn|gunicorn|http\.server)\b/,
  /\bdocker\s+compose\s+up\b/,
]
const TEST_WORDS = /(?:^|[\s.:/_-])(?:test|tests|e2e|spec|specs|lint|check|verify)(?:$|[\s.:/_-])/

export function isServerCommand(command: string): boolean {
  return segments(command).some(part => !TEST_WORDS.test(part) && (SERVER_COMMANDS.some(re => re.test(part)) || portOf(part) !== null))
}

// The port a background command serves on, when it says so: PORT=4060 (or BACKEND_PORT=4060), --port 4060 or -p 4060.
export function portOf(command: string): number | null {
  const found =
    /\b[A-Z_]*PORT=(\d{2,5})\b/.exec(command) ?? /--port[= ](\d{2,5})\b/.exec(command) ?? /(?:^|\s)-p\s+(\d{2,5})\b/.exec(command)
  return found?.[1] ? Number(found[1]) : null
}

// The TCP ports listening, from `lsof -nP -iTCP -sTCP:LISTEN -Fpcn`: each with the process that holds it.
export function listeners(lsof: string): Array<{ pid: number; command: string; port: number }> {
  const out: Array<{ pid: number; command: string; port: number }> = []
  let pid = 0
  let command = ''
  for (const line of lsof.split('\n')) {
    const tag = line[0]
    const value = line.slice(1)
    if (tag === 'p') pid = Number(value)
    else if (tag === 'c') command = value
    else if (tag === 'n') {
      const port = Number(/:(\d+)$/.exec(value)?.[1])
      if (pid && Number.isFinite(port) && !out.some(seen => seen.pid === pid && seen.port === port)) out.push({ pid, command, port })
    }
  }
  return out
}

// Each process's working directory, from `lsof -a -p <pids> -d cwd -Fpn`.
export function workingDirs(lsof: string): Map<number, string> {
  const dirs = new Map<number, string>()
  let pid = 0
  for (const line of lsof.split('\n')) {
    if (line[0] === 'p') pid = Number(line.slice(1))
    else if (line[0] === 'n' && pid) dirs.set(pid, line.slice(1))
  }
  return dirs
}
