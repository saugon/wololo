import { type EventType, MODEL_EVENTS, type Run, STAGES, type StageId, stageIndex } from './model'

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

function gateResolved(run: Run, id: StageId): boolean {
  return run.gates[id]?.resolved_at != null
}

export function checkEvent(run: Run, type: string, data: Record<string, unknown>): string | null {
  if (!MODEL_EVENTS.has(type as EventType)) return `Unknown event type "${type}". Allowed: ${[...MODEL_EVENTS].join(', ')}.`
  if (run.outcome) return `The run already finished (${run.outcome}). Start a new one with /wololo.`

  switch (type as EventType) {
    case 'stage.entered': {
      const target = data.stage as StageId
      const ti = stageIndex(target)
      if (ti < 0) return `Unknown stage "${String(data.stage)}". Stages: ${STAGES.map(s => s.id).join(', ')}.`
      const ci = run.stage?.index ?? -1
      if (ti <= ci) return text(data.reason) ? null : `Going back to ${target} needs data.reason.`
      const current = run.stage?.id
      if (current && isGate(current) && !gateResolved(run, current) && run.mode !== 'full') {
        return `${current} is not resolved. Ask the person with AskUserQuestion, then record gate.resolved.`
      }
      for (const skipped of STAGES.slice(ci + 1, ti)) {
        if (skipped.isGate && run.mode === 'full') continue
        if (skipped.isGate && !gateResolved(run, skipped.id)) return `${skipped.id} must be resolved before ${target}.`
        if (!skipped.isGate)
          return `Enter ${skipped.id} before ${target}; a stage that does not apply is entered and completed with a note.`
      }
      return null
    }
    case 'stage.completed':
      return stageIndex(data.stage as StageId) < 0 ? `Unknown stage "${String(data.stage)}".` : null
    case 'gate.requested':
    case 'gate.resolved': {
      const gate = data.gate as StageId
      if (stageIndex(gate) < 0 || !isGate(gate)) return `"${String(data.gate)}" is not a gate. Gates: gate_a, gate_b.`
      if (type === 'gate.requested') return null
      const by = data.by ?? 'user'
      if (by === 'auto') return run.mode === 'full' ? null : `Only a full-autonomy run resolves a gate by itself; this run is ${run.mode}.`
      const requested = run.gates[gate]?.requested_at
      if (requested === undefined) return `Enter ${gate} (or record gate.requested) before resolving it.`
      if (run.last_answer_at === null || run.last_answer_at < requested) {
        return `${gate} needs the person's answer: ask with AskUserQuestion after requesting it, then record gate.resolved.`
      }
      return ['approved', 'changes', 'rejected'].includes(String(data.outcome ?? 'approved'))
        ? null
        : 'data.outcome must be approved, changes or rejected.'
    }
    case 'risk.set':
      return ['low', 'high', 'unknown'].includes(String(data.risk)) ? null : 'data.risk must be low, high or unknown.'
    case 'plan.ready':
      return Array.isArray(data.items) && data.items.length > 0 ? null : 'data.items must list the plan items (titles).'
    case 'item.started':
    case 'item.verified':
    case 'item.reviewed':
    case 'item.committed':
      return typeof data.n === 'number' ? null : 'data.n (the item number) is required.'
    case 'doing':
      return text(data.text) ? null : 'data.text is required: one plain sentence on what is being done and why.'
    case 'assumption':
    case 'decision':
    case 'corrected':
      return text(data.text) ? null : 'data.text is required.'
    case 'blocked':
      return text(data.reason) ? null : 'data.reason is required.'
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
