import { expect, test } from 'claude-code/testing'

import { type Live, type Run, type RunEvent, apply, deriveStatus, effectiveStatus, emptyRun, header, rebuild, reviewStatus, type PrReview, sinceLastSeen, statusDetail, statusLine, awakeUntil } from '../hooks/model'

const IDLE: Live = { isTurnRunning: false, question: null, permission: null }

function events(...list: Array<[RunEvent['type'], Record<string, unknown>, number]>): RunEvent[] {
  return list.map(([type, data, ts], i) => ({ v: 1, seq: i + 1, ts, run: 'r1', type, data }))
}

const started = events(
  ['run.started', { title: 'Pagos parciales', source: { kind: 'github_issue', ref: '4312', url: null }, mode: 'checkpoints', slot: 2, session_id: 's1', cwd: '/repo' }, 100],
  ['stage.entered', { stage: 'context' }, 110],
)

test('run.started and stage.entered build the snapshot', async () => {
  const run = rebuild('r1', started)
  expect(run.title).toBe('Pagos parciales')
  expect(run.slot).toBe(2)
  expect(run.stage?.id).toBe('context')
  expect(run.stage?.index).toBe(0)
  expect(run.owner.session_id).toBe('s1')
  expect(run.last_seq).toBe(2)
})

test('run.started keeps the goal node the run was launched from, and only a whole one', async () => {
  const start = (node: unknown) => events(['run.started', { title: 'x', source: { kind: 'text', ref: 'x', url: null }, node }, 100])
  expect(rebuild('r1', start({ goal: 'g1', id: 'n1' })).node).toEqual({ goal: 'g1', id: 'n1' })
  expect(rebuild('r1', start({ goal: 'g1' })).node).toBeUndefined()
  expect(rebuild('r1', started).node).toBeUndefined()
})

test('entering the next stage closes the previous one', async () => {
  const run = rebuild('r1', [...started, ...events(['stage.entered', { stage: 'definition' }, 200]).map(e => ({ ...e, seq: 3 }))])
  expect(run.stages.find(s => s.id === 'context')?.finished_at).toBe(200)
  expect(run.stage?.id).toBe('definition')
})

test('a pending question wins over a running turn', async () => {
  const run = rebuild('r1', started)
  expect(deriveStatus(run, { ...IDLE, isTurnRunning: true, question: 'Gate A: aprobar' })).toBe('waiting_user')
})

test('a turn that ended with a live agent is waiting on agents, not stalled', async () => {
  const run = apply(rebuild('r1', started), { v: 1, seq: 3, ts: 120, run: 'r1', type: 'agent.started', data: { id: 'a1', role: 'explorer' } })
  expect(deriveStatus(run, IDLE)).toBe('waiting_agents')
  const finished = apply(run, { v: 1, seq: 4, ts: 130, run: 'r1', type: 'agent.finished', data: { id: 'a1' } })
  expect(deriveStatus(finished, IDLE)).toBe('stalled')
})

test('a CI watch task reads as waiting_ci', async () => {
  const run = apply(rebuild('r1', started), { v: 1, seq: 3, ts: 120, run: 'r1', type: 'task.started', data: { id: 't1', label: 'gh pr checks --watch', kind: 'ci' } })
  expect(deriveStatus(run, IDLE)).toBe('waiting_ci')
})

test('waiting on CI names the CI watch first, and drops what the orchestrator noted before the wait began', async () => {
  const ev = (seq: number, ts: number, type: RunEvent['type'], data: Record<string, unknown>): RunEvent => ({ v: 1, seq, ts, run: 'r1', type, data })
  const list = [
    ev(3, 100, 'task.started', { id: 't0', label: 'Run the backend on port 4060', kind: 'server' }),
    ev(4, 110, 'doing', { text: 'Rebasing the PR on main' }),
    ev(5, 200, 'task.started', { id: 't1', label: 'Watch the CI checks', kind: 'ci' }),
  ]
  const run = list.reduce(apply, rebuild('r1', started))
  expect(statusDetail(run, 'waiting_ci', 260)).toBe('Watch the CI checks (1m) (+1)')
  const noted = apply(run, ev(6, 210, 'doing', { text: 'Waiting for CI on the rebased PR' }))
  expect(statusDetail(noted, 'waiting_ci', 260)).toBe('Waiting for CI on the rebased PR · Watch the CI checks (1m) (+1)')
})

test('blocked beats running, a question beats blocked', async () => {
  const run = apply(rebuild('r1', started), { v: 1, seq: 3, ts: 120, run: 'r1', type: 'blocked', data: { reason: 'tests deleted' } })
  expect(deriveStatus(run, { ...IDLE, isTurnRunning: true })).toBe('blocked')
  expect(deriveStatus(run, { ...IDLE, question: 'qué hago' })).toBe('waiting_user')
})

test('a stale heartbeat reads as orphaned, a finished run never does', async () => {
  const run: Run = { ...rebuild('r1', started), status: 'running' }
  expect(effectiveStatus(run, run.owner.heartbeat_at + 30)).toBe('running')
  expect(effectiveStatus(run, run.owner.heartbeat_at + 300)).toBe('orphaned')
  expect(effectiveStatus({ ...run, status: 'done' }, run.owner.heartbeat_at + 300)).toBe('done')
})

test('the header names the issue, the stage and what it waits on', async () => {
  const run = rebuild('r1', started)
  expect(header(run, 'running', 120)).toBe('[wololo #4312 · 1/9 Contexto · ⟳ trabajando]')
  const asked = apply(run, { v: 1, seq: 3, ts: 120, run: 'r1', type: 'question.asked', data: { question: 'Gate A' } })
  expect(header(asked, 'waiting_user', 300)).toBe('[wololo #4312 · 1/9 Contexto · ? te espera: Gate A · hace 3m]')
})

test('since_last_seen lists what happened after the given time only', async () => {
  const list = [
    ...started,
    ...events(['assumption', { text: 'solo mesas' }, 150], ['stage.completed', { stage: 'context' }, 160]).map((e, i) => ({ ...e, seq: 3 + i })),
  ]
  const run = rebuild('r1', list)
  expect(sinceLastSeen(run, list, 155)).toEqual(['✓ context'])
  expect(sinceLastSeen(run, list, 120)).toEqual(['assumption: solo mesas', '✓ context'])
})

test('a gate answer is remembered for the gate check', async () => {
  const run = apply(emptyRun('r1', 0), { v: 1, seq: 1, ts: 50, run: 'r1', type: 'question.answered', data: {} })
  expect(run.last_answer_at).toBe(50)
})

test('a running test suite reads as waiting_tests, and the header says so', async () => {
  const run = apply(rebuild('r1', started), { v: 1, seq: 3, ts: 120, run: 'r1', type: 'task.started', data: { id: 't1', label: 'make test', kind: 'tests' } })
  expect(deriveStatus(run, IDLE)).toBe('waiting_tests')
  expect(header(run, 'waiting_tests', 300)).toBe('[wololo #4312 · 1/9 Contexto · ⟳ corriendo tests: make test (3m)]')
})

test('live agents are named by role and counted, tasks by what they do', async () => {
  let run = rebuild('r1', started)
  for (const [i, id] of ['a1', 'a2', 'a3'].entries()) {
    run = apply(run, { v: 1, seq: 3 + i, ts: 120, run: 'r1', type: 'agent.started', data: { id, role: 'explorer' } })
  }
  run = apply(run, { v: 1, seq: 6, ts: 150, run: 'r1', type: 'task.started', data: { id: 't1', label: 'Instalar dependencias del worktree', kind: 'other' } })
  expect(header(run, 'waiting_agents', 240)).toBe('[wololo #4312 · 1/9 Contexto · ⟳ agentes trabajando: 3 exploradores (2m), Instalar dependencias del worktree (1m)]')
})

test('a text run is named by its title, never by its id', async () => {
  const text = rebuild('r1', [
    { v: 1, seq: 1, ts: 100, run: 'r1', type: 'run.started', data: { title: 'Salones: más estado de mesa y vista 3D opcional', source: { kind: 'text', ref: 'x', url: null } } },
    { v: 1, seq: 2, ts: 110, run: 'r1', type: 'stage.entered', data: { stage: 'context' } },
  ])
  expect(statusLine(text, 'running', 120)).toBe('Salones: más estado de mesa y vista 3D… · etapa 1/9 Contexto · ⟳ trabajando')
})

test('doing says what is being done until the stage changes or it is replaced', async () => {
  let run = apply(rebuild('r1', started), { v: 1, seq: 3, ts: 130, run: 'r1', type: 'agent.started', data: { id: 'a1', role: 'implementer' } })
  run = apply(run, { v: 1, seq: 4, ts: 140, run: 'r1', type: 'doing', data: { text: 'Investigando por qué falla el e2e de mesas rotadas' } })
  expect(header(run, 'waiting_agents', 200)).toBe('[wololo #4312 · 1/9 Contexto · ⟳ agentes trabajando: Investigando por qué falla el e2e de mesas rotadas · implementador (1m)]')
  run = apply(run, { v: 1, seq: 5, ts: 150, run: 'r1', type: 'stage.entered', data: { stage: 'definition' } })
  expect(run.doing).toBe(null)
})

test('a pause requested while work runs reads as pausing, and as paused once nothing runs', async () => {
  let run = apply(rebuild('r1', started), { v: 1, seq: 3, ts: 130, run: 'r1', type: 'pause.requested', data: {} })
  expect(deriveStatus(run, { ...IDLE, isTurnRunning: true })).toBe('pausing')
  expect(deriveStatus(run, IDLE)).toBe('paused')
  run = apply(run, { v: 1, seq: 4, ts: 140, run: 'r1', type: 'paused', data: { note: 'sigue el ítem 4' } })
  expect(header(run, 'paused', 200)).toBe('[wololo #4312 · 1/9 Contexto · ⏸ pausado: sigue el ítem 4 · podés cerrar la sesión · /wololo resume para seguir]')
  expect(effectiveStatus({ ...run, status: 'paused' }, 10_000)).toBe('paused')
  run = apply(run, { v: 1, seq: 5, ts: 150, run: 'r1', type: 'resumed', data: {} })
  expect(deriveStatus(run, { ...IDLE, isTurnRunning: true })).toBe('running')
})

test('a background task cannot outlive the session that started it', async () => {
  let run = apply(rebuild('r1', started), { v: 1, seq: 3, ts: 120, run: 'r1', type: 'task.started', data: { id: 't1', label: 'make backend.run', kind: 'server' } })
  run = apply(run, { v: 1, seq: 4, ts: 9_000, run: 'r1', type: 'owner.changed', data: { session_id: 's1', cwd: '/repo' } })
  expect(run.tasks[0]?.finished_at).toBe(9_000)
  expect(run.tasks[0]?.status).toBe('gone')
  expect(deriveStatus(run, IDLE)).toBe('stalled')
})

test("a background shell a subagent started closes when that agent finishes, and stops keeping the run busy", async () => {
  const list = events(
    ['run.started', { title: 'Pagos', source: { kind: 'text', ref: 'x', url: null }, mode: 'full', slot: 1, session_id: 's1', cwd: '/repo' }, 100],
    ['stage.entered', { stage: 'context' }, 110],
    ['agent.started', { id: 'a1', role: 'implementer', description: 'Implement item 1' }, 120],
    ['task.started', { id: 't1', label: 'Run the storefront suite', kind: 'other', agent: 'a1' }, 130],
    ['task.started', { id: 't2', label: 'make dev', kind: 'server' }, 140],
  )
  const working = rebuild('r1', list)
  expect(working.tasks.map(t => t.agent)).toEqual(['a1', null])
  const done = apply(working, { v: 1, seq: 6, ts: 200, run: 'r1', type: 'agent.finished', data: { id: 'a1', status: 'completed' } })
  expect(done.tasks.map(t => [t.id, t.finished_at, t.status])).toEqual([
    ['t1', 200, 'gone'],
    ['t2', null, null],
  ])
  const idle = apply(done, { v: 1, seq: 7, ts: 210, run: 'r1', type: 'task.finished', data: { id: 't2', status: 'completed' } })
  expect(deriveStatus(idle, IDLE)).toBe('stalled')
})

test('an item past the plan, such as the review leftovers, grows it', async () => {
  let run = rebuild('r1', started)
  run = apply(run, { v: 1, seq: 3, ts: 120, run: 'r1', type: 'plan.ready', data: { items: ['a', 'b'] } })
  run = apply(run, { v: 1, seq: 4, ts: 130, run: 'r1', type: 'item.started', data: { n: 3, title: 'Pendientes de la revisión' } })
  expect(run.items.total).toBe(3)
  expect(run.items.list?.map(item => item.title)).toEqual(['a', 'b', 'Pendientes de la revisión'])
})

test('a renamed branch becomes the run branch, and is in what happened since the person last looked', async () => {
  let run = apply(rebuild('r1', started), { v: 1, seq: 3, ts: 120, run: 'r1', type: 'owner.changed', data: { session_id: 's1', cwd: '/repo', branch: 'wololo/4312-pagos' } })
  const renamed: RunEvent = { v: 1, seq: 4, ts: 130, run: 'r1', type: 'branch.renamed', data: { from: 'wololo/4312-pagos', to: 'feat/4312-pagos' } }
  run = apply(run, renamed)
  expect(run.project.branch).toBe('feat/4312-pagos')
  expect(sinceLastSeen(run, [renamed], 125).length).toBe(1)
})

test('a changed base becomes the run base, and is in what happened since the person last looked', async () => {
  const changed: RunEvent = { v: 1, seq: 3, ts: 130, run: 'r1', type: 'base.changed', data: { from: 'feat/4542-andreani', to: 'main' } }
  const run = apply(rebuild('r1', started), changed)
  expect(run.project.base).toBe('main')
  expect(sinceLastSeen(run, [changed], 125)).toEqual(['Base: feat/4542-andreani → main'])
})

test('a run whose PR is ready waits in review, works on the review, and is never orphaned', async () => {
  const list = events(
    ...started.map(ev => [ev.type, ev.data, ev.ts] as [RunEvent['type'], Record<string, unknown>, number]),
    ['stage.entered', { stage: 'pr' }, 120],
    ['pr.opened', { url: 'https://github.com/acme/shop/pull/7', number: 7, draft: false }, 130],
    ['review.waiting', {}, 140],
  )
  const run = rebuild('r1', list)
  expect(run.pr_review).toEqual({ since: 140 })
  expect(deriveStatus(run, IDLE)).toBe('in_review')
  expect(deriveStatus(run, { ...IDLE, isTurnRunning: true })).toBe('running')
  const reviewing = { ...run, status: deriveStatus(run, IDLE) }
  expect(effectiveStatus(reviewing, 140 + 3600)).toBe('in_review')
  expect(statusDetail(reviewing, 'in_review', 200)).toBe('PR #7 esperando review; termina al mergearse o con /wololo done · hace 1m')
  const closed = apply(run, { v: 1, seq: 9, ts: 300, run: 'r1', type: 'pr.closed', data: {} })
  expect(closed.pr?.state).toBe('closed')
  expect(deriveStatus(closed, IDLE)).toBe('waiting_user')
  expect(closed.waiting?.question).toBe('El PR #7 se cerró sin mergear: ¿lo doy por cancelado?')
})

test('time while the machine slept is left out: a stretch counts only up to the last tick before the gap', async () => {
  // Ticking every second: all of it counts.
  expect(awakeUntil(1_000, 1_600, 1_599)).toBe(1_600)
  // The lid closed after the tick at 1_100 and the machine woke at 37_000: only up to 1_100 counts.
  expect(awakeUntil(1_000, 37_000, 1_100)).toBe(1_100)
  // A stretch that began after the last tick (an event while waking) counts nothing of the sleep.
  expect(awakeUntil(1_200, 37_000, 1_100)).toBe(1_200)
  // No tick yet (the mod just loaded): the whole stretch counts.
  expect(awakeUntil(1_000, 37_000, null)).toBe(37_000)
})

test('a PR in review says the one thing that stands before its merge, and who has to move', async () => {
  const base: PrReview = { decision: 'review_required', approved_by: [], changes_by: [], requested: ['ana', 'leo', 'mia'], unanswered: 0, checks: 'passing', failing: 0, behind: false }
  const status = (pr: Parameters<typeof reviewStatus>[0], lang: 'es' | 'en' = 'es') => {
    const s = reviewStatus(pr, lang)
    return s ? `${s.ball}: ${s.text}` : null
  }
  expect(status({})).toBeNull()
  expect(status({ review: base })).toBe('reviewer: esperando review de @ana, @leo y 1 más')
  expect(status({ review: { ...base, checks: 'pending' } })).toBe('wait: CI corriendo')
  expect(status({ review: { ...base, checks: 'pending', unanswered: 2 } })).toBe('claude: 2 comentarios sin responder')
  expect(status({ review: { ...base, unanswered: 1, decision: 'changes_requested', changes_by: ['ana'] } })).toBe('claude: cambios pedidos por @ana')
  expect(status({ review: { ...base, decision: 'changes_requested', checks: 'failing', failing: 3 } })).toBe('claude: CI falla (3)')
  expect(status({ review: { ...base, checks: 'failing' }, queue: { position: 1, state: 'QUEUED' } })).toBe('github: en la merge queue (1.º)')
  expect(status({ review: base, conflicts: true, queue: { position: 1, state: 'QUEUED' } })).toBe('claude: tiene conflictos con la base')
  expect(status({ review: { ...base, decision: 'approved', approved_by: ['ana'], requested: [] } })).toBe('you: aprobado por @ana · listo para mergear')
  expect(status({ review: { ...base, decision: null, requested: [], behind: true } }, 'en')).toBe('you: ready to merge · behind its base')
  expect(status({ review: { ...base, requested: [] } }, 'en')).toBe('reviewer: waiting on review')
})
