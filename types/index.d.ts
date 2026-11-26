export type Tone = 'text' | 'subtle' | 'claude' | 'warning' | 'error' | 'success' | 'merged'

export type Row = { text: string; tone: Tone }

// A run of text in one style: a tone, or any theme color (a role's, a link's).
export type Span = { text: string; tone?: Tone | (string & {}); bold?: boolean; href?: string }

// One line of the pane, drawn left to right. A line of one span wraps, unless its block is a table; a longer one is cut at the edge.
export type Line = Span[]

// A section of the pane: its label in the left gutter beside its lines, and head lines (a table's column names) above the label.
export type Block = { label: string; lines: Line[]; head?: Line[]; gap?: boolean; table?: boolean }

export type PaneView = {
  ref: string
  title: string
  status: { badge: string; tone: Tone; since: string }
  stage: { icon: string; label: string; position: string }
  summary: Block[]
  detail: Block[]
}

export type Pill = { label: string; state: 'done' | 'current' | 'pending' }

export type Segment = { short: string; state: 'done' | 'current' | 'pending'; filled: string; empty: string; fraction: number }

export type Progress = { segments: Segment[]; percent: number }

export type Band = {
  title: string
  heading: string
  modeChip: string
  stageText: string
  mode: string
  modeLine: { icon: string; name: string; hint: string; color: string }
  stage: string
  activity: string
  badge: string
  detail: string
  agents: Array<{ icon: string; color: string; text: string }>
  tone: Tone
  progress: Progress
  // The run's PR once it is open, for a link beside the stage.
  pr?: { label: string; url: string } | null
}

export type ViewState = {
  runId: string
  header: string
  statusLine: string
  band: Band
  details: Row[]
  history: Row[]
  items: Row[]
  historyAll: Row[]
  more: Row[]
  pane: PaneView
  title: string
}

export type Tab = 'summary' | 'detail' | 'items' | 'history'

export type ConfigDialog = {
  mode: 'config' | 'review'
  target: 'project' | 'global'
  section: number
  projectKey: string
  paths: { project: string; global: string }
  files: { project: Record<string, unknown>; global: Record<string, unknown> }
  dirty: boolean
  message: string
  step: 'detect' | 'ask' | 'choose' | 'section'
  chosen: string[]
  cursor: number
  // The init option the arrows last moved the focus to, on the question now asked.
  hover?: number
  // The config init proposed, which the questions that depend on what was detected (the runner) read.
  proposed?: Record<string, unknown>
}

declare module 'claude-code' {
  interface PluginState {
    wololo: { view: ViewState | null; expanded: boolean; tab: Tab; detail: boolean; dialog: ConfigDialog | null; owner: string }
  }
}
