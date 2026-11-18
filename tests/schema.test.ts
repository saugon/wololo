import { expect, test } from 'claude-code/testing'

import { EVENT_TYPES, type EventType, type ItemEntry, type Outcome, type Run, type RunEvent, STAGES, type Status, apply, emptyRun } from '../hooks/model'
// Tests can't read JSON, so these mirror schema/v1 byte for byte. After changing a schema, regenerate them from the plugin's root:
//   for f in run event; do { printf 'export default '; cat schema/v1/$f.schema.json; } > tests/schema/$f.schema.ts; done
import eventSchema from './schema/event.schema'
import runSchema from './schema/run.schema'

type Schema = { [keyword: string]: unknown }

const RUN_SCHEMA = runSchema as Schema
const EVENT_SCHEMA = eventSchema as Schema

const KEYWORDS = new Set(['$schema', '$id', 'title', 'description', 'type', 'enum', 'const', 'properties', 'additionalProperties', 'items', 'required', 'minimum'])

function isSchema(value: unknown): value is Schema {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function propertiesOf(schema: Schema): Record<string, Schema> {
  return isSchema(schema.properties) ? (schema.properties as Record<string, Schema>) : {}
}

function jsonType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  return typeof value
}

// Paths are written as the schema nests them: `.key` for a property, `.*` for a key under additionalProperties, `[]` for an array's items.
function schemaPaths(schema: Schema, path = ''): string[] {
  return [
    ...Object.entries(propertiesOf(schema)).flatMap(([key, sub]) => [`${path}.${key}`, ...schemaPaths(sub, `${path}.${key}`)]),
    ...(isSchema(schema.additionalProperties) ? [`${path}.*`, ...schemaPaths(schema.additionalProperties, `${path}.*`)] : []),
    ...(isSchema(schema.items) ? [`${path}[]`, ...schemaPaths(schema.items, `${path}[]`)] : []),
  ]
}

function unknownKeywords(schema: Schema, path = ''): string[] {
  return [
    ...Object.keys(schema)
      .filter(keyword => !KEYWORDS.has(keyword))
      .map(keyword => `${path || '(root)'}: ${keyword}`),
    ...Object.entries(propertiesOf(schema)).flatMap(([key, sub]) => unknownKeywords(sub, `${path}.${key}`)),
    ...(isSchema(schema.additionalProperties) ? unknownKeywords(schema.additionalProperties, `${path}.*`) : []),
    ...(isSchema(schema.items) ? unknownKeywords(schema.items, `${path}[]`) : []),
  ]
}

// Checks a value against a schema, and notes the schema paths it reached. Stricter than JSON Schema on purpose: where the schema lists
// properties, a key it doesn't list is a problem unless additionalProperties describes it.
function walk(schema: Schema, value: unknown, path: string, out: { problems: string[]; seen: Set<string> }, at = path) {
  out.seen.add(path)
  const unknown = Object.keys(schema).filter(keyword => !KEYWORDS.has(keyword))
  if (unknown.length > 0) out.problems.push(`${at}: unknown schema keyword ${unknown.join(', ')}`)
  const type = jsonType(value)
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!types.includes(type) && !(type === 'integer' && types.includes('number'))) {
      out.problems.push(`${at}: ${type} where the schema says ${types.join(' or ')}`)
      return
    }
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) out.problems.push(`${at}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`)
  if ('const' in schema && schema.const !== value) out.problems.push(`${at}: ${JSON.stringify(value)} is not ${JSON.stringify(schema.const)}`)
  if (typeof schema.minimum === 'number' && typeof value === 'number' && value < schema.minimum) out.problems.push(`${at}: ${value} is below ${schema.minimum}`)
  if (type === 'object') {
    const object = value as Record<string, unknown>
    for (const key of Array.isArray(schema.required) ? schema.required : []) if (!(key in object)) out.problems.push(`${at}.${key}: required`)
    const properties = propertiesOf(schema)
    for (const [key, sub] of Object.entries(object)) {
      if (properties[key]) walk(properties[key], sub, `${path}.${key}`, out, `${at}.${key}`)
      else if (isSchema(schema.additionalProperties)) walk(schema.additionalProperties, sub, `${path}.*`, out, `${at}.${key}`)
      else if (schema.properties !== undefined || schema.additionalProperties === false) out.problems.push(`${at}.${key}: not in the schema`)
    }
  }
  if (Array.isArray(value) && isSchema(schema.items)) value.forEach((item, i) => walk(schema.items as Schema, item, `${path}[]`, out, `${at}[${i}]`))
}

function check(schema: Schema, value: unknown) {
  const out = { problems: [] as string[], seen: new Set<string>() }
  walk(schema, JSON.parse(JSON.stringify(value)), '', out)
  return out
}

// One event of every type, with the data that fills every optional field of the run at some point.
const DATA: Array<[EventType, Record<string, unknown>]> = [
  [
    'run.started',
    {
      title: 'Partial payments',
      source: { kind: 'github_issue', ref: '42', url: 'https://github.com/acme/shop/issues/42' },
      project: { key: 'acme__shop', path: '/repo', worktree: null, branch: null, base: 'main' },
      mode: 'checkpoints',
      review: 'pr',
      overrides: { 'gates.plan': 'skip' },
      risk: 'low',
      lang: 'en',
      slot: 1,
      session_id: 's1',
      cwd: '/repo',
    },
  ],
  ['owner.changed', { session_id: 's2', cwd: '/repo', worktree: '/repo/.wt', branch: 'wololo/42' }],
  ['branch.renamed', { from: 'wololo/42', to: 'feat/42-pagos' }],
  ['slot.changed', { from: 4, to: 3 }],
  ['instance.used', { from: 3, slot: 6, reason: 'the person tests on instance 6' }],
  ['base.changed', { from: 'feat/41-envios', to: 'main', reason: 'feat/41-envios merged' }],
  ['risk.set', { risk: 'high' }],
  ['stage.entered', { stage: 'context' }],
  ['doing', { text: 'reading the issue' }],
  ['agent.started', { id: 'a1', role: 'explorer', description: 'map the code', model: 'claude-opus' }],
  ['task.started', { id: 't0', label: 'grep in the background', kind: 'other', agent: 'a1' }],
  ['agent.finished', { id: 'a1', status: 'completed' }],
  ['task.started', { id: 't1', label: 'npm test', kind: 'tests' }],
  ['task.finished', { id: 't1', status: 'completed' }],
  ['time', { stage: 'context', kind: 'work', seconds: 30 }],
  ['time', { stage: 'context', kind: 'agents', seconds: 12.5 }],
  ['time', { stage: 'context', kind: 'tests', seconds: 3 }],
  ['time', { stage: 'context', kind: 'you', seconds: 4 }],
  ['time', { stage: 'context', kind: 'paused', seconds: 5 }],
  ['time', { stage: 'context', kind: 'review', seconds: 6 }],
  ['usage', { stage: 'context', role: 'main', input: 10, output: 20, cache_read: 30, cache_write: 40, usd: 0.5 }],
  ['assumption', { text: 'only tables' }],
  ['decision', { text: 'use the small plan', by: 'claude' }],
  ['corrected', { text: 'not that file' }],
  ['debate.turn', { stage: 'definition', role: 'critic' }],
  ['stage.completed', { stage: 'context' }],
  ['stage.entered', { stage: 'gate_a' }],
  ['gate.requested', { gate: 'gate_a' }],
  ['question.asked', { question: 'Approve spec?' }],
  ['question.answered', { pairs: [{ header: 'Approve spec', answer: 'Approve' }] }],
  ['gate.resolved', { gate: 'gate_a', outcome: 'approved', by: 'user', snapshot: { spec: 'h1', plan: null, tree: 't1' } }],
  ['permission.asked', { tool: 'Bash', what: 'rm -rf dist' }],
  ['permission.resolved', {}],
  ['stage.entered', { stage: 'plan' }],
  ['plan.ready', { items: ['first', 'second'] }],
  ['stage.entered', { stage: 'implement' }],
  ['item.started', { n: 1, title: 'first', reversal: true }],
  ['item.verified', { n: 1, result: 'pass', worktree_tree: 'tree1' }],
  ['item.reviewed', { n: 1 }],
  ['item.committed', { n: 1, title: 'first', sha: 'abc123' }],
  ['final_review', { verdict: 'pass', findings: 2, tree: 'tree1' }],
  ['item.started', { n: 2, title: 'second' }],
  ['item.verified', { n: 2, result: 'fail' }],
  ['adapter.started', { point: 'verify', step: 0, cmd: 'make check', job: '/tmp/job', pid: 4321, known: { port: '3000' }, wait: 'cat /tmp/job.code' }],
  ['adapter.ran', { point: 'verify', captured: { url: 'http://localhost:3000' } }],
  ['blocked', { reason: 'design reversals budget spent' }],
  ['unblocked', { budget: 'design_reversals' }],
  ['blocked', { reason: 'run minutes spent' }],
  ['unblocked', { budget: 'run_minutes', amount: 60 }],
  ['stalled', {}],
  ['signing.deferred', {}],
  ['signing.done', {}],
  ['pause.requested', {}],
  ['paused', { note: 'lunch' }],
  ['resumed', {}],
  ['pr.opened', { url: 'https://github.com/acme/shop/pull/7', number: 7, draft: true }],
  ['ci.updated', { state: 'failing' }],
  ['pr.ready', {}],
  ['review.waiting', {}],
  ['pr.closed', {}],
  ['pr.merged', {}],
  ['github.published', { kind: 'pr_create', url: 'https://github.com/acme/shop/pull/7' }],
  ['screenshot.saved', { file: '01-cart.png', caption: 'the cart' }],
  ['stage.entered', { stage: 'gate_b' }],
  ['question.asked', { question: 'Approve PR?' }],
  ['run.finished', { outcome: 'done', summary: 'opened the PR' }],
]

const EVENTS: RunEvent[] = DATA.map(([type, data], i) => ({ v: 1, seq: i + 1, ts: 1_800_000_000 + i * 10, run: 'r1', type, data }))

// The run after each event, so that fields an event clears later are seen too.
const RUNS: Run[] = EVENTS.reduce<Run[]>((runs, ev) => [...runs, apply(runs.at(-1) ?? emptyRun('r1', ev.ts), ev)], [])

// Every field of Run: a field added to the type fails to compile until it is listed here, and then this test fails until the schema has it.
const RUN_FIELDS = {
  schema_version: true,
  id: true,
  title: true,
  source: true,
  project: true,
  mode: true,
  adapter_vars: true,
  adapter_job: true,
  review: true,
  overrides: true,
  risk: true,
  lang: true,
  slot: true,
  instance_used: true,
  stage: true,
  stages: true,
  gates: true,
  status: true,
  waiting: true,
  blocked: true,
  block_since: true,
  agents: true,
  tasks: true,
  items: true,
  counts: true,
  pr: true,
  screenshots: true,
  owner: true,
  last_seq: true,
  last_user_at: true,
  last_answer_at: true,
  last_answer: true,
  created_at: true,
  updated_at: true,
  finished_at: true,
  outcome: true,
  summary: true,
  doing: true,
  final_review: true,
  usage: true,
  time: true,
  pause_requested_at: true,
  paused: true,
  pr_review: true,
} satisfies Record<keyof Run, true>

const STATUSES = {
  running: true,
  waiting_user: true,
  waiting_permission: true,
  waiting_agents: true,
  waiting_ci: true,
  waiting_tests: true,
  blocked: true,
  stalled: true,
  pausing: true,
  paused: true,
  in_review: true,
  orphaned: true,
  done: true,
  failed: true,
  cancelled: true,
} satisfies Record<Status, true>

const OUTCOMES = { done: true, failed: true, cancelled: true } satisfies Record<Outcome, true>

const ITEM_STATES = { pending: true, active: true, failing: true, done: true } satisfies Record<ItemEntry['state'], true>

function sorted(list: readonly unknown[]): string[] {
  return list.map(value => JSON.stringify(value)).sort()
}

function enumAt(root: Schema, path: string[]): unknown[] {
  const schema = path.reduce<Schema>((at, key) => (key === '[]' && isSchema(at.items) ? at.items : (propertiesOf(at)[key] ?? {})), root)
  return Array.isArray(schema.enum) ? schema.enum : []
}

test('the event types the code knows are the ones the event schema lists', async () => {
  expect(sorted(EVENT_TYPES)).toEqual(sorted(enumAt(EVENT_SCHEMA, ['type'])))
})

test('the schemas use only the keywords this test checks', async () => {
  expect([...unknownKeywords(RUN_SCHEMA), ...unknownKeywords(EVENT_SCHEMA)]).toEqual([])
})

test('the fixture has one event of every type, and each fits the event schema', async () => {
  expect(sorted([...new Set(EVENTS.map(ev => ev.type))])).toEqual(sorted(EVENT_TYPES))
  expect(EVENTS.flatMap(ev => check(EVENT_SCHEMA, ev).problems)).toEqual([])
})

test('the run the events build fits the run schema at every step', async () => {
  expect(RUNS.flatMap((run, i) => check(RUN_SCHEMA, run).problems.map(problem => `after ${EVENTS[i]?.type}: ${problem}`))).toEqual([])
})

test('the fixture reaches every field the run schema describes', async () => {
  const seen = new Set(RUNS.flatMap(run => [...check(RUN_SCHEMA, run).seen]))
  expect(schemaPaths(RUN_SCHEMA).filter(path => !seen.has(path))).toEqual([])
})

test('every field of Run is in the run schema, and nothing else', async () => {
  expect(Object.keys(propertiesOf(RUN_SCHEMA)).sort()).toEqual(Object.keys(RUN_FIELDS).sort())
})

test('statuses, stages, outcomes and item states match the code', async () => {
  expect(sorted(enumAt(RUN_SCHEMA, ['status']))).toEqual(sorted(Object.keys(STATUSES).filter(status => status !== 'orphaned')))
  expect(sorted(enumAt(RUN_SCHEMA, ['stage', 'id']))).toEqual(sorted(STAGES.map(stage => stage.id)))
  expect(sorted(enumAt(RUN_SCHEMA, ['outcome']))).toEqual(sorted([...Object.keys(OUTCOMES), null]))
  expect(sorted(enumAt(RUN_SCHEMA, ['items', 'list', '[]', 'state']))).toEqual(sorted(Object.keys(ITEM_STATES)))
})

test('the check finds an undeclared field and a leaf of the wrong type', async () => {
  const run = RUNS.at(-1) as Run
  const bad = { ...run, extra: 1, counts: { ...run.counts, attempts: 'many' }, items: { ...run.items, list: [{ n: 1, title: 'x', state: 'gone', sha: 3 }] } }
  expect(check(RUN_SCHEMA, bad).problems).toEqual([
    '.items.list[0].state: "gone" is not one of ["pending","active","failing","done"]',
    '.items.list[0].sha: integer where the schema says string or null',
    '.counts.attempts: string where the schema says integer',
    '.extra: not in the schema',
  ])
})
