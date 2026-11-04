export type Tone = 'text' | 'subtle' | 'claude' | 'warning' | 'error' | 'success'

export type Row = { text: string; tone: Tone }

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
  pane: Row[]
  title: string
}

export type ConfigDialog = {
  mode: 'config' | 'review'
  target: 'project' | 'global'
  section: number
  projectKey: string
  paths: { project: string; global: string }
  files: { project: Record<string, unknown>; global: Record<string, unknown> }
  dirty: boolean
  message: string
  step: 'ask' | 'choose' | 'section'
  chosen: string[]
  cursor: number
}

declare module 'claude-code' {
  interface PluginState {
    wololo: { view: ViewState | null; expanded: boolean; tab: 'summary' | 'items' | 'history'; detail: boolean; dialog: ConfigDialog | null; owner: string; page: number }
  }
}
