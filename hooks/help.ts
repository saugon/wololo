export type HelpLine = { key: string; text: string }

export type HelpSection = { title: string; lines: HelpLine[] }

export const HELP_MARKER: Record<string, string> = { es: 'wololo · ayuda', en: 'wololo · help' }

export function helpSections(lang: string): HelpSection[] {
  if (lang !== 'es') {
    return [
      {
        title: 'Start a run',
        lines: [
          { key: '/wololo <text>', text: 'a run from a request written in your own words' },
          { key: '/wololo #123', text: 'from a GitHub issue (number or URL)' },
          { key: '/wololo plan.md', text: 'from a local plan file' },
          { key: '--full', text: 'never asks: decides alone and records every assumption' },
          { key: '--checkpoints', text: 'stops to approve the spec and the PR (the default)' },
          { key: '--guided', text: 'asks at every relevant doubt' },
        ],
      },
      {
        title: 'Follow a run',
        lines: [
          { key: '/wololo', text: 'what happened since your last message, and what it waits on' },
          { key: '/wololo status', text: 'every run of every project as a card (all: finished ones too)' },
          { key: '/wololo history', text: "this run's history, newest first (all: agents and tasks too)" },
          { key: '/wololo resume <id>', text: 'take over a run whose session closed' },
          { key: '/wololo cancel', text: "cancel this session's run; the worktree and branch stay" },
        ],
      },
      {
        title: 'The card above the prompt',
        lines: [
          { key: 'ctrl+x tab', text: 'focus the card (or click it); Esc goes back to the prompt' },
          { key: 'm', text: 'expand or collapse it (also /wololo-more)' },
          { key: 'r · i · h', text: 'tabs: Summary, Items, History' },
          { key: 'd', text: 'in History: add or remove agents and tasks' },
          { key: 'p', text: 'open the pane beside the chat (also /wololo panel)' },
        ],
      },
      {
        title: 'Configure',
        lines: [
          { key: '/wololo init', text: "detect this project's commands, ports and agents and propose its config" },
          { key: '/wololo config', text: 'see and change the config (yours and this project’s)' },
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
          { key: '○ SESSION CLOSED', text: 'no session drives it: /wololo resume <id>' },
          { key: '✓ DONE · ✕ FAILED · ■ CANCELLED', text: 'finished' },
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
        { key: '--full', text: 'no pregunta: decide solo y anota cada supuesto' },
        { key: '--checkpoints', text: 'frena para aprobar el spec y el PR (el default)' },
        { key: '--guided', text: 'pregunta en cada duda relevante' },
      ],
    },
    {
      title: 'Seguir un run',
      lines: [
        { key: '/wololo', text: 'qué pasó desde tu último mensaje y qué está esperando' },
        { key: '/wololo status', text: 'todos los runs de todos los proyectos (all: también los terminados)' },
        { key: '/wololo history', text: 'el historial del run, lo último arriba (all: con agentes y tareas)' },
        { key: '/wololo resume <id>', text: 'retomar un run cuya sesión se cerró' },
        { key: '/wololo cancel', text: 'cancelar el run de esta sesión; el worktree y la rama quedan' },
      ],
    },
    {
      title: 'La tarjeta arriba del prompt',
      lines: [
        { key: 'ctrl+x tab', text: 'le da el foco a la tarjeta (o un click); Esc vuelve al prompt' },
        { key: 'm', text: 'la expande o la colapsa (también /wololo-more)' },
        { key: 'r · i · h', text: 'pestañas: Resumen, Ítems, Historial' },
        { key: 'd', text: 'en Historial: suma o saca agentes y tareas' },
        { key: 'p', text: 'abre el panel al costado del chat (también /wololo panel)' },
      ],
    },
    {
      title: 'Configurar',
      lines: [
        { key: '/wololo init', text: 'detecta comandos, puertos y agentes del proyecto y propone su config' },
        { key: '/wololo config', text: 'ver y cambiar la config (la tuya y la del proyecto)' },
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
        { key: '○ SESIÓN CERRADA', text: 'ninguna sesión lo maneja: /wololo resume <id>' },
        { key: '✓ TERMINADO · ✕ FALLÓ · ■ CANCELADO', text: 'ya terminó' },
      ],
    },
  ]
}

export function helpText(lang: string): string {
  const sections = helpSections(lang)
  const body = sections.flatMap(section => ['', section.title, ...section.lines.map(line => `  ${line.key}: ${line.text}`)])
  return [...body.slice(1), '', HELP_MARKER[lang === 'es' ? 'es' : 'en']].join('\n')
}

export function helpLangOf(text: string): string | null {
  const tail = text.trimEnd()
  if (tail.endsWith(HELP_MARKER.es ?? '')) return 'es'
  if (tail.endsWith(HELP_MARKER.en ?? '')) return 'en'
  return null
}
