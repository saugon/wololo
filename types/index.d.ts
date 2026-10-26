export type Tone = 'text' | 'subtle' | 'claude' | 'warning' | 'error' | 'success'

export type Row = { text: string; tone: Tone }

export type ViewState = {
  runId: string
  header: string
  statusLine: string
  band: Row[]
  pane: Row[]
  title: string
}

declare module 'claude-code' {
  interface PluginState {
    wololo: { view: ViewState | null }
  }
}
