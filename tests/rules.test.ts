import { expect, test } from 'claude-code/testing'

import { type RunEvent, rebuild } from '../hooks/model'
import { checkEvent, stageForFile } from '../hooks/rules'

function runAt(mode: string, extra: Array<[RunEvent['type'], Record<string, unknown>, number]> = []) {
  const list: Array<[RunEvent['type'], Record<string, unknown>, number]> = [
    ['run.started', { title: 't', source: { kind: 'text', ref: 'x', url: null }, mode }, 1],
    ['stage.entered', { stage: 'context' }, 2],
    ...extra,
  ]
  return rebuild(
    'r1',
    list.map(([type, data, ts], i) => ({ v: 1, seq: i + 1, ts, run: 'r1', type, data })),
  )
}

test('stages cannot be skipped', async () => {
  expect(checkEvent(runAt('checkpoints'), 'stage.entered', { stage: 'definition' })).toBe(null)
  expect(checkEvent(runAt('checkpoints'), 'stage.entered', { stage: 'plan' })).toMatch(/definition/)
})

test('outside full mode a gate needs an answer given after it was requested', async () => {
  const atGate = runAt('checkpoints', [
    ['stage.entered', { stage: 'definition' }, 3],
    ['stage.entered', { stage: 'gate_a' }, 4],
  ])
  expect(checkEvent(atGate, 'stage.entered', { stage: 'plan' })).toMatch(/gate_a is not resolved/)
  expect(checkEvent(atGate, 'gate.resolved', { gate: 'gate_a', outcome: 'approved' })).toMatch(/AskUserQuestion/)
  expect(checkEvent(atGate, 'gate.resolved', { gate: 'gate_a', by: 'auto' })).toMatch(/full-autonomy/)
  const answered = runAt('checkpoints', [
    ['stage.entered', { stage: 'definition' }, 3],
    ['stage.entered', { stage: 'gate_a' }, 4],
    ['question.answered', {}, 5],
  ])
  expect(checkEvent(answered, 'gate.resolved', { gate: 'gate_a', outcome: 'approved' })).toBe(null)
})

test('a full run may skip gates and resolve them by itself', async () => {
  const full = runAt('full', [['stage.entered', { stage: 'definition' }, 3]])
  expect(checkEvent(full, 'stage.entered', { stage: 'plan' })).toBe(null)
  expect(checkEvent(full, 'gate.resolved', { gate: 'gate_a', by: 'auto' })).toBe(null)
})

test('events carry the fields the dashboard needs', async () => {
  const run = runAt('checkpoints')
  expect(checkEvent(run, 'assumption', {})).toMatch(/text/)
  expect(checkEvent(run, 'item.committed', { n: 'one' })).toMatch(/n/)
  expect(checkEvent(run, 'run.finished', { outcome: 'ok' })).toMatch(/outcome/)
  expect(checkEvent(run, 'question.asked', {})).toMatch(/Unknown event type/)
})

test('going back needs a reason', async () => {
  const run = runAt('checkpoints', [['stage.entered', { stage: 'definition' }, 3]])
  expect(checkEvent(run, 'stage.entered', { stage: 'context' })).toMatch(/reason/)
  expect(checkEvent(run, 'stage.entered', { stage: 'context', reason: 'the spec contradicts the code' })).toBe(null)
})

test('stage files map back to stages, the shared gates file does not', async () => {
  expect(stageForFile('03-plan.md')).toBe('plan')
  expect(stageForFile('gates.md')).toBe(null)
})

test('a deferred signature names the item and the commit', async () => {
  const run = runAt('checkpoints')
  expect(checkEvent(run, 'signing.deferred', { n: 1 })).toMatch(/sha/)
  expect(checkEvent(run, 'signing.deferred', { n: 1, sha: 'abc123' })).toBe(null)
  expect(checkEvent(run, 'signing.done', { count: 3 })).toBe(null)
})
