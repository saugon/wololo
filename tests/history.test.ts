import { expect, test } from 'claude-code/testing'

import { historyMarkdown, timeline } from '../hooks/history'
import { type RunEvent, rebuild } from '../hooks/model'
import { buildView, pageOf, progressOf, wrapLines } from '../hooks/ui'

function events(list: Array<[RunEvent['type'], Record<string, unknown>]>): RunEvent[] {
  return list.map(([type, data], i) => ({ v: 1, seq: i + 1, ts: 1_800_000_000 + i * 60, run: 'r1', type, data }))
}

test('a block, the question asked about it and the answer read as one story', async () => {
  const lines = timeline(
    events([
      ['run.started', { title: 'Salones', mode: 'checkpoints' }],
      ['blocked', { reason: 'git commit falla por la firma de 1Password' }],
      ['question.asked', { question: 'Commit: ¿cómo sigo?' }],
      ['question.answered', { pairs: [{ header: 'Commit', question: '¿Cómo sigo?', answer: 'Ya desbloqueé 1Password' }], response: null }],
      ['unblocked', {}],
      ['agent.started', { id: 'a1', role: 'architect', description: 'plan mínimo' }],
      ['decision', { text: 'Usar el plan pragmático', by: 'claude' }],
    ]),
    'es',
  )
  expect(lines.filter(entry => entry.isMajor).map(entry => `${entry.icon} ${entry.text}`)).toEqual([
    '▶ Run iniciado: Salones (checkpoints)',
    '✕ Bloqueado: git commit falla por la firma de 1Password',
    '? Commit: ¿Cómo sigo? → Ya desbloqueé 1Password',
    '⟳ Desbloqueado',
    '◆ Decisión (automático): Usar el plan pragmático',
  ])
  expect(lines.find(entry => !entry.isMajor)?.text).toBe('Arrancó arquitecto: plan mínimo')
})

test('a question still open is listed as waiting for the answer', async () => {
  const lines = timeline(events([['question.asked', { question: 'Gate A: ¿Apruebo la spec?' }]]), 'es')
  expect(lines.map(entry => entry.text)).toEqual(['Gate A: ¿Apruebo la spec? (esperando tu respuesta)'])
})

test('gates say who resolved them and how', async () => {
  const lines = timeline(events([['gate.resolved', { gate: 'gate_a', outcome: 'approved', by: 'user' }]]), 'es')
  expect(lines[0]?.text).toBe('3/8 Aprobar spec: aprobado (vos)')
})

test('the card and the file list the newest event first', async () => {
  const list = events([
    ['run.started', { title: 'Salones', mode: 'checkpoints' }],
    ['blocked', { reason: 'primero' }],
    ['unblocked', {}],
    ['decision', { text: 'último', by: 'user' }],
  ])
  const view = buildView(rebuild('r1', list), 'running', list, 1_800_000_500)
  expect(view.history.map(row => row.text.slice(6))).toEqual([
    '◆ Decisión (vos): último',
    '⟳ Desbloqueado',
    '✕ Bloqueado: primero',
    '▶ Run iniciado: Salones (checkpoints)',
  ])
  expect(historyMarkdown('t', timeline(list, 'es')).split('\n')[2]).toContain('Decisión (vos): último')
})

test('a permission says what it was for and how it ended', async () => {
  const lines = timeline(
    events([
      ['permission.asked', { tool: 'Bash', what: 'make backend.test FILES=x' }],
      ['permission.resolved', { tool: 'Bash', what: 'make backend.test FILES=x', outcome: 'approved' }],
      ['permission.asked', { tool: 'Bash', what: 'rm -rf tmp' }],
      ['permission.resolved', { tool: 'Bash', what: 'rm -rf tmp', outcome: 'denied' }],
    ]),
    'es',
  )
  expect(lines.map(entry => `${entry.icon} ${entry.text}`)).toEqual([
    '! Pidió permiso: Bash · make backend.test FILES=x',
    '✓ Permiso concedido: Bash · make backend.test FILES=x',
    '! Pidió permiso: Bash · rm -rf tmp',
    '✕ Permiso denegado: Bash · rm -rf tmp',
  ])
})

test('deferred signatures are counted until the commits are signed', async () => {
  const list = events([
    ['signing.deferred', { n: 1, sha: 'aaa111' }],
    ['signing.deferred', { n: 2, sha: 'bbb222' }],
  ])
  expect(rebuild('r1', list).counts.unsigned).toBe(2)
  const signed = [...list, ...events([['signing.done', { count: 2 }]]).map(e => ({ ...e, seq: 3 }))]
  expect(rebuild('r1', signed).counts.unsigned).toBe(0)
  expect(timeline(signed, 'es').map(entry => entry.text)).toEqual([
    'Ítem 1 commiteado sin firma (se firma antes del push) aaa111',
    'Ítem 2 commiteado sin firma (se firma antes del push) bbb222',
    'Commits firmados: 2',
  ])
})

test('the summary starts with what is going on now, then the stages', async () => {
  const list = events([
    ['run.started', { title: 'Salones', mode: 'checkpoints' }],
    ['stage.entered', { stage: 'context' }],
    ['stage.entered', { stage: 'definition' }],
    ['stage.entered', { stage: 'gate_a' }],
    ['question.answered', {}],
    ['gate.resolved', { gate: 'gate_a', outcome: 'approved', by: 'user' }],
    ['stage.entered', { stage: 'plan' }],
    ['plan.ready', { items: ['a', 'b', 'c', 'd', 'e', 'f'] }],
    ['stage.entered', { stage: 'implement' }],
    ['item.started', { n: 6, title: 'Front: estado por mesa' }],
    ['agent.started', { id: 'a1', role: 'reviewer', description: 'Review item 6' }],
  ])
  const view = buildView(rebuild('r1', list), 'waiting_agents', list, 1_800_000_660)
  expect(view.details.slice(0, 4).map(row => row.text)).toEqual([
    'Ahora',
    '▶ 5/8 Implementación · 0/6 ítems',
    '  Ítem 6: Front: estado por mesa',
    '  ⟳ revisor (1m): Review item 6',
  ])
  expect(view.details.find(row => row.text.startsWith('✓ Aprobar spec'))?.text).toBe('✓ Aprobar spec: aprobado (vos), esperó 2m')
})

test('the items tab lists the plan with what is done, in progress, failing or pending', async () => {
  const list = events([
    ['run.started', { title: 'Salones', mode: 'checkpoints' }],
    ['plan.ready', { items: ['Back: migración', 'Back: API', 'Front: tipos', 'Front: capas'] }],
    ['item.started', { n: 1, title: 'Back: migración' }],
    ['item.committed', { n: 1, sha: '084cc5051abc', title: 'Back: migración' }],
    ['item.started', { n: 2, title: 'Back: API' }],
    ['item.verified', { n: 2, result: 'fail' }],
    ['item.started', { n: 3, title: 'Front: tipos' }],
  ])
  const view = buildView(rebuild('r1', list), 'running', list, 1_800_000_500)
  expect(view.items.map(row => row.text)).toEqual([
    '✓ 1. Back: migración  084cc5051',
    '✕ 2. Back: API',
    '▶ 3. Front: tipos',
    '· 4. Front: capas',
  ])
})

test('the progress bar fills done stages, the current one by its items, and says the percent', async () => {
  const list = events([
    ['run.started', { title: 'Salones', mode: 'checkpoints' }],
    ['stage.entered', { stage: 'context' }],
    ['stage.entered', { stage: 'definition' }],
    ['stage.entered', { stage: 'gate_a' }],
    ['question.answered', {}],
    ['gate.resolved', { gate: 'gate_a', outcome: 'approved', by: 'user' }],
    ['stage.entered', { stage: 'plan' }],
    ['plan.ready', { items: Array.from({ length: 15 }, (_, i) => `item ${i + 1}`) }],
    ['stage.entered', { stage: 'implement' }],
    ...Array.from({ length: 10 }, (_, i): [RunEvent['type'], Record<string, unknown>] => ['item.committed', { n: i + 1, sha: `s${i}` }]),
  ])
  const progress = progressOf(rebuild('r1', list))
  expect(progress.segments.map(segment => `${segment.short}:${segment.state}:${segment.filled}${segment.empty}`)).toEqual([
    'Con:done:████',
    'Def:done:████',
    'Spc:done:████',
    'Pla:done:████',
    'Imp:current:██▌░',
    'Evi:pending:░░░░',
    'Rev:pending:░░░░',
    'PR:pending:░░░░',
  ])
  expect(progress.percent).toBe(58)
  const finished = rebuild('r1', [...list, ...events([['run.finished', { outcome: 'done' }]]).map(e => ({ ...e, seq: 99 }))])
  expect(progressOf(finished).percent).toBe(100)
  expect(progressOf(finished).segments.every(segment => segment.state === 'done' && segment.filled === '████')).toBe(true)
})

test('a tab shows a window that fits, starting near the item in progress', async () => {
  const rows = Array.from({ length: 15 }, (_, i) => ({ text: `${i === 11 ? '▶' : '✓'} ${i + 1}.`, tone: 'text' as const }))
  const around = pageOf(rows, 6, -1, 11)
  expect(around.rows.map(row => row.text)).toEqual(['✓ 10.', '✓ 11.', '▶ 12.', '✓ 13.', '✓ 14.', '✓ 15.'])
  expect(around.start).toBe(9)
  const first = pageOf(rows, 6, 0, 11)
  expect(first.rows[0]?.text).toBe('✓ 1.')
  const past = pageOf(rows, 6, 40, -1)
  expect(past.start).toBe(9)
  expect(pageOf(rows.slice(0, 3), 6, -1, -1)).toEqual({ rows: rows.slice(0, 3), start: 0, size: 6, total: 3 })
})

test('a long detail wraps on words and ends in an ellipsis past its line budget', () => {
  const text = 'Pausado tras el ítem 12/15. Sigue: revisar el ítem 12, luego los ítems 13 a 15 y la suite final.'
  const lines = wrapLines(text, 30, 2)
  expect(lines).toHaveLength(2)
  expect(lines.every(line => line.length <= 30)).toBe(true)
  expect(lines[0]).toBe('Pausado tras el ítem 12/15.')
  expect(lines[1]?.endsWith('…')).toBe(true)
  expect(wrapLines('corto', 30, 3)).toEqual(['corto'])
  expect(wrapLines('', 30, 3)).toEqual([])
})
