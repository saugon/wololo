import { type BudgetName, type EventType, MODEL_EVENTS, type Run, STAGES, type Snapshot, type StageId, activeMinutes, stageIndex } from './model'

export const STAGE_FILES: Record<StageId, string> = {
  context: '01-context.md',
  definition: '02-definition.md',
  gate_a: 'gates.md',
  plan: '03-plan.md',
  implement: '04-implement.md',
  evidence: '05-evidence.md',
  gate_b: 'gates.md',
  pr: '06-pr.md',
}

export function stageForFile(name: string): StageId | null {
  const match = Object.entries(STAGE_FILES).find(([, file]) => file === name && file !== 'gates.md')
  return match ? (match[0] as StageId) : null
}

function text(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function isGate(id: StageId): boolean {
  return STAGES[stageIndex(id)]?.isGate === true
}

// The AskUserQuestion header each gate is asked under, as stages/gates.md names it to the person.
const GATE_HEADERS: Partial<Record<StageId, readonly string[]>> = {
  gate_a: ['Aprobar spec', 'Approve spec'],
  gate_b: ['Aprobar PR', 'Approve PR'],
}
const APPROVAL = /^\s*(aprobar|approve)\b/i

// A gate the run passes by itself: every gate in full mode, and Aprobar PR when the change is approved on the PR.
function selfResolved(run: Run, id: StageId): boolean {
  return run.mode === 'full' || (id === 'gate_b' && run.review === 'pr')
}

function gateResolved(run: Run, id: StageId): boolean {
  return run.gates[id]?.resolved_at != null
}

export type Budgets = Record<BudgetName, number>

const BUDGET_WHAT: Record<BudgetName, string> = {
  design_reversals: 'design reversals for one item',
  ci_fix_attempts: 'CI fixes',
  run_minutes: "minutes of the run's own work",
}

// A spent budget stops the run in every mode: the person decides whether it goes on.
function overBudget(run: Run, type: string, data: Record<string, unknown>, budgets: Budgets): string | null {
  const allowed = (name: BudgetName) =>
    budgets[name] * (1 + (run.counts.budget_extensions?.[name] ?? 0)) + (run.counts.budget_added?.[name] ?? 0)
  const spent = (name: BudgetName, used: number) =>
    `${allowed(name)} ${BUDGET_WHAT[name]} (budgets.${name} and its extensions) are spent, ${Math.round(used)} used: record blocked, ask the person how much to add (offer amounts), and record unblocked {budget: "${name}", amount} with what they chose.`
  if (type === 'item.started' && data.reversal === true) {
    const used = run.counts.reversals_by_item?.[Number(data.n)] ?? 0
    if (used >= allowed('design_reversals')) return spent('design_reversals', used)
  }
  if (type === 'item.started' && run.stage?.id === 'pr') {
    const failures = run.counts.ci_failures ?? 0
    if (failures > allowed('ci_fix_attempts')) return spent('ci_fix_attempts', failures - 1)
  }
  const forward = type === 'stage.entered' && stageIndex(data.stage as StageId) > (run.stage?.index ?? -1)
  if (forward || type === 'item.started') {
    const minutes = activeMinutes(run)
    if (minutes > allowed('run_minutes')) return spent('run_minutes', minutes)
  }
  return null
}

export function checkEvent(run: Run, type: string, data: Record<string, unknown>, budgets?: Budgets): string | null {
  if (!MODEL_EVENTS.has(type as EventType)) return `Unknown event type "${type}". Allowed: ${[...MODEL_EVENTS].join(', ')}.`
  if (run.outcome) return `The run already finished (${run.outcome}). Start a new one with /wololo.`
  const budget = budgets ? overBudget(run, type, data, budgets) : null
  if (budget) return budget

  switch (type as EventType) {
    case 'stage.entered': {
      const target = data.stage as StageId
      const ti = stageIndex(target)
      if (ti < 0) return `Unknown stage "${String(data.stage)}". Stages: ${STAGES.map(s => s.id).join(', ')}.`
      const ci = run.stage?.index ?? -1
      if (ti <= ci) return text(data.reason) ? null : `Going back to ${target} needs data.reason.`
      const current = run.stage?.id
      if (current && isGate(current) && !gateResolved(run, current) && !selfResolved(run, current)) {
        return `${current} is not resolved. Ask the person with AskUserQuestion, then record gate.resolved.`
      }
      for (const skipped of STAGES.slice(ci + 1, ti)) {
        if (skipped.isGate && selfResolved(run, skipped.id)) continue
        if (skipped.isGate && !gateResolved(run, skipped.id)) return `${skipped.id} must be resolved before ${target}.`
        if (!skipped.isGate)
          return `Enter ${skipped.id} before ${target}; a stage that does not apply is entered and completed with a note.`
      }
      return null
    }
    case 'instance.used':
      if (data.slot === null) return null
      if (typeof data.slot !== 'number' || !Number.isInteger(data.slot) || data.slot < 0)
        return 'instance.used needs data.slot, the instance the person asked for (a whole number), or null to follow the work tree\'s again.'
      return text(data.reason) ? null : 'instance.used needs data.reason: why this instance and not the work tree\'s.'
    case 'base.changed':
      return text(data.to) ? null : 'base.changed needs data.to, the branch the run now builds on.'
    case 'stage.completed':
      return stageIndex(data.stage as StageId) < 0 ? `Unknown stage "${String(data.stage)}".` : null
    case 'gate.requested':
    case 'gate.resolved': {
      const gate = data.gate as StageId
      if (stageIndex(gate) < 0 || !isGate(gate)) return `"${String(data.gate)}" is not a gate. Gates: gate_a, gate_b.`
      if (type === 'gate.requested') return null
      const by = data.by ?? 'user'
      if (by === 'auto')
        return selfResolved(run, gate) ? null : `Only a full-autonomy run, or Aprobar PR when the change is approved on the PR, resolves a gate by itself; this run is ${run.mode}.`
      const requested = run.gates[gate]?.requested_at
      if (requested === undefined) return `Enter ${gate} (or record gate.requested) before resolving it.`
      const outcome = String(data.outcome ?? 'approved')
      if (!['approved', 'changes', 'rejected'].includes(outcome)) return 'data.outcome must be approved, changes or rejected.'
      const headers = GATE_HEADERS[gate] ?? []
      const answer = run.last_answer && run.last_answer.at >= requested ? run.last_answer : null
      const pair = answer?.pairs.find(p => headers.some(header => header.toLowerCase() === p.header.trim().toLowerCase()))
      if (!pair) {
        return `${gate} needs the person's answer to its own question: ask with AskUserQuestion under the header "${headers[0] ?? gate}" after requesting it (a cancelled dialog is no answer), then record gate.resolved.`
      }
      if (outcome === 'approved' && !APPROVAL.test(pair.answer)) {
        return `The person answered "${pair.answer}", which is not an approval: apply it, ask again, and record the outcome they chose.`
      }
      return null
    }
    case 'review.waiting':
      if (run.stage?.id !== 'pr') return 'review.waiting comes in the pr stage, once the PR is open and ready.'
      return run.pr?.number ? null : 'review.waiting needs the PR: record pr.opened {url, number} first.'
    case 'risk.set':
      return ['low', 'high', 'unknown'].includes(String(data.risk)) ? null : 'data.risk must be low, high or unknown.'
    case 'plan.ready':
      return Array.isArray(data.items) && data.items.length > 0 ? null : 'data.items must list the plan items (titles).'
    case 'item.started':
    case 'item.verified':
      return typeof data.n === 'number' ? null : 'data.n (the item number) is required.'
    case 'item.reviewed':
    case 'item.committed': {
      if (typeof data.n !== 'number') return 'data.n (the item number) is required.'
      const item = run.items.list?.find(entry => entry.n === data.n)
      // Each attempt goes verify, review, commit, in that order: a review of unverified code, or a commit nobody reviewed, is refused.
      if (!item?.verified) return `Item ${data.n} has no passing verification since it started: verify it (item.verified) before ${type === 'item.reviewed' ? 'reviewing' : 'committing'} it.`
      if (type === 'item.reviewed') return null
      if (item.reviewed_at == null || item.reviewed_at < item.verified.at)
        return `Item ${data.n} was not reviewed since its last verification: review it (item.reviewed) before committing it.`
      if (item.verified.tree && typeof data.commit_tree === 'string' && data.commit_tree !== item.verified.tree)
        return `The commit of item ${data.n} is not the tree that was verified: something changed after verification. Verify and review it again, then commit.`
      return null
    }
    case 'paused':
      return text(data.note) ? null : 'data.note is required: where the run stopped and what comes next.'
    case 'doing':
      return text(data.text) ? null : 'data.text is required: one plain sentence on what is being done and why.'
    case 'assumption':
    case 'decision':
    case 'corrected':
      return text(data.text) ? null : 'data.text is required.'
    case 'blocked':
      return text(data.reason) ? null : 'data.reason is required.'
    case 'unblocked': {
      if (data.budget === undefined) return null
      if (!['design_reversals', 'ci_fix_attempts', 'run_minutes'].includes(String(data.budget)))
        return 'data.budget must be design_reversals, ci_fix_attempts or run_minutes.'
      // Extending a budget is the person's call, in every mode. Their answer lifts the block by itself, so what counts is an answer
      // after the latest block, lifted or not, and each answer extends once.
      const since = run.blocked?.since ?? run.block_since ?? undefined
      if (since === undefined || !run.last_answer || run.last_answer.at < since)
        return 'Extending a budget needs the person: record blocked, ask with AskUserQuestion, then record unblocked {budget, amount}.'
      if (typeof data.amount !== 'number' || !Number.isInteger(data.amount) || data.amount <= 0)
        return `data.amount is required: how much the person added to ${String(data.budget)}, a whole number above 0 in its unit (minutes for run_minutes).`
      return null
    }
    case 'debate.turn':
      return text(data.role) ? null : 'data.role is required.'
    case 'signing.deferred':
      return typeof data.n === 'number' && text(data.sha) ? null : 'data.n (the item) and data.sha (the unsigned commit) are required.'
    case 'signing.done':
      return typeof data.count === 'number' ? null : 'data.count (how many commits were signed) is required.'
    case 'pr.opened':
      return text(data.url) ? null : 'data.url is required.'
    case 'ci.updated':
      return ['pending', 'passing', 'failing'].includes(String(data.state)) ? null : 'data.state must be pending, passing or failing.'
    case 'run.finished':
      return ['done', 'failed', 'cancelled'].includes(String(data.outcome)) ? null : 'data.outcome must be done, failed or cancelled.'
    default:
      return null
  }
}

export function hintFor(type: string, data: Record<string, unknown>, root: string): string | null {
  if (type !== 'stage.entered') return null
  const file = STAGE_FILES[data.stage as StageId]
  return file ? `Read ${root}/stages/${file} before working on this stage.` : null
}

// What each gate approved, and where the run goes back to redo it when that changed since.
const GUARDED: ReadonlyArray<{ gate: StageId; keys: ReadonlyArray<keyof Snapshot>; back: StageId }> = [
  { gate: 'gate_a', keys: ['spec'], back: 'definition' },
  { gate: 'gate_b', keys: ['spec', 'plan', 'tree'], back: 'implement' },
]
const WHAT: Record<keyof Snapshot, string> = { spec: 'spec.md', plan: 'plan.md', tree: 'the committed code' }

// Moving forward, or opening the PR, on something other than what a gate approved: the gate has to see it again.
export function changedSinceApproval(run: Run, type: string, data: Record<string, unknown>, current: Snapshot): string | null {
  const forward = type === 'stage.entered' && stageIndex(data.stage as StageId) > (run.stage?.index ?? -1)
  if (!forward && type !== 'pr.opened') return null
  for (const { gate, keys, back } of GUARDED) {
    const approved = run.gates[gate]?.snapshot
    if (!approved || run.gates[gate]?.resolved_at == null) continue
    const changed = keys.filter(key => approved[key] !== current[key])
    if (changed.length > 0) {
      const name = gate === 'gate_a' ? 'Aprobar spec' : 'Aprobar PR'
      return `${changed.map(key => WHAT[key]).join(' and ')} changed after ${name} approved it: go back with stage.entered {stage: "${back}", reason}, and ask ${name} again.`
    }
  }
  return null
}
