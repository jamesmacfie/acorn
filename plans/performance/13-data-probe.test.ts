import { existsSync, writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'

const probe = vi.hoisted(() => ({
  pools: [] as { ended: boolean; query: (sql: string, parameters?: unknown[]) => Promise<unknown> }[],
  handshake: null as null | Promise<void>,
  statements: [] as string[], tableCount: 0, rows: [] as Record<string, unknown>[],
  normalizations: 0, pendingQueries: 0, peakPendingQueries: 0,
}))

vi.mock('pg', () => ({ default: { Pool: class {
  ended = false
  constructor() { probe.pools.push(this) }
  on() {}
  async query(sql: string) {
    probe.statements.push(sql)
    probe.peakPendingQueries = Math.max(probe.peakPendingQueries, ++probe.pendingQueries)
    try {
      if (sql.includes('current_database')) {
        await probe.handshake
        return { rows: [{ database: 'synthetic' }] }
      }
      await Promise.resolve()
      if (sql.includes('information_schema.tables')) return {
        rows: Array.from({ length: probe.tableCount }, (_, index) => ({ table_schema: 'public', table_name: `t${index}` })),
      }
      if (sql.includes('information_schema.columns')) return {
        rows: [{ column_name: 'id', data_type: 'integer', is_nullable: 'NO' }],
      }
      if (sql.includes('pg_index')) return { rows: [{ attname: 'id' }] }
      if (sql === 'SELECT synthetic_rows') return {
        fields: [{ name: 'value' }], rows: probe.rows, rowCount: probe.rows.length, command: 'SELECT',
      }
      return { rows: [], fields: [], rowCount: 0, command: 'OK' }
    } finally { probe.pendingQueries-- }
  }
  async connect() { return { query: this.query.bind(this), release() {} } }
  async end() { this.ended = true }
} } }))
vi.mock('node:fs/promises', () => ({ readFile: async () => 'DATABASE_URL=postgresql://synthetic.invalid/db' }))
vi.mock('../../packages/node-core/src/server/runConfig', () => ({ loadRepoConfig: () => ({}) }))

import { createDataSourceService } from '../../packages/node-core/src/server/core/data'

const records: Record<string, unknown>[] = []
const tag = process.env.ACORN_PERF_TAG ?? 'sample'
if (!/^[a-z0-9-]+$/.test(tag)) throw new Error('Use a safe output tag.')
const destination = new URL(`13-data-${tag}.json`, import.meta.url)
if (/(?:^|-)before(?:-|$)/.test(tag) && existsSync(destination)) throw new Error('Before evidence exists; use another tag.')
const record = (name: string, values: Record<string, unknown>) => records.push({ name, ...values })
const core = {
  tasks: { load: async () => ({ id: 'task', projectId: 'project' }), root: async () => '/synthetic/task' },
  projects: { byId: async () => ({ id: 'project', path: '/synthetic/task' }), config: async () => null },
  fs: {}, proc: {},
} as unknown as Parameters<typeof createDataSourceService>[0]

beforeEach(() => {
  probe.pools = []; probe.handshake = null; probe.statements = []; probe.rows = []
  probe.tableCount = 0; probe.normalizations = 0; probe.pendingQueries = 0; probe.peakPendingQueries = 0
})
afterEach(async () => {
  // The fake driver owns no socket. Explicitly close every orphan to keep this harness honest.
  for (const pool of probe.pools) pool.ended = true
  writeFileSync(destination, JSON.stringify({ runtime: process.version, driver: 'mocked pg, actual core owner', records }, null, 2) + '\n')
})

it('counts cold pool admission and orphan pools after disconnect', async () => {
  const service = createDataSourceService(core)
  const requests = 20
  await Promise.all(Array.from({ length: requests }, () => service.query('task', 'SELECT 1')))
  const created = probe.pools.length
  await service.disconnect('task')
  const alive = probe.pools.filter(pool => !pool.ended).length
  record('concurrent-cold-queries', { requests, poolsCreated: created, poolsAliveAfterDisconnect: alive })
  expect(created).toBe(20)
  expect(alive).toBe(19)
})

it('captures disconnect while a pool handshake is pending', async () => {
  let release!: () => void
  probe.handshake = new Promise<void>(resolve => { release = resolve })
  const service = createDataSourceService(core)
  const opening = service.connect('task')
  await vi.waitFor(() => expect(probe.pools).toHaveLength(1), { timeout: 1000 })
  await service.disconnect('task')
  release()
  await opening
  const alive = probe.pools.filter(pool => !pool.ended).length
  record('disconnect-during-connect', { poolsCreated: probe.pools.length, aliveAfterConnectFinishes: alive })
  expect(alive).toBe(1)
  await service.disconnect('task')
})

it('counts schema statements for a cold catalog and concurrent catalog readers', async () => {
  const service = createDataSourceService(core)
  await service.connect('task')
  probe.tableCount = 100
  const before = probe.statements.length
  const started = performance.now()
  const catalogs = await Promise.all(Array.from({ length: 8 }, () => service.catalog('task')))
  const statements = probe.statements.length - before
  record('concurrent-catalogs', {
    readers: 8, tables: catalogs[0].length, schemaStatements: statements,
    elapsedMs: performance.now() - started,
    note: 'Fake pg does not enforce max:4; concurrency and elapsed are not live Postgres timing.',
  })
  expect(catalogs.every(catalog => catalog.length === 100)).toBe(true)
  expect(statements).toBe(8 * 201)
  const warm = probe.statements.length
  await service.catalog('task')
  expect(probe.statements.length).toBe(warm)
  await service.disconnect('task')
})

it('measures normalization before the returned row cap', async () => {
  const service = createDataSourceService(core)
  await service.connect('task')
  const rows = 250_000
  probe.rows = Array.from({ length: rows }, () => Object.defineProperty({}, 'value', {
    enumerable: true, get() { probe.normalizations++; return { synthetic: 'value' } },
  }))
  const cpu = process.cpuUsage()
  const heap = process.memoryUsage().heapUsed
  const started = performance.now()
  const result = await service.query('task', 'SELECT synthetic_rows', { maxRows: 200 })
  const elapsedMs = performance.now() - started
  const used = process.cpuUsage(cpu)
  record('row-cap', {
    driverRows: rows, returnedRows: result.rows.length, normalizedCells: probe.normalizations,
    truncated: result.truncated, elapsedMs, cpuMs: (used.user + used.system) / 1000,
    heapDeltaBytes: process.memoryUsage().heapUsed - heap,
    note: 'Driver result allocation is outside timed section; heap delta is sampled allocation, not a retained leak.',
  })
  expect(result.rows).toHaveLength(200)
  expect(result.truncated).toBe(true)
  expect(probe.normalizations).toBe(rows)
  await service.disconnect('task')
})
