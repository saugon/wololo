import { expect, test } from 'claude-code/testing'

import { type Live, type Run, type RunEvent, apply, deriveStatus, effectiveStatus, emptyRun, header, rebuild, sinceLastSeen, statusLine } from '../hooks/model'

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
  expect(header(run, 'running', 120)).toBe('[wololo #4312 · 1/8 Contexto · ⟳ trabajando]')
  const asked = apply(run, { v: 1, seq: 3, ts: 120, run: 'r1', type: 'question.asked', data: { question: 'Gate A' } })
  expect(header(asked, 'waiting_user', 300)).toBe('[wololo #4312 · 1/8 Contexto · ? te espera: Gate A · hace 3m]')
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
  expect(header(run, 'waiting_tests', 300)).toBe('[wololo #4312 · 1/8 Contexto · ⟳ corriendo tests: make test (3m)]')
})

test('live agents are named by role and counted, tasks by what they do', async () => {
  let run = rebuild('r1', started)
  for (const [i, id] of ['a1', 'a2', 'a3'].entries()) {
    run = apply(run, { v: 1, seq: 3 + i, ts: 120, run: 'r1', type: 'agent.started', data: { id, role: 'explorer' } })
  }
  run = apply(run, { v: 1, seq: 6, ts: 150, run: 'r1', type: 'task.started', data: { id: 't1', label: 'Instalar dependencias del worktree', kind: 'other' } })
  expect(header(run, 'waiting_agents', 240)).toBe('[wololo #4312 · 1/8 Contexto · ⟳ agentes trabajando: 3 exploradores (2m), Instalar dependencias del worktree (1m)]')
})

test('a text run is named by its title, never by its id', async () => {
  const text = rebuild('r1', [
    { v: 1, seq: 1, ts: 100, run: 'r1', type: 'run.started', data: { title: 'Salones: más estado de mesa y vista 3D opcional', source: { kind: 'text', ref: 'x', url: null } } },
    { v: 1, seq: 2, ts: 110, run: 'r1', type: 'stage.entered', data: { stage: 'context' } },
  ])
  expect(statusLine(text, 'running', 120)).toBe('Salones: más estado de mesa y vista 3D… · etapa 1/8 Contexto · ⟳ trabajando')
})

test('doing says what is being done until the stage changes or it is replaced', async () => {
  let run = apply(rebuild('r1', started), { v: 1, seq: 3, ts: 130, run: 'r1', type: 'agent.started', data: { id: 'a1', role: 'implementer' } })
  run = apply(run, { v: 1, seq: 4, ts: 140, run: 'r1', type: 'doing', data: { text: 'Investigando por qué falla el e2e de mesas rotadas' } })
  expect(header(run, 'waiting_agents', 200)).toBe('[wololo #4312 · 1/8 Contexto · ⟳ agentes trabajando: Investigando por qué falla el e2e de mesas rotadas · implementador (1m)]')
  run = apply(run, { v: 1, seq: 5, ts: 150, run: 'r1', type: 'stage.entered', data: { stage: 'definition' } })
  expect(run.doing).toBe(null)
})

test('a pause requested while work runs reads as pausing, and as paused once nothing runs', async () => {
  let run = apply(rebuild('r1', started), { v: 1, seq: 3, ts: 130, run: 'r1', type: 'pause.requested', data: {} })
  expect(deriveStatus(run, { ...IDLE, isTurnRunning: true })).toBe('pausing')
  expect(deriveStatus(run, IDLE)).toBe('paused')
  run = apply(run, { v: 1, seq: 4, ts: 140, run: 'r1', type: 'paused', data: { note: 'sigue el ítem 4' } })
  expect(header(run, 'paused', 200)).toBe('[wololo #4312 · 1/8 Contexto · ⏸ pausado: sigue el ítem 4 · podés cerrar la sesión · /wololo resume para seguir]')
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
