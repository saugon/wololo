import type { EngineInterface } from 'claude-code'

import { type Run, type RunEvent, rebuild } from './model'

type Engine = EngineInterface

const ROTATE_AT_BYTES = 2 * 1024 * 1024

export type Paths = {
  root: string
  globalConfig: string
  projects: string
  runs: string
  sessions: string
}

export function pathsFor(root: string): Paths {
  const base = root.replace(/\/+$/, '')
  return {
    root: base,
    globalConfig: `${base}/config.json`,
    projects: `${base}/projects`,
    runs: `${base}/runs`,
    sessions: `${base}/sessions`,
  }
}

export function projectConfigPath(paths: Paths, key: string): string {
  return `${paths.projects}/${key}/config.json`
}

export function runDir(paths: Paths, id: string): string {
  return `${paths.runs}/${id}`
}

export async function readText($: Engine, path: string): Promise<string | undefined> {
  return $.fs.read(path).catch(() => undefined)
}

export async function readJson<T>($: Engine, path: string): Promise<T | undefined> {
  const text = await readText($, path)
  if (text === undefined) return undefined
  try {
    return JSON.parse(text) as T
  } catch {
    return undefined
  }
}

export async function writeAtomic($: Engine, path: string, text: string): Promise<void> {
  const staging = `${path}.${Math.random().toString(36).slice(2, 8)}.tmp`
  try {
    await $.fs.write(staging, text)
    const moved = await $.process.run(['/bin/mv', '-f', staging, path], { timeoutMs: 5_000 })
    if (moved.exitCode !== 0) await $.fs.write(path, text)
  } catch {
    await $.fs.write(path, text).catch(() => undefined)
  }
}

export async function writeJson($: Engine, path: string, value: unknown): Promise<void> {
  await writeAtomic($, path, `${JSON.stringify(value, null, 2)}\n`)
}

export async function appendLines($: Engine, path: string, lines: readonly string[]): Promise<boolean> {
  if (lines.length === 0) return true
  const text = lines.map(line => `${line}\n`).join('')
  if (!(await $.fs.exists(path))) {
    await $.fs.write(path, text)
    return true
  }
  const appended = await $.process.run(['/bin/sh', '-c', 'cat >> "$1"', 'wololo-append', path], { stdin: text, timeoutMs: 5_000 })
  return appended.exitCode === 0
}

export async function rotateIfLarge($: Engine, dir: string): Promise<void> {
  const path = `${dir}/events.jsonl`
  const stat = await $.fs.stat(path).catch(() => undefined)
  if (!stat || stat.size < ROTATE_AT_BYTES) return
  const entries = await $.fs.list(dir).catch(() => [])
  const taken = entries.map(e => /^events\.(\d+)\.jsonl$/.exec(e.name)?.[1]).filter((n): n is string => n !== undefined)
  const next = taken.length === 0 ? 1 : Math.max(...taken.map(Number)) + 1
  await $.process.run(['/bin/mv', '-f', path, `${dir}/events.${next}.jsonl`], { timeoutMs: 5_000 })
}

export function parseEvents(text: string): RunEvent[] {
  const events: RunEvent[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      events.push(JSON.parse(line) as RunEvent)
    } catch {
      continue
    }
  }
  return events
}

export async function readEvents($: Engine, dir: string): Promise<RunEvent[]> {
  const entries = await $.fs.list(dir).catch(() => [])
  const rotated = entries
    .map(e => ({ name: e.name, n: /^events\.(\d+)\.jsonl$/.exec(e.name)?.[1] }))
    .filter((e): e is { name: string; n: string } => e.n !== undefined)
    .sort((a, b) => Number(a.n) - Number(b.n))
    .map(e => e.name)
  const events: RunEvent[] = []
  for (const name of [...rotated, 'events.jsonl']) {
    const text = await readText($, `${dir}/${name}`)
    if (text) events.push(...parseEvents(text))
  }
  return events.sort((a, b) => a.seq - b.seq)
}

export async function loadRun($: Engine, paths: Paths, id: string): Promise<Run | undefined> {
  const dir = runDir(paths, id)
  const snapshot = await readJson<Run>($, `${dir}/run.json`)
  if (snapshot) return snapshot
  const events = await readEvents($, dir)
  return events.length > 0 ? rebuild(id, events) : undefined
}

export async function listRuns($: Engine, paths: Paths): Promise<Run[]> {
  const entries = await $.fs.list(paths.runs).catch(() => [])
  const runs: Run[] = []
  for (const entry of entries) {
    if (entry.kind !== 'dir') continue
    const run = await readJson<Run>($, `${paths.runs}/${entry.name}/run.json`)
    if (run) runs.push(run)
  }
  return runs.sort((a, b) => b.updated_at - a.updated_at)
}

export async function git($: Engine, cwd: string, args: readonly string[]): Promise<string | null> {
  const ran = await $.process.run(['git', ...args], { cwd, timeoutMs: 10_000 }).catch(() => undefined)
  if (!ran || ran.exitCode !== 0) return null
  return ran.stdout.trim()
}
