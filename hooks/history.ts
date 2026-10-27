import { type Lang, type RunEvent, STAGES, type StageId, roleName } from './model'

export type Entry = { ts: number; icon: string; text: string; isMajor: boolean }

type Pair = { header?: string; question?: string; answer?: string }

function str(value: unknown): string {
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value)
}

function stage(lang: Lang, id: unknown): string {
  const index = STAGES.findIndex(s => s.id === (id as StageId))
  const def = STAGES[index]
  return def ? `${index + 1}/${STAGES.length} ${def.label[lang]}` : str(id)
}

function by(lang: Lang, value: unknown): string {
  if (value === 'auto' || value === 'claude') return lang === 'es' ? 'automático' : 'automatic'
  return lang === 'es' ? 'vos' : 'you'
}

function describe(ev: RunEvent, lang: Lang): Entry[] {
  const es = lang === 'es'
  const d = ev.data
  const one = (icon: string, text: string, isMajor = true): Entry[] => [{ ts: ev.ts, icon, text, isMajor }]
  switch (ev.type) {
    case 'run.started':
      return one('▶', `${es ? 'Run iniciado' : 'Run started'}: ${str(d.title)} (${str(d.mode)})`)
    case 'owner.changed':
      return one('↺', es ? 'Retomado en otra sesión' : 'Resumed in another session')
    case 'risk.set':
      return one('·', `${es ? 'Riesgo' : 'Risk'} ${str(d.risk)}${d.reason ? `: ${str(d.reason)}` : ''}`, false)
    case 'stage.entered':
      return one(
        '→',
        `${es ? 'Etapa' : 'Stage'} ${stage(lang, d.stage)}${d.reason ? ` (${es ? 'vuelve' : 'back'}: ${str(d.reason)})` : ''}`,
        false,
      )
    case 'stage.completed':
      return d.note ? one('✓', `${stage(lang, d.stage)}: ${str(d.note)}`, false) : []
    case 'gate.resolved': {
      const outcome = str(d.outcome || 'approved')
      const words = es ? ({ approved: 'aprobado', changes: 'con ajustes', rejected: 'rechazado' }[outcome] ?? outcome) : outcome
      return one(outcome === 'approved' ? '✓' : '✎', `${stage(lang, d.gate)}: ${words} (${by(lang, d.by)})`)
    }
    case 'question.answered': {
      const pairs = Array.isArray(d.pairs) ? (d.pairs as Pair[]) : []
      const entries = pairs.map(pair => ({
        ts: ev.ts,
        icon: '?',
        text: `${pair.header ? `${pair.header}: ` : ''}${str(pair.question)} → ${str(pair.answer) || (es ? '(sin respuesta)' : '(no answer)')}`,
        isMajor: true,
      }))
      if (d.response)
        entries.push({ ts: ev.ts, icon: '?', text: `${es ? 'Respuesta libre' : 'Free answer'}: ${str(d.response)}`, isMajor: true })
      return entries
    }
    case 'permission.asked':
      return one('!', `${es ? 'Pidió permiso' : 'Asked permission'}: ${str(d.tool)}${d.what ? ` · ${str(d.what)}` : ''}`)
    case 'permission.resolved': {
      const what = `${str(d.tool)}${d.what ? ` · ${str(d.what)}` : ''}`
      if (d.outcome === 'approved') return one('✓', `${es ? 'Permiso concedido' : 'Permission granted'}: ${what}`)
      if (d.outcome === 'denied') return one('✕', `${es ? 'Permiso denegado' : 'Permission denied'}: ${what}`)
      if (d.outcome === 'not_run') return one('✕', `${es ? 'Permiso no concedido' : 'Permission not granted'}: ${what}`)
      return []
    }
    case 'blocked':
      return one('✕', `${es ? 'Bloqueado' : 'Blocked'}: ${str(d.reason)}`)
    case 'pause.requested':
      return one('⏸', es ? 'Pausa pedida' : 'Pause requested')
    case 'paused':
      return one('⏸', `${es ? 'Pausado' : 'Paused'}${d.note ? `: ${str(d.note)}` : ''}`)
    case 'resumed':
      return one('▶', es ? 'Retomado' : 'Resumed')
    case 'unblocked': {
      if (d.by === 'answer') return one('⟳', es ? 'Desbloqueado con tu respuesta' : 'Unblocked by your answer')
      if (d.by === 'message') return one('⟳', es ? 'Desbloqueado con tu mensaje' : 'Unblocked by your message')
      return one('⟳', es ? 'Desbloqueado' : 'Unblocked')
    }
    case 'stalled':
      return one('‖', es ? 'Se detuvo sin nada pendiente; se lo reactivó' : 'Stopped with nothing pending; woken up')
    case 'doing':
      return one('→', str(d.text))
    case 'assumption':
      return one('·', `${es ? 'Supuesto' : 'Assumption'}: ${str(d.text)}`)
    case 'decision':
      return one('◆', `${es ? 'Decisión' : 'Decision'} (${by(lang, d.by)}): ${str(d.text)}`)
    case 'corrected':
      return one('✎', `${es ? 'Corregido' : 'Corrected'}: ${str(d.text)}`)
    case 'debate.turn':
      return one('·', `Debate ${stage(lang, d.stage)}: ${str(d.role)} ${es ? 'ronda' : 'round'} ${str(d.round)} → ${str(d.verdict)}`, false)
    case 'plan.ready':
      return one(
        '✓',
        `${es ? 'Plan listo' : 'Plan ready'}: ${Array.isArray(d.items) ? d.items.length : str(d.total)} ${es ? 'ítems' : 'items'}`,
      )
    case 'item.started':
      return one(
        '→',
        `${es ? 'Ítem' : 'Item'} ${str(d.n)}: ${str(d.title)}${d.reversal ? (es ? ' (rediseño)' : ' (redesign)') : ''}`,
      )
    case 'item.verified':
      return one(d.result === 'pass' ? '✓' : '✕', `${es ? 'Ítem' : 'Item'} ${str(d.n)}: tests ${str(d.result)}`, d.result !== 'pass')
    case 'item.reviewed':
      return one(
        '·',
        `${es ? 'Ítem' : 'Item'} ${str(d.n)}: ${es ? 'revisión' : 'review'} ${str(d.verdict)} (${str(d.findings)} ${es ? 'hallazgos' : 'findings'})`,
        false,
      )
    case 'item.committed':
      return one(
        '✓',
        `${es ? 'Ítem' : 'Item'} ${str(d.n)} ${es ? 'commiteado' : 'committed'} ${str(d.sha).slice(0, 9)}${d.title ? `: ${str(d.title)}` : ''}`,
      )
    case 'agent.started':
      return one(
        '⟳',
        `${es ? 'Arrancó' : 'Started'} ${roleName(lang, str(d.role), 1)}${d.description ? `: ${str(d.description)}` : ''}`,
        false,
      )
    case 'agent.finished':
      return one('✓', `${es ? 'Terminó' : 'Finished'} ${roleName(lang, str(d.role), 1)} (${str(d.status)})`, false)
    case 'task.started':
      return one('⧗', str(d.label), false)
    case 'task.finished':
      return one(d.status === 'failed' ? '✕' : '✓', `${str(d.label || d.id)} (${str(d.status)})`, false)
    case 'ci.updated':
      return one(d.state === 'failing' ? '✕' : d.state === 'passing' ? '✓' : '⧗', `CI ${str(d.state)}`, d.state !== 'pending')
    case 'signing.deferred':
      return one('·', `${es ? 'Ítem' : 'Item'} ${str(d.n)} ${es ? 'commiteado sin firma (se firma antes del push)' : 'committed unsigned (signed before the push)'} ${str(d.sha).slice(0, 9)}`)
    case 'signing.done':
      return one('✓', `${es ? 'Commits firmados' : 'Commits signed'}: ${str(d.count)}`)
    case 'pr.opened':
      return one('✓', `PR ${es ? 'abierto' : 'opened'}: ${str(d.url)}`)
    case 'pr.ready':
      return one('✓', es ? 'PR listo para revisión' : 'PR ready for review')
    case 'github.published':
      return one('✓', `GitHub ${str(d.kind)}${d.mode === 'summary' ? (es ? ' (resumen)' : ' (summary)') : ''}: ${str(d.url)}`)
    case 'screenshot.saved':
      return one('·', `${es ? 'Captura' : 'Screenshot'}: ${str(d.caption)}`, false)
    case 'run.finished':
      return one(
        d.outcome === 'done' ? '✓' : d.outcome === 'failed' ? '✕' : '■',
        `${es ? 'Run terminado' : 'Run finished'}: ${str(d.outcome)}${d.summary ? `. ${str(d.summary)}` : ''}`,
      )
    default:
      return []
  }
}

export function timeline(events: readonly RunEvent[], lang: Lang): Entry[] {
  const sorted = [...events].sort((a, b) => a.seq - b.seq)
  const entries = sorted.flatMap(ev => describe(ev, lang))
  const last = sorted[sorted.length - 1]
  const pending = [...sorted].reverse().find(ev => ev.type === 'question.asked' || ev.type === 'question.answered')
  if (pending?.type === 'question.asked' && last) {
    entries.push({
      ts: pending.ts,
      icon: '?',
      text: `${str(pending.data.question)} (${lang === 'es' ? 'esperando tu respuesta' : 'waiting for your answer'})`,
      isMajor: true,
    })
  }
  return entries
}

export function clock(ts: number): string {
  const date = new Date(ts * 1000)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function formatEntry(entry: Entry): string {
  return `${clock(entry.ts)} ${entry.icon} ${entry.text}`
}

export function historyMarkdown(title: string, entries: readonly Entry[]): string {
  return [`# ${title}`, '', ...[...entries].reverse().map(entry => `- ${formatEntry(entry)}`), ''].join('\n')
}
