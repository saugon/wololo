import type { Lang, Mode } from './model'

export type RoleName = 'explorer' | 'architect' | 'critic' | 'implementer' | 'verifier' | 'reviewer'

export type StartCommand = {
  name: string
  cmd: string
  port: string
  env: Record<string, string>
  ready_path?: string
}

export type TouchedCommand = { match: string; cmd: string }

// Where a run hands a step to another tool, such as a project's own delivery runner.
export const ADAPTER_POINTS = ['definition', 'gate_a', 'plan', 'item', 'pr', 'poll'] as const
export type AdapterPoint = (typeof ADAPTER_POINTS)[number]
export type AdapterStep = {
  // A shell command, run in the work tree with config.env; {name} takes a run variable or one captured before.
  cmd: string
  // name: a dotted path into the command's JSON answer, or /regex/ whose first group is taken from its output.
  capture?: Record<string, string>
  // Refusals the step expects, by the answer's code: they do not block the run.
  accept_codes?: string[]
  // States the step expects the tool to leave its own run in while it waits on a person (exit 2), such as verified: they do not block the run.
  accept_states?: string[]
  // Run the step only when the variable was (not) captured before this point started.
  if_missing?: string
  if_present?: string
}
export type Adapter = { replaces?: boolean; steps: AdapterStep[] }

export type TestsConfig = {
  follow: 'wololo' | 'project'
  rules_from: string[]
  patterns: string[]
  touched: TouchedCommand[]
  suite: string[]
  e2e: string[]
  suite_runs: 'local' | 'ci'
  e2e_runs: 'local' | 'ci' | 'off'
  background: boolean
}

export type Config = {
  schema_version: number
  autonomy: Mode
  paths: { context: string[]; definition: string[]; implementation: string[] }
  debate: {
    depth: 'by_risk' | 'light' | 'deep'
    risk_signals: string[]
    critic: 'claude' | 'external'
    external_cmd: string[]
  }
  // approval: where the change is approved, at Aprobar PR in the session (local) or on the PR itself once CI is green (pr).
  review: { reviewer: 'claude' | 'external' | 'both'; approval: 'local' | 'pr' }
  isolation: 'worktree' | 'branch'
  worktree_dir: string
  branch: string
  tests: TestsConfig
  commands: {
    start: StartCommand[]
    app_url: string
    login: string | null
  }
  screenshots: { enabled: boolean; max: number }
  pr: { enabled: boolean; draft: boolean; wait_ci: boolean; base: string }
  spec: { to_github: boolean; create_issue_from_text: boolean }
  languages: { chat: Lang; spec: string; issue: string; pr: string }
  models: Partial<Record<RoleName, { model?: string; effort?: string }>>
  project_agents: Partial<Record<RoleName, string>>
  budgets: {
    design_reversals: number
    debate_rounds: number
    ci_fix_attempts: number
    run_minutes: number
  }
  permissions: { auto_allow: boolean }
  adapters: Partial<Record<AdapterPoint, Adapter>>
  // Runs another tool drives without a session, shown in /wololo status: the command that lists them, and the one that says where one stands ({run}).
  mirror: { list: string; run: string }
  // Paths whose change makes a run high risk, whatever risk it was given.
  risk_paths: string[]
  // Variables every project command runs with (set) or without (unset), so the session's own environment does not leak in.
  env: { set: Record<string, string>; unset: string[] }
  view: {
    header: boolean
    band: boolean
    pane: 'auto' | 'command' | 'off'
    statusline: boolean
    notify: string[]
    colors: { working: string; waiting: string; blocked: string; done: string }
  }
}

export const DEFAULT_CONFIG: Config = {
  schema_version: 1,
  autonomy: 'checkpoints',
  paths: { context: [], definition: [], implementation: [] },
  debate: {
    depth: 'by_risk',
    risk_signals: [],
    critic: 'claude',
    external_cmd: ['codex', 'exec', '--sandbox', 'read-only', '-'],
  },
  review: { reviewer: 'claude', approval: 'local' },
  isolation: 'worktree',
  worktree_dir: '.claude/worktrees/wololo-{run}',
  branch: 'wololo/{ref}-{slug}',
  tests: {
    follow: 'wololo',
    rules_from: [],
    patterns: ['**/*_test.*', '**/*.test.*', '**/*.spec.*', '**/test_*.py', '**/*_spec.rb'],
    touched: [],
    suite: [],
    e2e: [],
    suite_runs: 'local',
    e2e_runs: 'local',
    background: true,
  },
  commands: {
    start: [],
    app_url: '',
    login: null,
  },
  screenshots: { enabled: true, max: 5 },
  pr: { enabled: true, draft: true, wait_ci: true, base: 'main' },
  spec: { to_github: true, create_issue_from_text: false },
  languages: { chat: 'es', spec: 'es', issue: 'es', pr: 'en' },
  models: {},
  project_agents: {},
  budgets: {
    design_reversals: 2,
    debate_rounds: 2,
    ci_fix_attempts: 2,
    run_minutes: 240,
  },
  permissions: { auto_allow: true },
  adapters: {},
  mirror: { list: '', run: '' },
  risk_paths: [],
  env: { set: {}, unset: [] },
  view: {
    header: true,
    band: true,
    pane: 'auto',
    statusline: false,
    notify: ['waiting_user', 'waiting_permission', 'blocked', 'stalled', 'paused', 'done', 'failed'],
    colors: { working: 'claude', waiting: 'warning', blocked: 'error', done: 'success' },
  },
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function merge<T>(base: T, over: unknown): T {
  if (!isObject(base) || !isObject(over)) return over === undefined ? base : (over as T)
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(over)) {
    out[key] = isObject(out[key]) && isObject(value) ? merge(out[key], value) : value
  }
  return out as T
}

const ENUMS: Record<string, readonly string[]> = {
  autonomy: ['full', 'checkpoints', 'guided'],
  'debate.depth': ['by_risk', 'light', 'deep'],
  'debate.critic': ['claude', 'external'],
  'review.reviewer': ['claude', 'external', 'both'],
  'review.approval': ['local', 'pr'],
  isolation: ['worktree', 'branch'],
  'languages.chat': ['es', 'en'],
  'view.pane': ['auto', 'command', 'off'],
  'tests.follow': ['wololo', 'project'],
  'tests.suite_runs': ['local', 'ci'],
  'tests.e2e_runs': ['local', 'ci', 'off'],
}

function at(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((v, key) => (isObject(v) ? v[key] : undefined), value)
}

function typeOf(value: unknown): string {
  if (Array.isArray(value)) return 'array'
  if (value === null) return 'null'
  return typeof value
}

const OPEN_MAPS = ['models', 'project_agents', 'env.set', 'adapters']

function walkTypes(expected: unknown, actual: unknown, path: string, errors: string[]) {
  if (actual === undefined) return
  if (isObject(expected)) {
    if (!isObject(actual)) {
      errors.push(`${path || '(root)'}: expected an object, got ${typeOf(actual)}`)
      return
    }
    if (OPEN_MAPS.includes(path)) return
    for (const key of Object.keys(actual)) {
      const child = path ? `${path}.${key}` : key
      if (!(key in expected)) errors.push(`${child}: unknown key`)
      else walkTypes(expected[key], actual[key], child, errors)
    }
    return
  }
  const want = typeOf(expected)
  const got = typeOf(actual)
  if (want === 'null') return
  if (want !== got) errors.push(`${path}: expected ${want}, got ${got}`)
}

export function validate(candidate: unknown): string[] {
  const errors: string[] = []
  walkTypes(DEFAULT_CONFIG, candidate, '', errors)
  for (const [path, allowed] of Object.entries(ENUMS)) {
    const value = at(candidate, path)
    if (value !== undefined && !allowed.includes(String(value))) errors.push(`${path}: must be one of ${allowed.join(', ')}`)
  }
  return errors
}

// Keys a config written by an earlier wololo may still hold, carried to where they live now.
function migrate(candidate: unknown): unknown {
  if (!isObject(candidate) || !isObject(candidate.debate) || !('max_rounds' in candidate.debate)) return candidate
  const { max_rounds, ...debate } = candidate.debate
  const budgets = isObject(candidate.budgets) ? candidate.budgets : {}
  return { ...candidate, debate, budgets: 'debate_rounds' in budgets ? budgets : { ...budgets, debate_rounds: max_rounds } }
}

export function resolve(global: unknown, project: unknown): { config: Config; errors: string[] } {
  global = migrate(global)
  project = migrate(project)
  const errors = [...validate(global).map(e => `global ${e}`), ...validate(project).map(e => `project ${e}`)]
  const config = merge(merge(DEFAULT_CONFIG, global ?? {}), project ?? {})
  return { config, errors }
}

export function parseJson(text: string | undefined): {
  value: Json | undefined
  error: string | null
} {
  if (text === undefined) return { value: undefined, error: null }
  try {
    return { value: JSON.parse(text) as Json, error: null }
  } catch (error) {
    return {
      value: undefined,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

export function projectKey(remoteUrl: string, commonDir: string): string {
  const match = /[:/]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/.exec(remoteUrl.trim())
  if (remoteUrl.trim() && match?.[1] && match[2]) return `${match[1]}__${match[2]}`.toLowerCase()
  const name =
    commonDir
      .replace(/\/\.git\/?$/, '')
      .split('/')
      .filter(Boolean)
      .pop() ?? 'repo'
  return `local__${name}-${fnv1a(commonDir)}`.toLowerCase()
}

export function slugify(text: string, max = 40): string {
  const slug = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug.slice(0, max).replace(/-+$/g, '') || 'run'
}

function arithmetic(expression: string): number | null {
  if (!/^[\d\s+*()-]+$/.test(expression)) return null
  const tokens = expression.match(/\d+|[+*()-]/g) ?? []
  let i = 0
  const peek = () => tokens[i]
  const factor = (): number => {
    const token = tokens[i++]
    if (token === '(') {
      const value = sum()
      i++
      return value
    }
    if (token === '-') return -factor()
    return Number(token)
  }
  const product = (): number => {
    let value = factor()
    while (peek() === '*') {
      i++
      value *= factor()
    }
    return value
  }
  const sum = (): number => {
    let value = product()
    while (peek() === '+' || peek() === '-') {
      const op = tokens[i++]
      value = op === '+' ? value + product() : value - product()
    }
    return value
  }
  const value = sum()
  return Number.isFinite(value) && i === tokens.length ? value : null
}

export function expand(template: string, vars: Record<string, string | number>): string {
  const filled = template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in vars ? String(vars[key]) : whole))
  const computed = arithmetic(filled)
  return computed === null ? filled : String(computed)
}

export function ports(
  config: Config,
  slot: number,
): Array<{
  name: string
  port: number | null
  cmd: string
  env: Record<string, string>
}> {
  return config.commands.start.map(command => {
    const port = Number(expand(command.port, { slot }))
    const vars = { slot, port: Number.isFinite(port) ? port : '' }
    const env = Object.fromEntries(Object.entries(command.env ?? {}).map(([k, v]) => [k, expand(v, vars)]))
    return {
      name: command.name,
      port: Number.isFinite(port) ? port : null,
      cmd: expand(command.cmd, vars),
      env,
    }
  })
}

export function globToRegExp(glob: string): RegExp {
  let out = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] ?? ''
    if (c === '*' && glob[i + 1] === '*') {
      const slash = glob[i + 2] === '/'
      out += slash ? '(?:.*/)?' : '.*'
      i += slash ? 2 : 1
    } else if (c === '*') out += '[^/]*'
    else if (c === '?') out += '[^/]'
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${out}$`)
}

export function riskyFiles(files: readonly string[], globs: readonly string[]): string[] {
  return files.filter(file => globs.some(glob => globToRegExp(glob).test(file)))
}

function shellQuote(text: string): string {
  return /^[\w./@:+=-]+$/.test(text) ? text : `'${text.replace(/'/g, `'\\''`)}'`
}

// What goes before each project command so it runs with config.env: `env -u NAME ... NAME=value ...`, or nothing.
export function envPrefix(env: Config['env']): string {
  const parts = [...env.unset.map(name => `-u ${name}`), ...Object.entries(env.set).map(([name, value]) => `${name}=${shellQuote(value)}`)]
  return parts.length > 0 ? `env ${parts.join(' ')}` : ''
}

// The command with config.env applied to each of its steps; a `cd` changes nothing to apply it to.
export function withEnv(command: string, prefix: string): string {
  if (!prefix) return command
  return command
    .split(' && ')
    .map(step => (/^cd\s/.test(step.trim()) ? step : `${prefix} ${step.trim()}`))
    .join(' && ')
}

export function isTestFile(path: string, patterns: readonly string[]): boolean {
  return patterns.some(pattern => globToRegExp(pattern).test(path))
}

export type TestPlan = {
  files: string[]
  commands: Array<{ cmd: string; files: string[] }>
  unmatched: string[]
}

function quote(file: string): string {
  return /^[\w./@+-]+$/.test(file) ? file : `'${file.replace(/'/g, `'\\''`)}'`
}

export function planTouched(changed: readonly string[], tests: TestsConfig): TestPlan {
  const files = [...new Set(changed)].filter(file => isTestFile(file, tests.patterns)).sort()
  const groups = new Map<string, string[]>()
  const unmatched: string[] = []
  for (const file of files) {
    const rule = tests.touched.find(entry => globToRegExp(entry.match).test(file))
    if (!rule) {
      unmatched.push(file)
      continue
    }
    groups.set(rule.cmd, [...(groups.get(rule.cmd) ?? []), file])
  }
  const commands = [...groups].map(([template, list]) => ({ cmd: template.replace('{files}', list.map(quote).join(' ')), files: list }))
  return { files, commands, unmatched }
}

export function touchedPattern(template: string): RegExp {
  const [before, after] = template.split('{files}')
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (after === undefined) return new RegExp(`^${escape(template)}$`)
  return new RegExp(`^${escape(before ?? '')}[\\w./@+-]+(?: [\\w./@+-]+)*${escape(after)}$`)
}
