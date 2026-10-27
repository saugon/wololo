import { expect, test } from 'claude-code/testing'

import { historyMarkdown, timeline } from '../hooks/history'
import { type RunEvent, rebuild } from '../hooks/model'
import { buildView } from '../hooks/ui'

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
  expect(lines[0]?.text).toBe('3/8 Gate A aprobado (vos)')
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
