import { type Config, DEFAULT_CONFIG } from './config'

// `now`: what applies when the person passes none of the line's flags, from the project's config.
export type HelpLine = { key: string; text: string; now?: string }

export type HelpSection = { title: string; lines: HelpLine[] }

export const HELP_MARKER: Record<string, string> = { es: 'wololo · ayuda', en: 'wololo · help' }

export function helpSections(lang: string, config: Config = DEFAULT_CONFIG): HelpSection[] {
  const mode = (flag: string) => (config.autonomy === flag.slice(2) ? (lang === 'es' ? 'sin flag' : 'without a flag') : undefined)
  const pick = (value: boolean, yes: string, no: string) => (value ? yes : no)
  const adapters = Object.keys(config.adapters).join(', ')
  if (lang !== 'es') {
    return [
      {
        title: 'Start a run',
        lines: [
          { key: '/wololo <text>', text: 'a run from a request written in your own words' },
          { key: '/wololo #123', text: 'from a GitHub issue (number or URL)' },
          { key: '/wololo plan.md', text: 'from a local plan file' },
          { key: '--full', text: 'never asks: decides alone and records every assumption', now: mode('--full') },
          { key: '--checkpoints', text: 'stops to approve the spec and the PR', now: mode('--checkpoints') },
          { key: '--guided', text: 'asks at every relevant doubt', now: mode('--guided') },
        ],
      },
      {
        title: 'Launch flags: they change the config for that run only',
        lines: [
          { key: '--review-pr · --review-local', text: 'the change is approved on the PR once CI is green, or at Aprobar PR in the session', now: pick(config.review.approval === 'pr', '--review-pr', '--review-local') },
          { key: '--awake · --no-awake', text: 'keep the machine awake while the run is active, or not', now: pick(config.keep_awake, '--awake', '--no-awake') },
          { key: '--no-adapters', text: "wololo does every stage itself, without the project's tool", now: adapters ? `with the adapters for ${adapters}` : 'no adapters configured' },
          { key: '--worktree · --in-place', text: 'work in a worktree, or in a branch of the repository', now: pick(config.isolation === 'worktree', '--worktree', '--in-place') },
          { key: '--base=<branch>', text: 'the branch the work starts from and the PR goes to', now: `--base=${config.pr.base}` },
          { key: '--no-pr · --draft · --ready', text: 'no PR, or open it as a draft or ready for review', now: config.pr.enabled ? pick(config.pr.draft, '--draft', '--ready') : '--no-pr' },
          { key: '--no-wait-ci', text: "don't follow CI after opening the PR", now: pick(config.pr.wait_ci, 'follows CI', '--no-wait-ci') },
          { key: '--no-screenshots', text: 'no screenshots stage', now: pick(config.screenshots.enabled, 'takes screenshots', '--no-screenshots') },
          { key: '--github-spec · --no-github-spec', text: 'publish the spec on the issue, or keep it in the run', now: pick(config.spec.to_github, '--github-spec', '--no-github-spec') },
          { key: '--debate=by_risk|light|deep', text: 'how hard the spec and the plan are challenged', now: `--debate=${config.debate.depth}` },
          { key: '--critic=claude|external', text: 'who challenges them', now: `--critic=${config.debate.critic}` },
          { key: '--reviewer=claude|external|both', text: 'who reviews each item', now: `--reviewer=${config.review.reviewer}` },
          { key: '--final-review=<skill> · --no-final-review', text: 'the skill that reviews the whole change before implementation ends', now: config.review.final.skill ? `--final-review=${config.review.final.skill}` : '--no-final-review' },
          { key: '--final-review-args=<args>', text: 'its arguments ({base}, {branch})', now: config.review.final.args ? `--final-review-args=${config.review.final.args}` : 'none' },
          { key: '--suite=local|ci · --e2e=local|ci|off', text: 'where the full suite and the e2e run', now: `--suite=${config.tests.suite_runs} · --e2e=${config.tests.e2e_runs}` },
        ],
      },
      {
        title: 'Follow a run',
        lines: [
          { key: '/wololo', text: 'what happened since your last message, and what it waits on' },
          { key: '/wololo status', text: 'every run of every project as a card (all: finished ones too)' },
          { key: '/wololo history', text: "this run's history, newest first (all: agents and tasks too)" },
          { key: '/wololo pause', text: 'finish the step in progress and pause, so the session can be closed' },
          { key: '/wololo resume [id]', text: "go on after a pause, or take over a run whose session closed" },
          { key: '/wololo done', text: "end this session's run as done, while its PR is in review" },
          { key: '/wololo cancel', text: "cancel this session's run; the worktree and branch stay" },
        ],
      },
      {
        title: 'The card above the prompt: keys',
        lines: [
          { key: 'first', text: 'give the card the focus: ctrl+x, then tab (or click it). Without it, the keys type into the prompt' },
          { key: 'Esc', text: 'hands the focus back to the prompt' },
          { key: 'm', text: 'expand or collapse it (without focus: /wololo-more)' },
          { key: 'r · d · i · h', text: 'tabs: Summary, Detail, Items, History' },
          { key: 'wheel', text: 'expanded, the mouse wheel over the card scrolls it' },
          { key: 'c', text: 'in History: add or remove agents and tasks' },
          { key: '/wololo panel', text: 'open the pane beside the chat, with the same tabs' },
          { key: 'x', text: 'in the pane, once it has the focus: close it' },
        ],
      },
      {
        title: 'Configure',
        lines: [
          { key: '/wololo init', text: "detects this project's commands, ports and agents, and asks the first-time defaults (autonomy, worktree, approval, PR, suite, spec)" },
          { key: '/wololo config', text: 'a dialog with every setting: radios, checkboxes, fields; saves here or everywhere' },
        ],
      },
      {
        title: 'States',
        lines: [
          { key: '⟳ WORKING', text: 'the session or its agents, tests or CI are running' },
          { key: '? WAITING FOR YOU', text: 'a question is open' },
          { key: '! NEEDS PERMISSION', text: 'a permission dialog is open' },
          { key: '✕ BLOCKED', text: 'it stopped and says why; your answer lifts it' },
          { key: '‖ STOPPED', text: 'the turn ended with nothing pending' },
          { key: '⏸ PAUSED', text: 'paused on request: safe to close; /wololo resume goes on' },
          { key: '○ SESSION CLOSED', text: 'no session drives it: /wololo resume <id>' },
          { key: '✓ DONE · ✕ FAILED · ■ CANCELLED', text: 'finished' },
        ],
      },
      {
        title: 'Agents',
        lines: [
          { key: '⌕ explorer · ◫ architect · ✗ critic', text: 'each live agent under the badge, with its model and how long it has run' },
          { key: '✎ implementer · ✓ verifier · ◉ reviewer', text: 'agents of the same role are grouped and counted' },
          { key: '+ N done · ✕ N failed', text: 'the ones that finished in the current item, or stage; m lists each one' },
        ],
      },
    ]
  }
  return [
    {
      title: 'Arrancar un run',
      lines: [
        { key: '/wololo <texto>', text: 'un run a partir de un pedido escrito con tus palabras' },
        { key: '/wololo #123', text: 'desde un issue de GitHub (número o URL)' },
        { key: '/wololo plan.md', text: 'desde un plan en un archivo local' },
        { key: '--full', text: 'no pregunta: decide solo y anota cada supuesto', now: mode('--full') },
        { key: '--checkpoints', text: 'frena para aprobar el spec y el PR', now: mode('--checkpoints') },
        { key: '--guided', text: 'pregunta en cada duda relevante', now: mode('--guided') },
      ],
    },
    {
      title: 'Flags al arrancar: cambian la config solo para ese run',
      lines: [
        { key: '--review-pr · --review-local', text: 'el cambio se aprueba en el PR con el CI verde, o en Aprobar PR en la sesión', now: pick(config.review.approval === 'pr', '--review-pr', '--review-local') },
        { key: '--awake · --no-awake', text: 'que la Mac no se duerma mientras el run está activo, o sí', now: pick(config.keep_awake, '--awake', '--no-awake') },
        { key: '--no-adapters', text: 'wololo hace cada etapa él mismo, sin la herramienta del proyecto', now: adapters ? `con los adaptadores de ${adapters}` : 'no hay adaptadores configurados' },
        { key: '--worktree · --in-place', text: 'trabajar en un worktree, o en una rama del repo', now: pick(config.isolation === 'worktree', '--worktree', '--in-place') },
        { key: '--base=<rama>', text: 'la rama de la que parte el trabajo y a la que va el PR', now: `--base=${config.pr.base}` },
        { key: '--no-pr · --draft · --ready', text: 'sin PR, o abrirlo como borrador o listo para revisar', now: config.pr.enabled ? pick(config.pr.draft, '--draft', '--ready') : '--no-pr' },
        { key: '--no-wait-ci', text: 'no seguir el CI después de abrir el PR', now: pick(config.pr.wait_ci, 'sigue el CI', '--no-wait-ci') },
        { key: '--no-screenshots', text: 'sin la etapa de capturas', now: pick(config.screenshots.enabled, 'con capturas', '--no-screenshots') },
        { key: '--github-spec · --no-github-spec', text: 'publicar el spec en el issue, o dejarlo en el run', now: pick(config.spec.to_github, '--github-spec', '--no-github-spec') },
        { key: '--debate=by_risk|light|deep', text: 'qué tan a fondo se discuten el spec y el plan', now: `--debate=${config.debate.depth}` },
        { key: '--critic=claude|external', text: 'quién los discute', now: `--critic=${config.debate.critic}` },
        { key: '--reviewer=claude|external|both', text: 'quién revisa cada ítem', now: `--reviewer=${config.review.reviewer}` },
        { key: '--final-review=<skill> · --no-final-review', text: 'el skill que revisa todo el cambio antes de cerrar la implementación', now: config.review.final.skill ? `--final-review=${config.review.final.skill}` : '--no-final-review' },
        { key: '--final-review-args=<args>', text: 'sus argumentos ({base}, {branch})', now: config.review.final.args ? `--final-review-args=${config.review.final.args}` : 'ninguno' },
        { key: '--suite=local|ci · --e2e=local|ci|off', text: 'dónde corren la suite completa y los e2e', now: `--suite=${config.tests.suite_runs} · --e2e=${config.tests.e2e_runs}` },
      ],
    },
    {
      title: 'Seguir un run',
      lines: [
        { key: '/wololo', text: 'qué pasó desde tu último mensaje y qué está esperando' },
        { key: '/wololo status', text: 'todos los runs de todos los proyectos (all: también los terminados)' },
        { key: '/wololo history', text: 'el historial del run, lo último arriba (all: con agentes y tareas)' },
        { key: '/wololo pause', text: 'termina el paso en curso y se pausa, para poder cerrar la sesión' },
        { key: '/wololo resume [id]', text: 'seguir después de una pausa, o retomar un run cuya sesión se cerró' },
        { key: '/wololo done', text: 'dar por terminado el run de esta sesión mientras su PR está en revisión' },
        { key: '/wololo cancel', text: 'cancelar el run de esta sesión; el worktree y la rama quedan' },
      ],
    },
    {
      title: 'La tarjeta arriba del prompt: teclas',
      lines: [
        { key: 'primero', text: 'dale el foco a la tarjeta: ctrl+x y después tab (o un click en ella). Sin foco, las teclas se escriben en el prompt' },
        { key: 'Esc', text: 'devuelve el foco al prompt' },
        { key: 'm', text: 'la expande o la colapsa (sin foco: /wololo-more)' },
        { key: 'r · d · i · h', text: 'pestañas: Resumen, Detalle, Ítems, Historial' },
        { key: 'rueda', text: 'expandida, la rueda del mouse sobre la tarjeta la recorre' },
        { key: 'c', text: 'en Historial: suma o saca agentes y tareas' },
        { key: '/wololo panel', text: 'abre el panel al costado del chat, con las mismas pestañas' },
        { key: 'x', text: 'en el panel, con el foco en él: lo cierra' },
      ],
    },
    {
      title: 'Configurar',
      lines: [
        { key: '/wololo init', text: 'detecta comandos, puertos y agentes, y te pregunta los defaults de la primera vez (autonomía, worktree, aprobación, PR, suite, spec)' },
        { key: '/wololo config', text: 'un diálogo con cada opción: radios, checks y campos; guarda acá o para todos' },
      ],
    },
    {
      title: 'Estados',
      lines: [
        { key: '⟳ TRABAJANDO', text: 'la sesión, sus agentes, tests o CI están corriendo' },
        { key: '? TE ESPERA', text: 'hay una pregunta abierta' },
        { key: '! PIDE PERMISO', text: 'hay un diálogo de permiso abierto' },
        { key: '✕ BLOQUEADO', text: 'se frenó y dice por qué; tu respuesta lo destraba' },
        { key: '‖ DETENIDO', text: 'el turno terminó sin nada pendiente' },
        { key: '⏸ PAUSADO', text: 'pausado a pedido: podés cerrar; /wololo resume sigue' },
        { key: '○ SESIÓN CERRADA', text: 'ninguna sesión lo maneja: /wololo resume <id>' },
        { key: '✓ TERMINADO · ✕ FALLÓ · ■ CANCELADO', text: 'ya terminó' },
      ],
    },
    {
      title: 'Agentes',
      lines: [
        { key: '⌕ explorador · ◫ arquitecto · ✗ crítico', text: 'cada agente vivo debajo del badge, con su modelo y cuánto lleva' },
        { key: '✎ implementador · ✓ verificador · ◉ revisor', text: 'los del mismo rol se agrupan y se cuentan' },
        { key: '+ N listos · ✕ N fallaron', text: 'los que terminaron en el ítem en curso, o en la etapa; m lista cada uno' },
      ],
    },
  ]
}

export function helpNow(lang: string, now: string): string {
  return now === 'sin flag' || now === 'without a flag' ? now : `${lang === 'es' ? 'sin flag' : 'without a flag'}: ${now}`
}

export function helpText(lang: string, config: Config = DEFAULT_CONFIG): string {
  const sections = helpSections(lang, config)
  const line = (l: HelpLine) => `  ${l.key}: ${l.text}${l.now ? ` (${helpNow(lang, l.now)})` : ''}`
  const body = sections.flatMap(section => ['', section.title, ...section.lines.map(line)])
  return [...body.slice(1), '', HELP_MARKER[lang === 'es' ? 'es' : 'en']].join('\n')
}

export function helpLangOf(text: string): string | null {
  const tail = text.trimEnd()
  if (tail.endsWith(HELP_MARKER.es ?? '')) return 'es'
  if (tail.endsWith(HELP_MARKER.en ?? '')) return 'en'
  return null
}
