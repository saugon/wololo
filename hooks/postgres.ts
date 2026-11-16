// What the local Postgres servers are doing, read from the process list: no client, no credentials. Each client connection is a
// backend titled `postgres: <user> <database> <host>(<port>) <state>` (or `[local]` for a socket); the server itself runs as
// `postgres -D <data dir>`, and its data directory holds max_connections.

export type Connections = { byDatabase: Record<string, number>; total: number; dataDirs: string[] }

const BACKEND = /^postgres: (\S+) (\S+) (\S+\(\d+\)|\[local\])/

export function connections(ps: string): Connections {
  const byDatabase: Record<string, number> = {}
  const dataDirs: string[] = []
  let total = 0
  for (const line of ps.split('\n')) {
    const title = line.trim()
    const backend = BACKEND.exec(title)
    if (backend) {
      const db = backend[2] ?? ''
      byDatabase[db] = (byDatabase[db] ?? 0) + 1
      total += 1
      continue
    }
    const server = /(?:^|\/)postgres\s.*?-D\s+(\S+)/.exec(title)
    if (server?.[1] && !title.startsWith('postgres:')) dataDirs.push(server[1])
  }
  return { byDatabase, total, dataDirs }
}

// max_connections as the server reads it: postgresql.conf, then postgresql.auto.conf (ALTER SYSTEM), the last setting winning.
export function maxConnections(confs: readonly string[]): number | null {
  let max: number | null = null
  for (const text of confs) {
    for (const line of text.split('\n')) {
      const set = /^\s*max_connections\s*=\s*'?(\d+)'?/.exec(line)
      if (set?.[1]) max = Number(set[1])
    }
  }
  return max
}
