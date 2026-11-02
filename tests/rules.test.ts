import { expect, test } from 'claude-code/testing'

import { type RunEvent, rebuild } from '../hooks/model'
import { changedSinceApproval, checkEvent, stageForFile } from '../hooks/rules'

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
    ['question.answered', { pairs: [{ header: 'Aprobar spec', question: '¿Apruebo?', answer: 'Aprobar (Recomendado)' }], answered: true }, 5],
  ])
  expect(checkEvent(answered, 'gate.resolved', { gate: 'gate_a', outcome: 'approved' })).toBe(null)
})

function atGateA(answer: Record<string, unknown>) {
  return runAt('checkpoints', [
    ['stage.entered', { stage: 'definition' }, 3],
    ['stage.entered', { stage: 'gate_a' }, 4],
    ['question.answered', answer, 5],
  ])
}

test('a gate is answered by its own question, and a cancelled dialog answers nothing', async () => {
  const cancelled = atGateA({ pairs: [{ header: 'Aprobar spec', question: '¿Apruebo?', answer: '' }], answered: false })
  expect(checkEvent(cancelled, 'gate.resolved', { gate: 'gate_a', outcome: 'approved' })).toMatch(/cancelled dialog/)
  const elsewhere = atGateA({ pairs: [{ header: 'Commit', question: '¿Cómo sigo?', answer: 'Aprobar' }], answered: true })
  expect(checkEvent(elsewhere, 'gate.resolved', { gate: 'gate_a', outcome: 'approved' })).toMatch(/Aprobar spec/)
  const english = atGateA({ pairs: [{ header: 'Approve spec', question: 'Approve?', answer: 'Approve (Recommended)' }], answered: true })
  expect(checkEvent(english, 'gate.resolved', { gate: 'gate_a', outcome: 'approved' })).toBe(null)
})

test('only an approving answer approves a gate, and changes leave it pending until asked again', async () => {
  const adjust = atGateA({ pairs: [{ header: 'Aprobar spec', question: '¿Apruebo?', answer: 'Ajustar' }], answered: true })
  expect(checkEvent(adjust, 'gate.resolved', { gate: 'gate_a', outcome: 'approved' })).toMatch(/not an approval/)
  expect(checkEvent(adjust, 'gate.resolved', { gate: 'gate_a', outcome: 'changes' })).toBe(null)
  const changed = runAt('checkpoints', [
    ['stage.entered', { stage: 'definition' }, 3],
    ['stage.entered', { stage: 'gate_a' }, 4],
    ['question.answered', { pairs: [{ header: 'Aprobar spec', question: '¿Apruebo?', answer: 'Ajustar' }], answered: true }, 5],
    ['gate.resolved', { gate: 'gate_a', outcome: 'changes', by: 'user' }, 6],
  ])
  expect(checkEvent(changed, 'stage.entered', { stage: 'plan' })).toMatch(/gate_a is not resolved/)
  const approved = runAt('checkpoints', [
    ['stage.entered', { stage: 'definition' }, 3],
    ['stage.entered', { stage: 'gate_a' }, 4],
    ['question.answered', { pairs: [{ header: 'Aprobar spec', question: '¿Apruebo?', answer: 'Ajustar' }], answered: true }, 5],
    ['gate.resolved', { gate: 'gate_a', outcome: 'changes', by: 'user' }, 6],
    ['question.answered', { pairs: [{ header: 'Aprobar spec', question: '¿Apruebo?', answer: 'Aprobar (Recomendado)' }], answered: true }, 7],
    ['gate.resolved', { gate: 'gate_a', outcome: 'approved', by: 'user' }, 8],
  ])
  expect(checkEvent(approved, 'stage.entered', { stage: 'plan' })).toBe(null)
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

const approvedSpec = { spec: 'aaa', plan: null, tree: 't1' }

function pastGateA() {
  return runAt('checkpoints', [
    ['stage.entered', { stage: 'definition' }, 3],
    ['stage.entered', { stage: 'gate_a' }, 4],
    ['question.answered', { pairs: [{ header: 'Aprobar spec', question: '¿Apruebo?', answer: 'Aprobar' }], answered: true }, 5],
    ['gate.resolved', { gate: 'gate_a', outcome: 'approved', by: 'user', snapshot: approvedSpec }, 6],
    ['stage.entered', { stage: 'plan' }, 7],
  ])
}

test('moving on after a gate needs what it approved unchanged', async () => {
  const run = pastGateA()
  expect(changedSinceApproval(run, 'stage.entered', { stage: 'implement' }, { spec: 'aaa', plan: 'p1', tree: 't2' })).toBe(null)
  expect(changedSinceApproval(run, 'stage.entered', { stage: 'implement' }, { spec: 'bbb', plan: 'p1', tree: 't2' })).toMatch(
    /spec\.md changed after Aprobar spec approved it: go back with stage\.entered \{stage: "definition"/,
  )
  // Going back is how to redo it, and is never refused for it.
  expect(changedSinceApproval(run, 'stage.entered', { stage: 'definition', reason: 'x' }, { spec: 'bbb', plan: null, tree: 't1' })).toBe(null)
})

test('opening the PR needs the code, spec and plan Aprobar PR saw', async () => {
  const run = runAt('full', [
    ['stage.entered', { stage: 'definition' }, 3],
    ['gate.resolved', { gate: 'gate_a', by: 'auto', snapshot: approvedSpec }, 4],
    ['gate.resolved', { gate: 'gate_b', by: 'auto', snapshot: { spec: 'aaa', plan: 'p1', tree: 't9' } }, 5],
  ])
  expect(changedSinceApproval(run, 'pr.opened', { url: 'u' }, { spec: 'aaa', plan: 'p1', tree: 't9' })).toBe(null)
  expect(changedSinceApproval(run, 'pr.opened', { url: 'u' }, { spec: 'aaa', plan: 'p1', tree: 't10' })).toMatch(/the committed code changed after Aprobar PR.*"implement"/)
})

test('going back before a gate reopens it, so it is asked again', async () => {
  const back = runAt('checkpoints', [
    ['stage.entered', { stage: 'definition' }, 3],
    ['stage.entered', { stage: 'gate_a' }, 4],
    ['question.answered', { pairs: [{ header: 'Aprobar spec', question: '¿Apruebo?', answer: 'Aprobar' }], answered: true }, 5],
    ['gate.resolved', { gate: 'gate_a', outcome: 'approved', by: 'user', snapshot: approvedSpec }, 6],
    ['stage.entered', { stage: 'plan' }, 7],
    ['stage.entered', { stage: 'definition', reason: 'the spec changed' }, 8],
    ['stage.entered', { stage: 'gate_a' }, 9],
  ])
  expect(back.gates.gate_a?.resolved_at).toBe(null)
  expect(checkEvent(back, 'stage.entered', { stage: 'plan' })).toMatch(/gate_a is not resolved/)
  // The answer given before going back no longer counts.
  expect(checkEvent(back, 'gate.resolved', { gate: 'gate_a', outcome: 'approved' })).toMatch(/its own question/)
})

const budgets = { design_reversals: 2, ci_fix_attempts: 2, run_minutes: 240 }

function implementing(extra: Array<[RunEvent['type'], Record<string, unknown>, number]> = []) {
  return runAt('full', [
    ['stage.entered', { stage: 'definition' }, 3],
    ['stage.entered', { stage: 'plan' }, 4],
    ['stage.entered', { stage: 'implement' }, 5],
    ...extra,
  ])
}

test('an item gets as many design reversals as the budget allows, then the person decides', async () => {
  const twice = implementing([
    ['item.started', { n: 1, title: 'a' }, 6],
    ['item.started', { n: 1, title: 'a', reversal: true }, 7],
    ['item.started', { n: 1, title: 'a', reversal: true }, 8],
  ])
  expect(checkEvent(twice, 'item.started', { n: 1, title: 'a', reversal: true }, budgets)).toMatch(/budgets\.design_reversals.*record blocked/)
  expect(checkEvent(twice, 'item.started', { n: 2, title: 'b', reversal: true }, budgets)).toBe(null)
  // The person cannot be skipped: unblocking needs their answer after the block.
  const blocked = implementing([
    ['item.started', { n: 1, title: 'a', reversal: true }, 7],
    ['item.started', { n: 1, title: 'a', reversal: true }, 8],
    ['blocked', { reason: 'budget' }, 9],
  ])
  expect(checkEvent(blocked, 'unblocked', { budget: 'design_reversals' })).toMatch(/needs the person/)
  const extended = implementing([
    ['item.started', { n: 1, title: 'a', reversal: true }, 7],
    ['item.started', { n: 1, title: 'a', reversal: true }, 8],
    ['blocked', { reason: 'budget' }, 9],
    ['question.answered', { pairs: [{ header: 'Presupuesto', question: '¿Sigo?', answer: 'Sí' }], answered: true }, 10],
  ])
  expect(checkEvent(extended, 'unblocked', { budget: 'design_reversals' })).toBe(null)
  const after = implementing([
    ['item.started', { n: 1, title: 'a', reversal: true }, 7],
    ['item.started', { n: 1, title: 'a', reversal: true }, 8],
    ['blocked', { reason: 'budget' }, 9],
    ['question.answered', { pairs: [{ header: 'Presupuesto', question: '¿Sigo?', answer: 'Sí' }], answered: true }, 10],
    ['unblocked', { budget: 'design_reversals' }, 11],
  ])
  expect(checkEvent(after, 'item.started', { n: 1, title: 'a', reversal: true }, budgets)).toBe(null)
})

test('CI gets as many fixes as the budget allows', async () => {
  const pr = runAt('full', [
    ['stage.entered', { stage: 'definition' }, 3],
    ['stage.entered', { stage: 'pr' }, 4],
    ['pr.opened', { url: 'u', number: 1 }, 5],
    ['ci.updated', { state: 'failing' }, 6],
    ['ci.updated', { state: 'failing' }, 7],
  ])
  expect(checkEvent(pr, 'item.started', { n: 9, title: 'fix CI' }, budgets)).toBe(null)
  const spent = runAt('full', [
    ['stage.entered', { stage: 'definition' }, 3],
    ['stage.entered', { stage: 'pr' }, 4],
    ['pr.opened', { url: 'u', number: 1 }, 5],
    ['ci.updated', { state: 'failing' }, 6],
    ['ci.updated', { state: 'failing' }, 7],
    ['ci.updated', { state: 'failing' }, 8],
  ])
  expect(checkEvent(spent, 'item.started', { n: 9, title: 'fix CI' }, budgets)).toMatch(/budgets\.ci_fix_attempts/)
})

test("a run that spent its minutes stops moving on until the person extends them", async () => {
  const long = implementing()
  long.time = { implement: { work: 200 * 60, agents: 50 * 60, tests: 0, you: 600 * 60, roles: {} } }
  expect(checkEvent(long, 'item.started', { n: 1, title: 'a' }, budgets)).toMatch(/budgets\.run_minutes/)
  expect(checkEvent(long, 'stage.entered', { stage: 'evidence' }, budgets)).toMatch(/budgets\.run_minutes/)
  // Waiting for the person does not count.
  long.time = { implement: { work: 100 * 60, agents: 50 * 60, tests: 0, you: 600 * 60, roles: {} } }
  expect(checkEvent(long, 'item.started', { n: 1, title: 'a' }, budgets)).toBe(null)
})
