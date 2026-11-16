import { expect, test } from 'claude-code/testing'

import { connections, maxConnections } from '../hooks/postgres'

test('client connections are counted by database from the process titles, and the server gives its data directory', async () => {
  const seen = connections(
    [
      '/nix/store/x-postgresql-18.1/bin/postgres -D /Users/x/.local/share/vertex/postgres -k /Users/x/.local/share/vertex/postgres',
      'postgres: checkpointer ',
      'postgres: autovacuum launcher ',
      'postgres: logical replication launcher ',
      'postgres: postgres vertex_test_5 127.0.0.1(53111) idle',
      'postgres: postgres vertex_test_5 127.0.0.1(53112) SELECT',
      'postgres: saugon vertex_dev_6 [local] idle in transaction',
      'grep postgres: postgres',
    ].join('\n'),
  )
  expect(seen.byDatabase).toEqual({ vertex_test_5: 2, vertex_dev_6: 1 })
  expect(seen.total).toBe(3)
  expect(seen.dataDirs).toEqual(['/Users/x/.local/share/vertex/postgres'])
})

test('max_connections is the last one set, ALTER SYSTEM over postgresql.conf, and a comment is no setting', async () => {
  expect(maxConnections(['#max_connections = 50\nmax_connections = 100\t\t# (change requires restart)\nmax_connections = 300\n', ''])).toBe(300)
  expect(maxConnections(['max_connections = 100\n', "max_connections = '200'\n"])).toBe(200)
  expect(maxConnections(['shared_buffers = 128MB\n'])).toBe(null)
})
