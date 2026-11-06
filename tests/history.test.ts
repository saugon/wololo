import { expect, test } from 'claude-code/testing'

import { historyMarkdown, timeline } from '../hooks/history'
import { type RunEvent, durationUp, rebuild, shortModel } from '../hooks/model'
import { buildView, fitChips, progressOf, wrapLines } from '../hooks/ui'

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
  expect(view.details.slice(0, 3).map(row => row.text)).toEqual(['Ahora', '  Ítem 6: Front: estado por mesa', '  ◉ revisor 1m  Review item 6'])
  expect(view.details.find(row => row.text.startsWith('✓ Aprobar spec'))?.text).toBe('✓ Aprobar spec: aprobado (vos), esperó 2m')
  expect(view.band.stageText).toBe('Implementación · ítem 6 de 6')
  expect(view.header).toContain('5/8 Implementación · ítem 6 de 6')
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

test('the card names the live agents by role and model, and counts the ones that finished in the item', async () => {
  const list = events([
    ['run.started', { title: 'Salones', mode: 'checkpoints' }],
    ['stage.entered', { stage: 'implement' }],
    ['plan.ready', { items: ['a', 'b', 'c'] }],
    ['agent.started', { id: 'a0', role: 'explorer', model: 'claude-haiku-5-5' }],
    ['agent.finished', { id: 'a0' }],
    ['item.started', { n: 2, title: 'b' }],
    ['agent.started', { id: 'a1', role: 'implementer', model: 'claude-sonnet-5-5', description: 'Item 2' }],
    ['agent.finished', { id: 'a1' }],
    ['agent.started', { id: 'a2', role: 'verifier', model: 'claude-sonnet-5-5' }],
    ['agent.finished', { id: 'a2', status: 'failed' }],
    ['agent.started', { id: 'a3', role: 'reviewer', model: 'claude-opus-5-5[1m]', description: 'Review item 2' }],
    ['agent.started', { id: 'a4', role: 'explorer', model: 'claude-haiku-5-5' }],
    ['agent.started', { id: 'a5', role: 'explorer', model: 'claude-haiku-5-5' }],
  ])
  const run = rebuild('r1', list)
  const view = buildView(run, 'waiting_agents', list, 1_800_000_780)
  expect(view.band.agents.map(chip => `${chip.icon} ${chip.text}`)).toEqual(['◉ revisor (opus) 3m', '⌕ 2 exploradores (haiku) 2m', '+ 1 listo', '✕ 1 falló'])
  expect(view.band.detail).toBe('')
  expect(view.header).toContain('revisor (3m), 2 exploradores (2m)')
  expect(view.details.slice(2, 8).map(row => row.text)).toEqual([
    '  ◉ revisor       opus   3m  Review item 2',
    '  ⌕ explorador    haiku  2m',
    '  ⌕ explorador    haiku  1m',
    '  Terminados en el ítem 2',
    '  ✎ implementador sonnet 1m  Item 2',
    '  ✓ verificador   sonnet 1m falló',
  ])
  expect(view.details[7]?.tone).toBe('error')
  expect(buildView(run, 'waiting_user', list, 1_800_000_780).band.agents).toEqual([])
})

test('agent chips that do not fit are cut with an ellipsis, never past the width', () => {
  const chips = [
    { icon: '◉', color: 'merged', text: 'revisor (opus) 3m' },
    { icon: '⌕', color: 'suggestion', text: '2 exploradores (haiku) 2m' },
  ]
  expect(fitChips(chips, 80).map(chip => chip.label)).toEqual(['◉ revisor (opus) 3m', '⌕ 2 exploradores (haiku) 2m'])
  const cut = fitChips(chips, 30)
  expect(cut.map(chip => chip.label)).toEqual(['◉ revisor (opus) 3m', '⌕ 2 exp…'])
  expect(cut.reduce((sum, chip, i) => sum + chip.label.length + (i > 0 ? 3 : 0), 0)).toBeLessThanOrEqual(30)
  expect(fitChips(chips, 22).map(chip => chip.label)).toEqual(['◉ revisor (opus) 3m'])
})

test('a model id reads as its family', () => {
  expect(shortModel('claude-opus-5-5[1m]')).toBe('opus')
  expect(shortModel('claude-sonnet-5-5')).toBe('sonnet')
  expect(shortModel('gpt-5-codex')).toBe('gpt-5-codex')
  expect(shortModel(null)).toBe('')
})

test('the summary says what each stage cost, by role, and the total', async () => {
  const list = events([
    ['run.started', { title: 'Salones', mode: 'checkpoints' }],
    ['stage.entered', { stage: 'context' }],
    ['usage', { stage: 'context', role: 'main', input: 1_000, output: 2_000, cache_read: 50_000, cache_write: 0, usd: 0.4 }],
    ['usage', { stage: 'context', role: 'explorer', input: 3_000, output: 8_000, cache_read: 300_000, cache_write: 9_000, usd: 1.1 }],
    ['stage.entered', { stage: 'definition' }],
    ['usage', { stage: 'definition', role: 'critic', input: 0, output: 10_000, cache_read: 1_200_000, cache_write: 0, usd: 2.05 }],
  ])
  const view = buildView(rebuild('r1', list), 'running', list, 1_800_000_660)
  const texts = view.details.map(row => row.text)
  expect(texts.find(text => text.startsWith('✓ Contexto'))).toBe('✓ Contexto  3m · $1.50')
  const start = texts.indexOf('Consumo por etapa (aprox.)')
  expect(texts.slice(start + 1, start + 4)).toEqual([
    '  Contexto    $1.50    373k tok  explorador $1.10 · orquestador $0.40',
    '  Definición  $2.05    1.2M tok  crítico $2.05',
    '  Total       $3.55    1.6M tok  98% de caché · 20k de salida',
  ])
})

test('the summary says where each stage spent its time, and how long its agents ran by role', async () => {
  const list = events([
    ['run.started', { title: 'Salones', mode: 'checkpoints' }],
    ['stage.entered', { stage: 'context' }],
    ['agent.started', { id: 'a1', role: 'explorer' }],
    ['agent.started', { id: 'a2', role: 'explorer' }],
    ['agent.finished', { id: 'a1' }],
    ['agent.finished', { id: 'a2' }],
    ['time', { stage: 'context', kind: 'work', seconds: 60 }],
    ['time', { stage: 'context', kind: 'agents', seconds: 120 }],
    ['stage.entered', { stage: 'definition' }],
    ['time', { stage: 'definition', kind: 'you', seconds: 30 }],
  ])
  const view = buildView(rebuild('r1', list), 'running', list, 1_800_000_720)
  const texts = view.details.map(row => row.text)
  const start = texts.indexOf('Tiempo por etapa')
  // Active leaves out what the stage waited for the person; each time rounds up to the unit it shows, never down.
  expect(texts.slice(start + 1, start + 6)).toEqual([
    '              activo  total',
    '  Contexto        7m     7m  trabajando 1m · agentes 2m · sin medir 4m',
    '                             agentes en total: explorador 4m',
    '  Definición      4m     4m  te esperó 30s · sin medir 4m',
    '  Total          11m    11m  trabajando 1m · agentes 2m · te esperó 30s · sin medir 8m',
  ])
  expect(durationUp(59)).toBe('59s')
  expect(durationUp(60)).toBe('1m')
  expect(durationUp(61)).toBe('2m')
  expect(durationUp(3_599)).toBe('1h00')
  expect(durationUp(9_601)).toBe('2h41')
})

test('the summary names the worktree, its branch against the base, its HEAD and the run ports', async () => {
  const list = events([
    ['run.started', { title: 'Salones', mode: 'checkpoints', slot: 1, project: { key: 'acme__shop', path: '/home/t/shop', worktree: '/home/t/shop/.claude/worktrees/wololo-r1', branch: 'wololo/txt-salones', base: 'main' } }],
    ['stage.entered', { stage: 'evidence' }],
  ])
  const info = {
    head: '09d8f8a',
    subject: 'Front: toggle Plana/3D',
    ahead: 14,
    behind: 2,
    dirty: 1,
    ports: [
      { name: 'backend', port: 4110, listening: true },
      { name: 'foods', port: 3111, listening: false },
    ],
  }
  const texts = buildView(rebuild('r1', list), 'running', list, 1_800_000_200, undefined, undefined, info, '/home/t').details.map(row => row.text)
  const start = texts.indexOf('Worktree')
  expect(texts.slice(start + 1, start + 5)).toEqual([
    '  ~/shop/.claude/worktrees/wololo-r1',
    '  rama wololo/txt-salones · base main · 14 adelante · 2 atrás',
    '  HEAD 09d8f8a Front: toggle Plana/3D · 1 archivo sin commitear',
    '  Puertos (slot 1): backend 4110 escuchando · foods 3111 libre',
  ])
})

test('going back to an earlier stage leaves the later ones to do again, on the bar and in the summary', async () => {
  const list = events([
    ['run.started', { title: 'Salones', mode: 'checkpoints' }],
    ['stage.entered', { stage: 'context' }],
    ['stage.entered', { stage: 'definition' }],
    ['stage.entered', { stage: 'gate_a' }],
    ['question.answered', {}],
    ['gate.resolved', { gate: 'gate_a', outcome: 'approved', by: 'user' }],
    ['stage.entered', { stage: 'plan' }],
    ['stage.entered', { stage: 'implement' }],
    ['stage.entered', { stage: 'evidence' }],
    ['stage.entered', { stage: 'gate_b' }],
    ['stage.entered', { stage: 'implement', reason: 'the review asked for changes' }],
  ])
  const run = rebuild('r1', list)
  expect(progressOf(run).segments.map(segment => segment.state)).toEqual(['done', 'done', 'done', 'done', 'current', 'pending', 'pending', 'pending'])
  const texts = buildView(run, 'running', list, 1_800_000_700).details.map(row => row.text)
  expect(texts.find(text => text.includes('Evidencia'))?.startsWith('↺ Evidencia')).toBe(true)
  expect(texts.find(text => text.includes('Plan'))?.startsWith('✓ Plan')).toBe(true)
})
