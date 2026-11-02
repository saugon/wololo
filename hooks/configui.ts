type Text = { es: string; en: string }

export type Option = { value: string; label: Text; help?: Text }

export type Field =
  | { kind: 'radio'; path: string; label: Text; options: Option[] }
  | { kind: 'check'; path: string; label: Text; help?: Text }
  | { kind: 'text'; path: string; label: Text; help?: Text }
  | { kind: 'number'; path: string; label: Text; help?: Text }
  | { kind: 'list'; path: string; label: Text; help?: Text }

export type Section = { id: string; title: Text; help: Text; fields: Field[] }

const t = (es: string, en: string): Text => ({ es, en })

export const SECTIONS: Section[] = [
  {
    id: 'autonomy',
    title: t('Autonomía', 'Autonomy'),
    help: t('Cuánto te pregunta el run', 'How much the run asks you'),
    fields: [
      {
        kind: 'radio',
        path: 'autonomy',
        label: t('Modo', 'Mode'),
        options: [
          {
            value: 'full',
            label: t('full', 'full'),
            help: t('no pregunta: decide solo y anota cada supuesto', 'never asks: decides alone'),
          },
          {
            value: 'checkpoints',
            label: t('checkpoints', 'checkpoints'),
            help: t('frena para aprobar el spec y el PR', 'stops to approve the spec and the PR'),
          },
          { value: 'guided', label: t('guided', 'guided'), help: t('pregunta en cada duda relevante', 'asks at every relevant doubt') },
        ],
      },
      {
        kind: 'check',
        path: 'permissions.auto_allow',
        label: t('Aprobar solos los pasos del run', "Approve the run's own steps"),
        help: t(
          'git y gh del run, los comandos de tests y las ediciones en el worktree',
          "the run's git and gh, the test commands and edits in the worktree",
        ),
      },
    ],
  },
  {
    id: 'debate',
    title: t('Debate', 'Debate'),
    help: t('Cuánto se discuten el spec y el plan', 'How hard the spec and plan are challenged'),
    fields: [
      {
        kind: 'radio',
        path: 'debate.depth',
        label: t('Profundidad', 'Depth'),
        options: [
          {
            value: 'by_risk',
            label: t('según el riesgo', 'by risk'),
            help: t('autocrítica si es bajo, crítico si es alto', 'self-critique when low, a critic when high'),
          },
          { value: 'light', label: t('liviano', 'light'), help: t('siempre una autocrítica', 'always one self-critique') },
          { value: 'deep', label: t('profundo', 'deep'), help: t('siempre crítico adversarial', 'always an adversarial critic') },
        ],
      },
      {
        kind: 'radio',
        path: 'debate.critic',
        label: t('Crítico', 'Critic'),
        options: [
          { value: 'claude', label: t('Claude', 'Claude') },
          {
            value: 'external',
            label: t('externo', 'external'),
            help: t('el comando de debate.external_cmd, p. ej. codex', 'debate.external_cmd, e.g. codex'),
          },
        ],
      },
      {
        kind: 'radio',
        path: 'review.reviewer',
        label: t('Revisión de cada ítem', 'Review of each item'),
        options: [
          { value: 'claude', label: t('Claude', 'Claude') },
          { value: 'external', label: t('externo', 'external') },
          { value: 'both', label: t('los dos', 'both') },
        ],
      },
      {
        kind: 'radio',
        path: 'review.approval',
        label: t('Aprobación del cambio', 'Approving the change'),
        options: [
          { value: 'local', label: t('en la sesión (Aprobar PR)', 'in the session (Approve PR)') },
          { value: 'pr', label: t('en el PR, con CI en verde', 'on the PR, once CI is green') },
        ],
      },
      { kind: 'number', path: 'budgets.debate_rounds', label: t('Rondas máximas', 'Max rounds') },
      {
        kind: 'list',
        path: 'debate.risk_signals',
        label: t('Palabras de riesgo', 'Risk words'),
        help: t('separadas por ;', 'separated by ;'),
      },
    ],
  },
  {
    id: 'tests',
    title: t('Tests', 'Tests'),
    help: t('Qué tests corre y cuándo', 'Which tests run and when'),
    fields: [
      {
        kind: 'radio',
        path: 'tests.follow',
        label: t('Reglas', 'Rules'),
        options: [
          {
            value: 'wololo',
            label: t('las de wololo', "wololo's"),
            help: t('los tocados por ítem y la suite al final', 'touched tests per item, the suite at the end'),
          },
          {
            value: 'project',
            label: t('las del proyecto', "the project's"),
            help: t('las de los archivos de abajo ganan', 'the files below win'),
          },
        ],
      },
      {
        kind: 'list',
        path: 'tests.rules_from',
        label: t('Reglas del proyecto en', 'Project rules in'),
        help: t('archivos, separados por ;', 'files, separated by ;'),
      },
      {
        kind: 'list',
        path: 'tests.suite',
        label: t('Suite completa', 'Full suite'),
        help: t('comandos, separados por ;', 'commands, separated by ;'),
      },
      {
        kind: 'radio',
        path: 'tests.suite_runs',
        label: t('La suite corre', 'The suite runs'),
        options: [
          { value: 'local', label: t('local', 'locally') },
          { value: 'ci', label: t('en CI', 'in CI') },
        ],
      },
      {
        kind: 'list',
        path: 'tests.e2e',
        label: t('Suite e2e', 'E2E suite'),
        help: t('comandos, separados por ;', 'commands, separated by ;'),
      },
      {
        kind: 'radio',
        path: 'tests.e2e_runs',
        label: t('La e2e corre', 'The e2e runs'),
        options: [
          { value: 'local', label: t('local', 'locally') },
          { value: 'ci', label: t('en CI', 'in CI') },
          { value: 'off', label: t('no corre', 'off') },
        ],
      },
      { kind: 'check', path: 'tests.background', label: t('Suites largas en background', 'Long suites in the background') },
    ],
  },
  {
    id: 'git',
    title: t('Git y PR', 'Git and PR'),
    help: t('Dónde trabaja y cómo entrega', 'Where it works and how it delivers'),
    fields: [
      {
        kind: 'radio',
        path: 'isolation',
        label: t('Aislamiento', 'Isolation'),
        options: [
          { value: 'worktree', label: t('worktree por run', 'a worktree per run') },
          { value: 'branch', label: t('rama en el checkout', 'a branch in place') },
        ],
      },
      {
        kind: 'text',
        path: 'branch',
        label: t('Nombre de rama', 'Branch name'),
        help: t('{ref} {slug} {run} {repo}', '{ref} {slug} {run} {repo}'),
      },
      { kind: 'check', path: 'pr.enabled', label: t('Abrir PR', 'Open a PR') },
      { kind: 'check', path: 'pr.draft', label: t('Como draft', 'As a draft') },
      { kind: 'check', path: 'pr.wait_ci', label: t('Esperar CI y arreglarlo', 'Wait for CI and fix it') },
      { kind: 'text', path: 'pr.base', label: t('Rama base', 'Base branch') },
      { kind: 'check', path: 'spec.to_github', label: t('Publicar el spec en el issue', 'Publish the spec in the issue') },
      {
        kind: 'check',
        path: 'spec.create_issue_from_text',
        label: t('Crear issue si el pedido es texto', 'Create an issue from a text request'),
      },
    ],
  },
  {
    id: 'evidence',
    title: t('Screenshots', 'Screenshots'),
    help: t('Evidencia visual antes del PR', 'Visual evidence before the PR'),
    fields: [
      { kind: 'check', path: 'screenshots.enabled', label: t('Sacar screenshots', 'Take screenshots') },
      { kind: 'number', path: 'screenshots.max', label: t('Máximo', 'At most') },
      {
        kind: 'text',
        path: 'commands.app_url',
        label: t('URL de la app', 'App URL'),
        help: t('{port} es el puerto del run', "{port} is the run's port"),
      },
      { kind: 'text', path: 'commands.login', label: t('Cómo loguearse', 'How to log in') },
    ],
  },
  {
    id: 'view',
    title: t('Vista', 'View'),
    help: t('Qué se muestra mientras corre', 'What shows while it runs'),
    fields: [
      { kind: 'check', path: 'view.band', label: t('Tarjeta arriba del prompt', 'Card above the prompt') },
      { kind: 'check', path: 'view.header', label: t('Encabezado en cada respuesta', 'Header on each reply') },
      { kind: 'check', path: 'view.statusline', label: t('Status line', 'Status line') },
      {
        kind: 'radio',
        path: 'view.pane',
        label: t('Panel lateral', 'Side pane'),
        options: [
          { value: 'auto', label: t('solo si entra', 'when it fits') },
          { value: 'command', label: t('solo al pedirlo', 'on request') },
          { value: 'off', label: t('nunca', 'never') },
        ],
      },
      { kind: 'text', path: 'view.colors.working', label: t('Color: trabajando', 'Color: working') },
      { kind: 'text', path: 'view.colors.waiting', label: t('Color: te espera', 'Color: waiting') },
      { kind: 'text', path: 'view.colors.blocked', label: t('Color: bloqueado', 'Color: blocked') },
      { kind: 'text', path: 'view.colors.done', label: t('Color: terminado', 'Color: done') },
    ],
  },
  {
    id: 'languages',
    title: t('Idiomas', 'Languages'),
    help: t('En qué idioma escribe cada cosa', 'Which language each thing is written in'),
    fields: [
      {
        kind: 'radio',
        path: 'languages.chat',
        label: t('Chat y tarjeta', 'Chat and card'),
        options: [
          { value: 'es', label: t('español', 'Spanish') },
          { value: 'en', label: t('inglés', 'English') },
        ],
      },
      { kind: 'text', path: 'languages.spec', label: t('Spec', 'Spec') },
      { kind: 'text', path: 'languages.issue', label: t('Issue', 'Issue') },
      { kind: 'text', path: 'languages.pr', label: t('PR', 'PR') },
    ],
  },
  {
    id: 'budgets',
    title: t('Presupuestos', 'Budgets'),
    help: t('Hasta dónde insiste antes de frenar', 'How far it insists before stopping'),
    fields: [
      { kind: 'number', path: 'budgets.design_reversals', label: t('Rediseños por ítem', 'Redesigns per item') },
      { kind: 'number', path: 'budgets.ci_fix_attempts', label: t('Arreglos de CI', 'CI fixes') },
      { kind: 'number', path: 'budgets.run_minutes', label: t('Minutos por run', 'Minutes per run') },
    ],
  },
]

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function getAt(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((v, key) => (isObject(v) ? v[key] : undefined), value)
}

export function setAt(value: Record<string, unknown>, path: string, next: unknown): Record<string, unknown> {
  const [head, ...rest] = path.split('.')
  if (!head) return value
  if (rest.length === 0) return { ...value, [head]: next }
  const child = isObject(value[head]) ? (value[head] as Record<string, unknown>) : {}
  return { ...value, [head]: setAt(child, rest.join('.'), next) }
}

export function fieldValue(field: Field, effective: unknown): string {
  const value = getAt(effective, field.path)
  if (Array.isArray(value)) return value.map(String).join('; ')
  if (value === null || value === undefined) return ''
  return String(value)
}

export function parseInput(field: Field, text: string): { value?: unknown; error?: string } {
  const trimmed = text.trim()
  if (field.kind === 'list')
    return {
      value: trimmed
        ? trimmed
            .split(';')
            .map(part => part.trim())
            .filter(Boolean)
        : [],
    }
  if (field.kind === 'number') {
    const n = Number(trimmed)
    return Number.isInteger(n) && n >= 0 ? { value: n } : { error: `${field.path}: un número entero` }
  }
  if (field.path === 'commands.login') return { value: trimmed || null }
  return { value: trimmed }
}

export function summarize(config: unknown, prefix = ''): string[] {
  if (!isObject(config)) return []
  return Object.entries(config).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    if (isObject(value)) return summarize(value, path)
    const shown = Array.isArray(value)
      ? value.map(item => (isObject(item) ? JSON.stringify(item) : String(item))).join('; ')
      : String(value)
    return [`${path}: ${shown}`]
  })
}
