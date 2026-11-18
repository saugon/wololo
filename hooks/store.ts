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

// False when nothing was written: the check before the append failed, or the file is not writable (the script's `[ -w ]`, its only exit
// 3). Any other failure, a `cat >>` whose redirect fails (exit 1 or 2) included, may have written part of the lines: it throws instead,
// and the caller works out from the file what is missing. The session can refuse the command itself (auto mode may deny it as a Bash
// call): then nothing ran, and the lines are written through the engine's file API instead.
export async function appendLines($: Engine, path: string, lines: readonly string[]): Promise<boolean> {
  if (lines.length === 0) return true
  const text = lines.map(line => `${line}\n`).join('')
  const exists = await $.fs.exists(path).catch(() => undefined)
  if (exists === undefined) return false
  if (!exists) {
    await $.fs.write(path, text)
    return true
  }
  const before = await $.fs.read(path).catch(() => undefined)
  if (before === undefined) return false
  let appended: Awaited<ReturnType<Engine['process']['run']>>
  try {
    appended = await $.process.run(['/bin/sh', '-c', '[ -w "$1" ] || exit 3; exec cat >> "$1"', 'wololo-append', path], {
      stdin: text,
      timeoutMs: 5_000,
    })
  } catch (error) {
    // Refused, it never ran and the file is as it was; timed out, it may have written, and the caller sorts it out.
    if ((await $.fs.read(path).catch(() => undefined)) !== before) throw error
    await $.fs.write(path, `${before}${before.endsWith('\n') || before === '' ? '' : '\n'}${text}`)
    return true
  }
  if (appended.exitCode === 3) return false
  if (appended.exitCode !== 0)
    throw new Error(`appending to ${path} failed (exit ${appended.exitCode}): ${appended.stderr.trim().slice(-500)}`)
  return true
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

// The highest seq in a run's event files: events.jsonl read whole, or the newest rotated file when events.jsonl was just rotated away; 0 when
// the run has none, its directory not made yet included. A file or a listing that cannot be read throws, so nothing is numbered on a guess.
export async function lastSeqOnDisk($: Engine, dir: string): Promise<number> {
  const current = `${dir}/events.jsonl`
  if (await $.fs.exists(current)) return maxSeq(await $.fs.read(current))
  if (!(await $.fs.exists(dir))) return 0
  const entries = await $.fs.list(dir)
  const newest = Math.max(0, ...entries.map(e => Number(/^events\.(\d+)\.jsonl$/.exec(e.name)?.[1] ?? 0)))
  return newest === 0 ? 0 : maxSeq(await $.fs.read(`${dir}/events.${newest}.jsonl`))
}

function maxSeq(text: string): number {
  return parseEvents(text).reduce((max, ev) => (typeof ev.seq === 'number' && ev.seq > max ? ev.seq : max), 0)
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
