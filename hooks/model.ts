export const SCHEMA_VERSION = 1
export const ORPHAN_AFTER_SECONDS = 90

export type Mode = 'full' | 'checkpoints' | 'guided'
export type Risk = 'low' | 'high' | 'unknown'
export type Lang = 'es' | 'en'
// Hashes of what a gate approved: the run's spec and plan files, and the worktree's committed tree. null where there was none.
export type BudgetName = 'design_reversals' | 'ci_fix_attempts' | 'run_minutes'
export type Snapshot = { spec: string | null; plan: string | null; tree: string | null }

export type StageId = 'context' | 'definition' | 'gate_a' | 'plan' | 'implement' | 'evidence' | 'gate_b' | 'pr'

export const STAGES: ReadonlyArray<{
  id: StageId
  isGate: boolean
  label: Record<Lang, string>
}> = [
  { id: 'context', isGate: false, label: { es: 'Contexto', en: 'Context' } },
  {
    id: 'definition',
    isGate: false,
    label: { es: 'Definición', en: 'Definition' },
  },
  { id: 'gate_a', isGate: true, label: { es: 'Aprobar spec', en: 'Approve spec' } },
  { id: 'plan', isGate: false, label: { es: 'Plan', en: 'Plan' } },
  {
    id: 'implement',
    isGate: false,
    label: { es: 'Implementación', en: 'Implementation' },
  },
  { id: 'evidence', isGate: false, label: { es: 'Evidencia', en: 'Evidence' } },
  { id: 'gate_b', isGate: true, label: { es: 'Aprobar PR', en: 'Approve PR' } },
  { id: 'pr', isGate: false, label: { es: 'PR', en: 'PR' } },
]

export type Status =
  | 'running'
  | 'waiting_user'
  | 'waiting_permission'
  | 'waiting_agents'
  | 'waiting_ci'
  | 'waiting_tests'
  | 'blocked'
  | 'stalled'
  | 'pausing'
  | 'paused'
  | 'orphaned'
  | 'done'
  | 'failed'
  | 'cancelled'

export type Outcome = 'done' | 'failed' | 'cancelled'

export type EventType =
  | 'run.started'
  | 'owner.changed'
  | 'risk.set'
  | 'stage.entered'
  | 'stage.completed'
  | 'gate.requested'
  | 'gate.resolved'
  | 'question.asked'
  | 'question.answered'
  | 'permission.asked'
  | 'permission.resolved'
  | 'agent.started'
  | 'agent.finished'
  | 'task.started'
  | 'task.finished'
  | 'plan.ready'
  | 'item.started'
  | 'item.verified'
  | 'item.reviewed'
  | 'item.committed'
  | 'debate.turn'
  | 'assumption'
  | 'decision'
  | 'corrected'
  | 'doing'
  | 'blocked'
  | 'unblocked'
  | 'stalled'
  | 'pause.requested'
  | 'paused'
  | 'resumed'
  | 'ci.updated'
  | 'pr.opened'
  | 'pr.ready'
  | 'signing.deferred'
  | 'signing.done'
  | 'github.published'
  | 'adapter.ran'
  | 'screenshot.saved'
  | 'usage'
  | 'time'
  | 'run.finished'

export const MODEL_EVENTS: ReadonlySet<EventType> = new Set<EventType>([
  'risk.set',
  'stage.entered',
  'stage.completed',
  'gate.requested',
  'gate.resolved',
  'plan.ready',
  'item.started',
  'item.verified',
  'item.reviewed',
  'item.committed',
  'debate.turn',
  'assumption',
  'decision',
  'corrected',
  'doing',
  'blocked',
  'unblocked',
  'ci.updated',
  'pr.opened',
  'pr.ready',
  'signing.deferred',
  'signing.done',
  'paused',
  'screenshot.saved',
  'run.finished',
])

export type RunEvent = {
  v: number
  seq: number
  ts: number
  run: string
  type: EventType
  data: Record<string, unknown>
}

export type Source = {
  kind: 'github_issue' | 'text' | 'file'
  ref: string
  url: string | null
}

export type Project = {
  key: string
  path: string
  worktree: string | null
  branch: string | null
  base: string | null
}

export type AgentEntry = {
  id: string
  role: string
  description: string
  model: string | null
  status: 'running' | 'idle' | 'completed' | 'failed' | 'killed'
  started_at: number
  finished_at: number | null
}

export type TaskEntry = {
  id: string
  label: string
  kind: 'ci' | 'tests' | 'external' | 'server' | 'other'
  started_at: number
  finished_at: number | null
  status: string | null
}

export type Tokens = { input: number; output: number; cache_read: number; cache_write: number }

export type StageUsage = Tokens & { usd: number; roles: Record<string, { usd: number; tokens: number }> }

export type TimeKind = 'work' | 'agents' | 'tests' | 'you' | 'paused'

export const TIME_KINDS: readonly TimeKind[] = ['work', 'agents', 'tests', 'you', 'paused']

export type StageTime = Partial<Record<TimeKind, number>> & { roles: Record<string, number> }

export function timeKind(status: Status): TimeKind | null {
  switch (status) {
    case 'running':
    case 'pausing':
      return 'work'
    case 'waiting_agents':
      return 'agents'
    case 'waiting_tests':
    case 'waiting_ci':
      return 'tests'
    case 'waiting_user':
    case 'waiting_permission':
    case 'blocked':
    case 'stalled':
      return 'you'
    case 'paused':
      return 'paused'
    default:
      return null
  }
}

function addTime(r: Run, stage: StageId, change: (was: StageTime) => StageTime) {
  r.time = { ...(r.time ?? {}), [stage]: change(r.time?.[stage] ?? { roles: {} }) }
}

export function tokenTotal(t: Tokens): number {
  return t.input + t.output + t.cache_read + t.cache_write
}

export type ItemEntry = {
  n: number
  title: string
  state: 'pending' | 'active' | 'failing' | 'done'
  sha: string | null
  // The current attempt's checks: when it last passed verification and on which tree, and when it was reviewed after that.
  verified?: { at: number; tree: string | null } | null
  reviewed_at?: number | null
}

export type StageEntry = {
  id: StageId
  started_at: number
  finished_at: number | null
}

export type Waiting = {
  on: 'user' | 'permission'
  question: string
  since: number
}

export type Run = {
  schema_version: number
  id: string
  title: string
  source: Source
  project: Project
  mode: Mode
  // Values the run's adapters captured, for the commands of later steps.
  adapter_vars?: Record<string, string>
  // Where this run's change is approved: at Aprobar PR (local) or on the PR (pr). Runs from before it are local.
  review?: 'local' | 'pr'
  risk: Risk
  lang: Lang
  slot: number
  stage: { id: StageId; index: number; total: number; since: number } | null
  stages: StageEntry[]
  gates: Partial<
    Record<
      StageId,
      {
        requested_at: number
        resolved_at: number | null
        outcome: string | null
        by: string | null
        // What the gate approved, as file and tree hashes: a later change to any of them needs the gate again.
        snapshot?: Snapshot
      }
    >
  >
  status: Status
  waiting: Waiting | null
  blocked: { reason: string; since: number } | null
  agents: AgentEntry[]
  tasks: TaskEntry[]
  items: {
    done: number
    total: number
    current: { n: number; title: string; since?: number } | null
    list?: ItemEntry[]
  }
  counts: {
    assumptions: number
    decisions: number
    corrections: number
    debate_turns: number
    attempts: number
    reversals: number
    nudges: number
    unsigned: number
    // Toward the budgets: reversals per item, CI runs that failed, and how many times the person extended each budget.
    reversals_by_item?: Record<number, number>
    ci_failures?: number
    budget_extensions?: Partial<Record<BudgetName, number>>
  }
  pr: {
    url: string
    number: number | null
    state: 'draft' | 'ready'
    ci: 'pending' | 'passing' | 'failing' | null
  } | null
  screenshots: Array<{ file: string; caption: string }>
  owner: { session_id: string; cwd: string; heartbeat_at: number }
  last_seq: number
  last_user_at: number | null
  last_answer_at: number | null
  // The last question the person answered, with each header and the option they chose: what a gate is resolved on.
  last_answer: { at: number; pairs: Array<{ header: string; answer: string }> } | null
  created_at: number
  updated_at: number
  finished_at: number | null
  outcome: Outcome | null
  summary: string | null
  doing?: { text: string; since: number } | null
  usage?: Partial<Record<StageId, StageUsage>>
  time?: Partial<Record<StageId, StageTime>>
  pause_requested_at?: number | null
  paused?: { note: string; since: number } | null
}

export type Live = {
  isTurnRunning: boolean
  question: string | null
  permission: string | null
}

const TERMINAL: ReadonlySet<Status> = new Set<Status>(['done', 'failed', 'cancelled'])

export function isTerminal(status: Status): boolean {
  return TERMINAL.has(status)
}

// The run's own minutes: working, running agents and tests, but not waiting for the person or paused.
export function activeMinutes(run: Run): number {
  let seconds = 0
  for (const time of Object.values(run.time ?? {})) seconds += (time?.work ?? 0) + (time?.agents ?? 0) + (time?.tests ?? 0)
  return seconds / 60
}

export function stageIndex(id: StageId): number {
  return STAGES.findIndex(s => s.id === id)
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function emptyRun(id: string, ts: number): Run {
  return {
    schema_version: SCHEMA_VERSION,
    id,
    title: '',
    source: { kind: 'text', ref: '', url: null },
    project: { key: '', path: '', worktree: null, branch: null, base: null },
    mode: 'checkpoints',
    risk: 'unknown',
    lang: 'es',
    slot: 0,
    stage: null,
    stages: [],
    gates: {},
    status: 'running',
    waiting: null,
    blocked: null,
    agents: [],
    tasks: [],
    items: { done: 0, total: 0, current: null, list: [] },
    counts: {
      assumptions: 0,
      decisions: 0,
      corrections: 0,
      debate_turns: 0,
      attempts: 0,
      reversals: 0,
      nudges: 0,
      unsigned: 0,
    },
    pr: null,
    screenshots: [],
    owner: { session_id: '', cwd: '', heartbeat_at: ts },
    last_seq: 0,
    last_user_at: null,
    last_answer_at: null,
    last_answer: null,
    created_at: ts,
    updated_at: ts,
    finished_at: null,
    outcome: null,
    summary: null,
    doing: null,
    pause_requested_at: null,
    paused: null,
  }
}

function setItem(run: Run, n: number, title: string, change: Partial<ItemEntry>) {
  if (n <= 0) return
  const list = run.items.list ?? []
  const found = list.find(item => item.n === n)
  const known = title || (run.items.current?.n === n ? run.items.current.title : '')
  if (found) Object.assign(found, change, found.title ? {} : { title: known })
  else list.push({ n, title: known, state: 'pending', sha: null, ...change })
  list.sort((a, b) => a.n - b.n)
  run.items.list = list
}

export function apply(run: Run, ev: RunEvent): Run {
  const r: Run = structuredClone(run)
  const d = ev.data
  r.last_seq = Math.max(r.last_seq, ev.seq)
  r.updated_at = ev.ts
  if (ev.type !== 'stalled' && MODEL_EVENTS.has(ev.type)) r.counts.nudges = 0

  switch (ev.type) {
    case 'run.started': {
      r.title = str(d.title)
      r.source = (d.source as Source) ?? r.source
      r.project = (d.project as Project) ?? r.project
      r.mode = (d.mode as Mode) ?? r.mode
      if (d.review === 'pr' || d.review === 'local') r.review = d.review
      r.risk = (d.risk as Risk) ?? r.risk
      r.lang = (d.lang as Lang) ?? r.lang
      r.slot = num(d.slot)
      r.owner = {
        session_id: str(d.session_id),
        cwd: str(d.cwd),
        heartbeat_at: ev.ts,
      }
      r.created_at = ev.ts
      break
    }
    case 'owner.changed':
      r.owner = {
        session_id: str(d.session_id),
        cwd: str(d.cwd, r.owner.cwd),
        heartbeat_at: ev.ts,
      }
      if (typeof d.worktree === 'string') r.project.worktree = d.worktree
      if (typeof d.branch === 'string') r.project.branch = d.branch
      for (const task of r.tasks) {
        if (task.finished_at !== null) continue
        task.finished_at = ev.ts
        task.status = 'gone'
      }
      break
    case 'risk.set':
      r.risk = (d.risk as Risk) ?? r.risk
      break
    case 'stage.entered': {
      const id = d.stage as StageId
      const index = stageIndex(id)
      if (index < 0) break
      const open = r.stages.find(s => s.finished_at === null && s.id !== id)
      if (open) open.finished_at = ev.ts
      // Going back to a stage before a gate reopens that gate: what it approved is being redone.
      if (r.stage && index <= r.stage.index)
        for (const gate of STAGES.filter(stage => stage.isGate && stageIndex(stage.id) > index)) delete r.gates[gate.id]
      r.stage = { id, index, total: STAGES.length, since: ev.ts }
      r.doing = null
      r.stages.push({ id, started_at: ev.ts, finished_at: null })
      if (STAGES[index]?.isGate && !r.gates[id])
        r.gates[id] = {
          requested_at: ev.ts,
          resolved_at: null,
          outcome: null,
          by: null,
        }
      break
    }
    case 'stage.completed': {
      const id = d.stage as StageId
      for (const s of r.stages) if (s.id === id && s.finished_at === null) s.finished_at = ev.ts
      break
    }
    case 'gate.requested': {
      const id = d.gate as StageId
      r.gates[id] = {
        requested_at: ev.ts,
        resolved_at: null,
        outcome: null,
        by: null,
      }
      break
    }
    case 'gate.resolved': {
      const id = d.gate as StageId
      const gate = r.gates[id] ?? {
        requested_at: ev.ts,
        resolved_at: null,
        outcome: null,
        by: null,
      }
      const outcome = str(d.outcome, 'approved')
      // Only an approval passes a gate: after changes or a rejection it is pending again, and needs a new answer.
      r.gates[id] = {
        ...gate,
        resolved_at: outcome === 'approved' ? ev.ts : null,
        outcome,
        by: str(d.by, 'user'),
        ...(outcome === 'approved' && d.snapshot && typeof d.snapshot === 'object' ? { snapshot: d.snapshot as Snapshot } : {}),
      }
      for (const s of r.stages) if (s.id === id && s.finished_at === null) s.finished_at = ev.ts
      break
    }
    case 'question.asked':
      r.waiting = { on: 'user', question: str(d.question), since: ev.ts }
      break
    case 'question.answered':
      if (r.waiting?.on === 'user') r.waiting = null
      // A dialog the person cancelled or dismissed is no answer. Events from before `answered` existed count as one.
      if (d.answered !== false) {
        r.last_answer_at = ev.ts
        const pairs = Array.isArray(d.pairs) ? d.pairs : []
        r.last_answer = { at: ev.ts, pairs: pairs.map(pair => ({ header: str(pair?.header), answer: str(pair?.answer) })) }
      }
      break
    case 'permission.asked':
      if (r.waiting?.on !== 'user') r.waiting = { on: 'permission', question: [str(d.tool), str(d.what)].filter(Boolean).join(' · '), since: ev.ts }
      break
    case 'permission.resolved':
      if (r.waiting?.on === 'permission') r.waiting = null
      break
    case 'agent.started': {
      const id = str(d.id)
      if (!id || r.agents.some(a => a.id === id)) break
      r.agents.push({
        id,
        role: str(d.role, 'agent'),
        description: str(d.description),
        model: typeof d.model === 'string' ? d.model : null,
        status: 'running',
        started_at: ev.ts,
        finished_at: null,
      })
      r.agents = r.agents.slice(-40)
      break
    }
    case 'agent.finished': {
      const agent = r.agents.find(a => a.id === str(d.id))
      if (agent && agent.finished_at === null) {
        agent.status = (d.status as AgentEntry['status']) ?? 'completed'
        agent.finished_at = ev.ts
        const took = ev.ts - agent.started_at
        if (r.stage && took > 0) addTime(r, r.stage.id, was => ({ ...was, roles: { ...was.roles, [agent.role]: (was.roles[agent.role] ?? 0) + took } }))
      }
      break
    }
    case 'task.started': {
      const id = str(d.id)
      if (!id || r.tasks.some(t => t.id === id)) break
      r.tasks.push({
        id,
        label: str(d.label),
        kind: (d.kind as TaskEntry['kind']) ?? 'other',
        started_at: ev.ts,
        finished_at: null,
        status: null,
      })
      r.tasks = r.tasks.slice(-40)
      break
    }
    case 'task.finished': {
      const task = r.tasks.find(t => t.id === str(d.id))
      if (task && task.finished_at === null) {
        task.finished_at = ev.ts
        task.status = str(d.status, 'completed')
      }
      break
    }
    case 'plan.ready':
      r.items.total = Array.isArray(d.items) ? d.items.length : num(d.total, r.items.total)
      if (Array.isArray(d.items)) {
        r.items.list = d.items.map((title, index) => ({ n: index + 1, title: str(title, String(title)), state: 'pending', sha: null }))
      }
      break
    case 'item.started':
      r.items.current = { n: num(d.n), title: str(d.title), since: ev.ts }
      setItem(r, num(d.n), str(d.title), { state: 'active', verified: null, reviewed_at: null })
      r.counts.attempts += 1
      if (d.reversal === true) {
        r.counts.reversals += 1
        r.counts.reversals_by_item = { ...(r.counts.reversals_by_item ?? {}), [num(d.n)]: (r.counts.reversals_by_item?.[num(d.n)] ?? 0) + 1 }
      }
      break
    case 'item.verified':
      if (d.result === 'fail') setItem(r, num(d.n), '', { state: 'failing', verified: null })
      else setItem(r, num(d.n), '', { verified: { at: ev.ts, tree: typeof d.worktree_tree === 'string' ? d.worktree_tree : null } })
      break
    case 'item.reviewed':
      setItem(r, num(d.n), '', { reviewed_at: ev.ts })
      break
    case 'item.committed':
      r.items.done = Math.min(Math.max(r.items.done, num(d.n)), Math.max(r.items.total, num(d.n)))
      if (r.items.current?.n === num(d.n)) r.items.current = null
      setItem(r, num(d.n), str(d.title), { state: 'done', sha: typeof d.sha === 'string' ? d.sha : null })
      break
    case 'debate.turn':
      r.counts.debate_turns += 1
      break
    case 'assumption':
      r.counts.assumptions += 1
      break
    case 'decision':
      r.counts.decisions += 1
      break
    case 'doing':
      r.doing = typeof d.text === 'string' && d.text.trim() ? { text: d.text.trim(), since: ev.ts } : null
      break
    case 'corrected':
      r.counts.corrections += 1
      break
    case 'signing.deferred':
      r.counts.unsigned = (r.counts.unsigned ?? 0) + 1
      break
    case 'signing.done':
      r.counts.unsigned = 0
      break
    case 'adapter.ran':
      if (d.captured && typeof d.captured === 'object') r.adapter_vars = { ...(r.adapter_vars ?? {}), ...(d.captured as Record<string, string>) }
      break
    case 'blocked':
      r.blocked = { reason: str(d.reason), since: ev.ts }
      break
    case 'pause.requested':
      r.pause_requested_at = ev.ts
      break
    case 'paused':
      r.paused = { note: str(d.note), since: ev.ts }
      r.pause_requested_at = null
      r.doing = null
      break
    case 'resumed':
      r.paused = null
      r.pause_requested_at = null
      break
    case 'unblocked':
      r.blocked = null
      if (typeof d.budget === 'string')
        r.counts.budget_extensions = { ...(r.counts.budget_extensions ?? {}), [d.budget]: (r.counts.budget_extensions?.[d.budget as BudgetName] ?? 0) + 1 }
      break
    case 'stalled':
      r.counts.nudges += 1
      break
    case 'ci.updated':
      if (r.pr) r.pr.ci = (d.state as 'pending' | 'passing' | 'failing') ?? r.pr.ci
      if (d.state === 'failing') r.counts.ci_failures = (r.counts.ci_failures ?? 0) + 1
      break
    case 'pr.opened':
      r.pr = {
        url: str(d.url),
        number: typeof d.number === 'number' ? d.number : null,
        state: d.draft === false ? 'ready' : 'draft',
        ci: null,
      }
      break
    case 'pr.ready':
      if (r.pr) r.pr.state = 'ready'
      break
    case 'screenshot.saved':
      r.screenshots.push({ file: str(d.file), caption: str(d.caption) })
      break
    case 'time': {
      const stage = d.stage as StageId
      const kind = d.kind as TimeKind
      const seconds = num(d.seconds)
      if (stageIndex(stage) < 0 || !TIME_KINDS.includes(kind) || seconds <= 0) break
      addTime(r, stage, was => ({ ...was, [kind]: (was[kind] ?? 0) + seconds }))
      break
    }
    case 'usage': {
      const stage = d.stage as StageId
      if (stageIndex(stage) < 0) break
      const usage = { ...(r.usage ?? {}) }
      const was = usage[stage] ?? { input: 0, output: 0, cache_read: 0, cache_write: 0, usd: 0, roles: {} }
      const add: Tokens = { input: num(d.input), output: num(d.output), cache_read: num(d.cache_read), cache_write: num(d.cache_write) }
      const usd = typeof d.usd === 'number' && d.usd > 0 ? d.usd : 0
      const role = str(d.role, 'main')
      const roleWas = was.roles[role] ?? { usd: 0, tokens: 0 }
      usage[stage] = {
        input: was.input + add.input,
        output: was.output + add.output,
        cache_read: was.cache_read + add.cache_read,
        cache_write: was.cache_write + add.cache_write,
        usd: was.usd + usd,
        roles: { ...was.roles, [role]: { usd: roleWas.usd + usd, tokens: roleWas.tokens + tokenTotal(add) } },
      }
      r.usage = usage
      break
    }
    case 'run.finished': {
      r.doing = null
      r.outcome = (d.outcome as Outcome) ?? 'done'
      r.summary = typeof d.summary === 'string' ? d.summary : null
      r.finished_at = ev.ts
      r.waiting = null
      for (const s of r.stages) if (s.finished_at === null) s.finished_at = ev.ts
      break
    }
    default:
      break
  }
  return r
}

export function rebuild(id: string, events: readonly RunEvent[]): Run {
  const sorted = [...events].sort((a, b) => a.seq - b.seq)
  return sorted.reduce(apply, emptyRun(id, sorted[0]?.ts ?? 0))
}

export function liveAgents(run: Run): AgentEntry[] {
  return run.agents.filter(a => a.finished_at === null)
}

export function liveTasks(run: Run): TaskEntry[] {
  return run.tasks.filter(t => t.finished_at === null)
}

export function deriveStatus(run: Run, live: Live): Status {
  if (run.outcome) return run.outcome
  if (live.question || run.waiting?.on === 'user') return 'waiting_user'
  if (run.blocked) return 'blocked'
  if (live.permission || run.waiting?.on === 'permission') return 'waiting_permission'
  if (run.paused) return 'paused'
  const isBusy = live.isTurnRunning || liveTasks(run).length > 0 || liveAgents(run).length > 0
  if (run.pause_requested_at) return isBusy ? 'pausing' : 'paused'
  if (live.isTurnRunning) return 'running'
  const tasks = liveTasks(run)
  if (tasks.some(t => t.kind === 'ci')) return 'waiting_ci'
  if (tasks.some(t => t.kind === 'tests')) return 'waiting_tests'
  if (tasks.length > 0 || liveAgents(run).length > 0) return 'waiting_agents'
  return 'stalled'
}

export function effectiveStatus(run: Run, nowSeconds: number): Status {
  if (isTerminal(run.status) || run.status === 'paused') return run.status
  return nowSeconds - run.owner.heartbeat_at > ORPHAN_AFTER_SECONDS ? 'orphaned' : run.status
}

export function isWaitingOnPerson(status: Status): boolean {
  return status === 'waiting_user' || status === 'waiting_permission' || status === 'blocked' || status === 'stalled'
}

export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h${String(m % 60).padStart(2, '0')}`
}


const TEXT: Record<Lang, Record<string, string>> = {
  es: {
    waitsYou: 'TE ESPERA',
    permission: 'PERMISO',
    blocked: 'BLOQUEADO',
    stalled: 'DETENIDO sin pendientes',
    orphaned: 'sesión cerrada · /wololo resume',
    agents: 'agentes',
    agent: 'agente',
    tasks: 'tareas',
    ci: 'esperando CI',
    tests: 'corriendo tests',
    done: 'terminado',
    failed: 'falló',
    cancelled: 'cancelado',
    ago: 'hace',
    working: 'trabajando',
    items: 'ítems',
    noStage: 'arrancando',
    stage: 'etapa',
  },
  en: {
    waitsYou: 'WAITING FOR YOU',
    permission: 'PERMISSION',
    blocked: 'BLOCKED',
    stalled: 'STOPPED with nothing pending',
    orphaned: 'session closed · /wololo resume',
    agents: 'agents',
    agent: 'agent',
    tasks: 'tasks',
    ci: 'waiting for CI',
    tests: 'running tests',
    done: 'done',
    failed: 'failed',
    cancelled: 'cancelled',
    ago: '',
    working: 'working',
    items: 'items',
    noStage: 'starting',
    stage: 'stage',
  },
}

export function t(lang: Lang, key: string): string {
  return TEXT[lang][key] ?? key
}

const ROLE_NAMES: Record<Lang, Record<string, [string, string]>> = {
  es: {
    explorer: ['explorador', 'exploradores'],
    architect: ['arquitecto', 'arquitectos'],
    critic: ['crítico', 'críticos'],
    implementer: ['implementador', 'implementadores'],
    verifier: ['verificador', 'verificadores'],
    reviewer: ['revisor', 'revisores'],
    main: ['orquestador', 'orquestadores'],
    other: ['otro agente', 'otros agentes'],
  },
  en: {
    explorer: ['explorer', 'explorers'],
    architect: ['architect', 'architects'],
    critic: ['critic', 'critics'],
    implementer: ['implementer', 'implementers'],
    verifier: ['verifier', 'verifiers'],
    reviewer: ['reviewer', 'reviewers'],
    main: ['orchestrator', 'orchestrators'],
    other: ['other agent', 'other agents'],
  },
}

export function roleName(lang: Lang, role: string, count: number): string {
  const names = ROLE_NAMES[lang][role]
  if (names) return count === 1 ? names[0] : names[1]
  return count === 1 ? role : `${role} ×${count}`
}

const ROLE_MARKS: Record<string, { icon: string; color: string }> = {
  explorer: { icon: '⌕', color: 'suggestion' },
  architect: { icon: '◫', color: 'planMode' },
  critic: { icon: '✗', color: 'warning' },
  implementer: { icon: '✎', color: 'claude' },
  verifier: { icon: '✓', color: 'success' },
  reviewer: { icon: '◉', color: 'merged' },
}

export function roleMark(role: string): { icon: string; color: string } {
  return ROLE_MARKS[role] ?? { icon: '•', color: 'text' }
}

export function shortModel(model: string | null): string {
  if (!model) return ''
  const family = /(opus|sonnet|haiku|fable)/i.exec(model)
  return family?.[1] ? family[1].toLowerCase() : model.replace(/^claude-/, '').replace(/\[.*\]$/, '')
}

export function agentScope(run: Run): { since: number; label: string } | null {
  const es = run.lang === 'es'
  const item = run.items.current
  if (item?.since !== undefined && run.stage?.id === 'implement') return { since: item.since, label: `${es ? 'el ítem' : 'item'} ${item.n}` }
  if (!run.stage) return null
  const stage = STAGES[run.stage.index]?.label[run.lang] ?? run.stage.id
  return { since: run.stage.since, label: es ? `la etapa ${stage}` : `stage ${stage}` }
}

export function finishedAgents(run: Run): AgentEntry[] {
  const scope = agentScope(run)
  if (!scope) return []
  return run.agents.filter(a => a.finished_at !== null && a.started_at >= scope.since)
}

export type AgentChip = { icon: string; color: string; text: string }

export function agentChips(run: Run, nowSeconds: number): AgentChip[] {
  const groups = new Map<string, AgentEntry[]>()
  for (const agent of liveAgents(run)) groups.set(agent.role, [...(groups.get(agent.role) ?? []), agent])
  const chips = [...groups].map(([role, agents]) => {
    const oldest = Math.min(...agents.map(a => a.started_at))
    const models = new Set(agents.map(a => shortModel(a.model)))
    const model = models.size === 1 ? [...models][0] : ''
    const count = agents.length > 1 ? `${agents.length} ` : ''
    return { ...roleMark(role), text: `${count}${roleName(run.lang, role, agents.length)}${model ? ` (${model})` : ''} ${duration(nowSeconds - oldest)}` }
  })
  const finished = finishedAgents(run)
  const failed = finished.filter(a => a.status === 'failed' || a.status === 'killed').length
  const es = run.lang === 'es'
  if (finished.length > failed) chips.push({ icon: '+', color: 'subtle', text: `${finished.length - failed} ${es ? (finished.length - failed === 1 ? 'listo' : 'listos') : 'done'}` })
  if (failed > 0) chips.push({ icon: '✕', color: 'error', text: `${failed} ${es ? (failed === 1 ? 'falló' : 'fallaron') : 'failed'}` })
  return chips
}

export function tokensText(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

export function usdText(usd: number): string {
  return `$${usd.toFixed(2)}`
}

export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}

function agentsSummary(run: Run, nowSeconds: number): string[] {
  const groups = new Map<string, AgentEntry[]>()
  for (const agent of liveAgents(run)) groups.set(agent.role, [...(groups.get(agent.role) ?? []), agent])
  return [...groups].map(([role, agents]) => {
    const oldest = Math.min(...agents.map(a => a.started_at))
    const count = agents.length > 1 ? `${agents.length} ` : ''
    return `${count}${roleName(run.lang, role, agents.length)} (${duration(nowSeconds - oldest)})`
  })
}

function tasksSummary(run: Run, nowSeconds: number): string[] {
  const tasks = liveTasks(run)
  const first = tasks[0]
  if (!first) return []
  const more = tasks.length > 1 ? ` (+${tasks.length - 1})` : ''
  return [`${clip(first.label, 40)} (${duration(nowSeconds - first.started_at)})${more}`]
}

export function runLabel(run: Run, max = 40): string {
  if (run.source.kind === 'github_issue') return shortRef(run)
  return clip(run.title || shortRef(run), max)
}

export function shortRef(run: Run): string {
  if (run.source.kind === 'github_issue') return run.source.ref.startsWith('#') ? run.source.ref : `#${run.source.ref}`
  return run.id.split('-').slice(-1)[0] ?? run.id
}

export function stageLabel(run: Run): string {
  if (!run.stage) return t(run.lang, 'noStage')
  const label = STAGES[run.stage.index]?.label[run.lang] ?? run.stage.id
  return `${run.stage.index + 1}/${STAGES.length} ${label}`
}

export function activity(run: Run, status: Status, nowSeconds: number): string {
  const name = badge(run.lang, status).toLowerCase()
  const detail = statusDetail(run, status, nowSeconds)
  return detail ? `${name}: ${detail}` : name
}

const BADGES: Record<Lang, Record<Status, string>> = {
  es: {
    running: 'TRABAJANDO',
    waiting_user: 'TE ESPERA',
    waiting_permission: 'PIDE PERMISO',
    waiting_agents: 'AGENTES TRABAJANDO',
    waiting_ci: 'ESPERANDO CI',
    waiting_tests: 'CORRIENDO TESTS',
    blocked: 'BLOQUEADO',
    stalled: 'DETENIDO',
    pausing: 'PAUSANDO',
    paused: 'PAUSADO',
    orphaned: 'SESIÓN CERRADA',
    done: 'TERMINADO',
    failed: 'FALLÓ',
    cancelled: 'CANCELADO',
  },
  en: {
    running: 'WORKING',
    waiting_user: 'WAITING FOR YOU',
    waiting_permission: 'NEEDS PERMISSION',
    waiting_agents: 'AGENTS WORKING',
    waiting_ci: 'WAITING FOR CI',
    waiting_tests: 'RUNNING TESTS',
    blocked: 'BLOCKED',
    stalled: 'STOPPED',
    pausing: 'PAUSING',
    paused: 'PAUSED',
    orphaned: 'SESSION CLOSED',
    done: 'DONE',
    failed: 'FAILED',
    cancelled: 'CANCELLED',
  },
}

const ICONS: Record<Status, string> = {
  running: '⟳',
  waiting_agents: '⟳',
  waiting_tests: '⟳',
  waiting_ci: '⧗',
  waiting_user: '?',
  waiting_permission: '!',
  stalled: '‖',
  pausing: '⏸',
  paused: '⏸',
  orphaned: '○',
  blocked: '✕',
  failed: '✕',
  done: '✓',
  cancelled: '■',
}

export function badge(lang: Lang, status: Status): string {
  return `${ICONS[status]} ${BADGES[lang][status]}`
}

export function statusDetail(run: Run, status: Status, nowSeconds: number, withAgents = true): string {
  const lang = run.lang
  const es = lang === 'es'
  const ago = (at: number) => (es ? `hace ${duration(nowSeconds - at)}` : `${duration(nowSeconds - at)} ago`)
  const working = [...(withAgents ? agentsSummary(run, nowSeconds) : []), ...tasksSummary(run, nowSeconds)].join(', ')
  switch (status) {
    case 'waiting_user':
      return run.waiting ? `${run.waiting.question} · ${ago(run.waiting.since)}` : ''
    case 'waiting_permission':
      return run.waiting ? `${run.waiting.question} · ${ago(run.waiting.since)}` : ''
    case 'blocked':
      return run.blocked ? `${run.blocked.reason} · ${ago(run.blocked.since)}` : ''
    case 'stalled':
      return es ? 'terminó el turno sin nada pendiente' : 'the turn ended with nothing pending'
    case 'pausing':
      return [es ? 'termina el paso en curso y se pausa' : 'finishing the current step, then pausing', working].filter(Boolean).join(' · ')
    case 'paused': {
      const note = run.paused?.note ? `${run.paused.note} · ` : ''
      return `${note}${es ? 'podés cerrar la sesión · /wololo resume para seguir' : 'safe to close the session · /wololo resume to go on'}`
    }
    case 'orphaned':
      return '/wololo resume'
    case 'waiting_ci':
    case 'waiting_tests':
    case 'waiting_agents':
    case 'running':
      return [run.doing?.text, working].filter(Boolean).join(' · ')
    case 'done':
    case 'failed':
    case 'cancelled':
      return run.summary ?? ''
  }
}

export function itemsText(run: Run): string {
  if (run.stage?.id !== 'implement' || run.items.total === 0) return ''
  const es = run.lang === 'es'
  const current = run.items.current
  if (current) return `${es ? 'ítem' : 'item'} ${current.n} ${es ? 'de' : 'of'} ${run.items.total}`
  return `${run.items.done}/${run.items.total} ${t(run.lang, 'items')}`
}

export function header(run: Run, status: Status, nowSeconds: number): string {
  const parts = [`wololo ${runLabel(run, 32)}`, stageLabel(run)]
  const items = itemsText(run)
  if (items) parts.push(items)
  parts.push(activity(run, status, nowSeconds))
  return `[${parts.join(' · ')}]`
}

export function statusLine(run: Run, status: Status, nowSeconds: number): string {
  const stage = run.stage ? `${t(run.lang, 'stage')} ${stageLabel(run)}` : t(run.lang, 'noStage')
  return `${runLabel(run)} · ${stage} · ${activity(run, status, nowSeconds)}`
}

const DIGEST_TYPES: ReadonlySet<EventType> = new Set<EventType>([
  'stage.completed',
  'gate.resolved',
  'assumption',
  'decision',
  'corrected',
  'blocked',
  'unblocked',
  'item.committed',
  'item.verified',
  'pr.opened',
  'pr.ready',
  'ci.updated',
  'run.finished',
  'stalled',
  'github.published',
])

export function sinceLastSeen(run: Run, events: readonly RunEvent[], sinceSeconds: number | null): string[] {
  const since = sinceSeconds ?? run.created_at
  return events
    .filter(e => e.ts > since && DIGEST_TYPES.has(e.type))
    .map(e => {
      const d = e.data
      const text = typeof d.text === 'string' ? d.text : typeof d.summary === 'string' ? d.summary : ''
      switch (e.type) {
        case 'stage.completed':
          return `✓ ${String(d.stage)}`
        case 'gate.resolved':
          return `✓ ${String(d.gate)}: ${String(d.outcome ?? 'approved')} (${String(d.by ?? 'user')})`
        case 'item.committed':
          return `✓ item ${String(d.n)} ${typeof d.title === 'string' ? d.title : ''}`.trim()
        case 'item.verified':
          return d.result === 'pass' ? '' : `✗ item ${String(d.n)}: ${String(d.result)}`
        case 'ci.updated':
          return `CI: ${String(d.state)}`
        case 'pr.opened':
          return `PR: ${String(d.url)}`
        case 'github.published':
          return `GitHub ${String(d.kind)}${d.mode === 'summary' ? ' (resumen)' : ''}: ${String(d.url ?? '')}`.trim()
        case 'blocked':
          return `⛔ ${String(d.reason)}`
        default:
          return `${e.type}: ${text}`.trim()
      }
    })
    .filter(line => line.length > 0)
}

export function nextSeq(run: Run): number {
  return run.last_seq + 1
}
