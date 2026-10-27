export type Tone = 'text' | 'subtle' | 'claude' | 'warning' | 'error' | 'success'

export type Row = { text: string; tone: Tone }

export type Pill = { label: string; state: 'done' | 'current' | 'pending' }

export type Band = {
  title: string
  mode: string
  modeLine: { icon: string; name: string; hint: string; color: string }
  stage: string
  activity: string
  badge: string
  detail: string
  tone: Tone
  pills: Pill[]
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

declare module 'claude-code' {
  interface PluginState {
    wololo: { view: ViewState | null; expanded: boolean; tab: 'summary' | 'items' | 'history'; detail: boolean }
  }
}
