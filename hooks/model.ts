export const SCHEMA_VERSION = 1
export const ORPHAN_AFTER_SECONDS = 90

export type Mode = 'full' | 'checkpoints' | 'guided'
export type Risk = 'low' | 'high' | 'unknown'
export type Lang = 'es' | 'en'

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
  { id: 'gate_a', isGate: true, label: { es: 'Gate A', en: 'Gate A' } },
  { id: 'plan', isGate: false, label: { es: 'Plan', en: 'Plan' } },
  {
    id: 'implement',
    isGate: false,
    label: { es: 'Implementación', en: 'Implementation' },
  },
  { id: 'evidence', isGate: false, label: { es: 'Evidencia', en: 'Evidence' } },
  { id: 'gate_b', isGate: true, label: { es: 'Gate B', en: 'Gate B' } },
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
  | 'blocked'
  | 'unblocked'
  | 'stalled'
  | 'ci.updated'
  | 'pr.opened'
  | 'pr.ready'
  | 'screenshot.saved'
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
  'blocked',
  'unblocked',
  'ci.updated',
  'pr.opened',
  'pr.ready',
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
    current: { n: number; title: string } | null
  }
  counts: {
    assumptions: number
    decisions: number
    corrections: number
    debate_turns: number
    attempts: number
    reversals: number
    nudges: number
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
  created_at: number
  updated_at: number
  finished_at: number | null
  outcome: Outcome | null
  summary: string | null
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
    items: { done: 0, total: 0, current: null },
    counts: {
      assumptions: 0,
      decisions: 0,
      corrections: 0,
      debate_turns: 0,
      attempts: 0,
      reversals: 0,
      nudges: 0,
    },
    pr: null,
    screenshots: [],
    owner: { session_id: '', cwd: '', heartbeat_at: ts },
    last_seq: 0,
    last_user_at: null,
    last_answer_at: null,
    created_at: ts,
    updated_at: ts,
    finished_at: null,
    outcome: null,
    summary: null,
  }
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
      r.stage = { id, index, total: STAGES.length, since: ev.ts }
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
      r.gates[id] = {
        ...gate,
        resolved_at: ev.ts,
        outcome: str(d.outcome, 'approved'),
        by: str(d.by, 'user'),
      }
      for (const s of r.stages) if (s.id === id && s.finished_at === null) s.finished_at = ev.ts
      break
    }
    case 'question.asked':
      r.waiting = { on: 'user', question: str(d.question), since: ev.ts }
      break
    case 'question.answered':
      if (r.waiting?.on === 'user') r.waiting = null
      r.last_answer_at = ev.ts
      break
    case 'permission.asked':
      if (r.waiting?.on !== 'user') r.waiting = { on: 'permission', question: str(d.tool), since: ev.ts }
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
      break
    case 'item.started':
      r.items.current = { n: num(d.n), title: str(d.title) }
      r.counts.attempts += 1
      if (d.reversal === true) r.counts.reversals += 1
      break
    case 'item.committed':
      r.items.done = Math.min(Math.max(r.items.done, num(d.n)), Math.max(r.items.total, num(d.n)))
      if (r.items.current?.n === num(d.n)) r.items.current = null
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
    case 'corrected':
      r.counts.corrections += 1
      break
    case 'blocked':
      r.blocked = { reason: str(d.reason), since: ev.ts }
      break
    case 'unblocked':
      r.blocked = null
      break
    case 'stalled':
      r.counts.nudges += 1
      break
    case 'ci.updated':
      if (r.pr) r.pr.ci = (d.state as 'pending' | 'passing' | 'failing') ?? r.pr.ci
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
    case 'run.finished': {
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
  if (live.isTurnRunning) return 'running'
  const tasks = liveTasks(run)
  if (tasks.some(t => t.kind === 'ci')) return 'waiting_ci'
  if (tasks.some(t => t.kind === 'tests')) return 'waiting_tests'
  if (tasks.length > 0 || liveAgents(run).length > 0) return 'waiting_agents'
  return 'stalled'
}

export function effectiveStatus(run: Run, nowSeconds: number): Status {
  if (isTerminal(run.status)) return run.status
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

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧']

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
  },
}

export function t(lang: Lang, key: string): string {
  return TEXT[lang][key] ?? key
}

export function shortRef(run: Run): string {
  if (run.source.kind === 'github_issue') return run.source.ref.startsWith('#') ? run.source.ref : `#${run.source.ref}`
  return run.id.split('-').slice(-1)[0] ?? run.id
}

export function stageLabel(run: Run): string {
  if (!run.stage) return t(run.lang, 'noStage')
  const def = STAGES[run.stage.index]
  const label = def?.label[run.lang] ?? run.stage.id
  return def?.isGate ? label : `${CIRCLED[run.stage.index] ?? ''} ${label}`.trim()
}

export function activity(run: Run, status: Status, nowSeconds: number): string {
  const lang = run.lang
  const since = (at: number) => `${t(lang, 'ago')} ${duration(nowSeconds - at)}`.trim()
  switch (status) {
    case 'waiting_user':
      return `❓ ${t(lang, 'waitsYou')} ${run.waiting ? since(run.waiting.since) : ''}`.trim()
    case 'waiting_permission':
      return `🔐 ${t(lang, 'permission')}: ${run.waiting?.question ?? ''}`.trim()
    case 'blocked':
      return `⛔ ${t(lang, 'blocked')}: ${run.blocked?.reason ?? ''}`.trim()
    case 'stalled':
      return `⚠ ${t(lang, 'stalled')}`
    case 'orphaned':
      return `💤 ${t(lang, 'orphaned')}`
    case 'waiting_ci':
      return `⏳ ${t(lang, 'ci')}`
    case 'waiting_tests': {
      const running = liveTasks(run).find(task => task.kind === 'tests')
      return `🧪 ${t(lang, 'tests')}${running ? ` ${duration(nowSeconds - running.started_at)}` : ''}`
    }
    case 'done':
      return `✓ ${t(lang, 'done')}`
    case 'failed':
      return `✗ ${t(lang, 'failed')}`
    case 'cancelled':
      return `■ ${t(lang, 'cancelled')}`
    default: {
      const agents = liveAgents(run)
      const tasks = liveTasks(run)
      const parts: string[] = []
      if (agents.length === 1 && agents[0]) parts.push(`⟳ ${agents[0].role} ${duration(nowSeconds - agents[0].started_at)}`)
      else if (agents.length > 1) parts.push(`⟳ ${agents.length} ${t(lang, 'agents')}`)
      if (tasks.length > 0) parts.push(`⏳ ${tasks.length} ${t(lang, 'tasks')}`)
      if (parts.length === 0) parts.push(`⟳ ${t(lang, 'working')}`)
      return parts.join(' · ')
    }
  }
}

export function header(run: Run, status: Status, nowSeconds: number): string {
  const parts = [`wololo ${shortRef(run)}`, stageLabel(run)]
  if (run.stage?.id === 'implement' && run.items.total > 0) parts.push(`${run.items.done}/${run.items.total} ${t(run.lang, 'items')}`)
  parts.push(activity(run, status, nowSeconds))
  return `[${parts.join(' · ')}]`
}

export function statusLine(run: Run, status: Status, nowSeconds: number): string {
  const index = run.stage ? (CIRCLED[run.stage.index] ?? '') : ''
  const def = run.stage ? STAGES[run.stage.index] : undefined
  const where = def?.isGate ? def.label[run.lang] : index
  if (isWaitingOnPerson(status) || isTerminal(status) || status === 'orphaned')
    return `wololo ${shortRef(run)} ${where} ${activity(run, status, nowSeconds)}`
  const n = liveAgents(run).length + liveTasks(run).length
  return `wololo ${shortRef(run)} ${where} ⟳${n > 0 ? n : ''}`.trim()
}

export function pills(run: Run): string {
  const done = new Set(run.stages.filter(s => s.finished_at !== null).map(s => s.id))
  return STAGES.map((s, i) => {
    const label = s.label[run.lang]
    if (run.stage?.index === i && !run.outcome) return `▶${label}`
    if (done.has(s.id)) return `✓${label}`
    return `·${label}`
  }).join(' ')
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
