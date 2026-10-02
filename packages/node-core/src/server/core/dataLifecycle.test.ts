import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const driver = vi.hoisted(() => ({
  pools: [] as { end: ReturnType<typeof vi.fn>; url: string }[],
  statements: [] as { sql: string; parameters?: unknown[] }[],
  resolve: null as null | (() => Promise<unknown>),
  handshake: null as null | (() => Promise<unknown>),
  catalog: null as null | (() => Promise<unknown>),
  query: null as null | (() => Promise<unknown>),
  rows: [] as Record<string, unknown>[],
  result: null as unknown,
  releases: 0,
  url: 'synthetic',
  resolutions: 0,
}))
vi.mock('pg', () => ({ default: { Pool: class {
  end = vi.fn(async () => {})
  url: string
  constructor(options: { connectionString: string }) { this.url = options.connectionString; driver.pools.push(this) }
  on() {}
  async query(sql: string, parameters?: unknown[]) {
    driver.statements.push({ sql, parameters })
    if (sql.includes('current_database')) { await driver.handshake?.(); return { rows: [{ database: this.url }] } }
    if (sql.includes('information_schema.tables')) {
      await driver.catalog?.()
      return { rows: [{ table_schema: 'public', table_name: 't', column_name: 'id', data_type: 'integer', is_nullable: 'NO', is_pk: true }] }
    }
    if (sql.startsWith('SELECT values')) {
      await driver.query?.()
      return driver.result ?? { rows: driver.rows, fields: [{ name: 'v' }], rowCount: driver.rows.length, command: 'SELECT' }
    }
    return { rows: [], fields: [], rowCount: 0, command: sql.startsWith('ALTER') ? 'ALTER' : 'OK' }
  }
  async connect() { return { query: this.query.bind(this), release: () => driver.releases++ } }
} } }))
vi.mock('node:fs/promises', () => ({ readFile: async () => { driver.resolutions++; await driver.resolve?.(); return `DATABASE_URL=${driver.url}` } }))
vi.mock('../runConfig', () => ({ loadRepoConfig: () => ({}) }))
import { createDataSourceService, dataSourceFor } from './data'

const core = {
  tasks: { load: async () => ({ projectId: null }), root: async () => '/synthetic' },
  projects: {}, fs: {}, proc: {},
} as unknown as Parameters<typeof createDataSourceService>[0]
const deferred = () => {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}
let service: ReturnType<typeof createDataSourceService>
beforeEach(() => {
  driver.pools = []; driver.statements = []; driver.rows = []; driver.result = null
  driver.resolve = null; driver.handshake = null; driver.catalog = null; driver.query = null; driver.releases = 0; driver.url = 'synthetic'; driver.resolutions = 0
  service = createDataSourceService(core)
})
afterEach(async () => { await service.disconnect('task'); await service.disconnect('other') })

it('joins 20 implicit readers, keeps tasks independent, and closes once', async () => {
  await Promise.all(Array.from({ length: 20 }, () => service.query('task', 'SELECT values')))
  expect(driver.pools).toHaveLength(1)
  await service.query('other', 'SELECT values')
  expect(driver.pools).toHaveLength(2)
  await service.disconnect('task'); await service.disconnect('task')
  expect(driver.pools[0].end).toHaveBeenCalledTimes(1)
  expect(driver.pools[1].end).not.toHaveBeenCalled()
})

it.each(['resolve', 'handshake'] as const)('fences disconnect during %s and preserves a replacement', async (stage) => {
  const held = deferred()
  driver[stage] = () => held.promise
  const opening = service.connect('task').catch(error => error)
  await vi.waitFor(() => expect(stage === 'resolve' ? driver.resolve : driver.pools.length).toBeTruthy())
  // Let URL resolution actually start when no pool exists yet.
  await new Promise(resolve => setTimeout(resolve, 0))
  await service.disconnect('task')
  driver[stage] = null
  await service.connect('task')
  held.release()
  expect(await opening).toBeInstanceOf(Error)
  await service.query('task', 'SELECT values')
  expect(driver.pools.at(-1)?.end).not.toHaveBeenCalled()
  expect(driver.pools.slice(0, -1).every(pool => pool.end.mock.calls.length === 1)).toBe(true)
})

it('closes failed handshakes and permits retry', async () => {
  driver.handshake = async () => { throw new Error('handshake failed') }
  await expect(service.connect('task')).rejects.toThrow('handshake failed')
  expect(driver.pools[0].end).toHaveBeenCalledTimes(1)
  driver.handshake = null
  await service.connect('task')
  expect(driver.pools).toHaveLength(2)
})

it('serializes explicit refresh resolution and drains admitted readers', async () => {
  await service.connect('task')
  const held = deferred()
  driver.query = () => held.promise
  const reading = service.query('task', 'SELECT values')
  await vi.waitFor(() => expect(driver.statements.some(s => s.sql === 'SELECT values')).toBe(true))
  const first = service.connect('task'); const second = service.connect('task')
  await Promise.all([first, second])
  expect(driver.pools).toHaveLength(3)
  expect(driver.pools[0].end).not.toHaveBeenCalled()
  held.release(); await reading
  expect(driver.pools[0].end).toHaveBeenCalledTimes(1)
  expect(driver.pools[1].end).toHaveBeenCalledTimes(1)
})

it('keeps another capability consumer alive when the first departs', async () => {
  const first = dataSourceFor(service, false); const second = dataSourceFor(service, false)
  const held = deferred(); driver.resolve = () => held.promise
  const a = first.query('task', 'SELECT values').catch(error => error)
  const b = second.query('task', 'SELECT values')
  await first.disconnect('task'); held.release()
  expect(await a).toBeInstanceOf(Error); await b
  expect(driver.pools).toHaveLength(1)
  expect(driver.pools[0].end).not.toHaveBeenCalled()
  await second.disconnect('task')
  expect(driver.pools[0].end).toHaveBeenCalledTimes(1)
})

it.each(['ddl', 'disconnect', 'refresh'] as const)('fences a held catalog during %s without clearing its replacement', async (action) => {
  await service.connect('task')
  const held = deferred(); driver.catalog = () => held.promise
  const old = service.catalog('task').catch(error => error)
  await vi.waitFor(() => expect(driver.statements.some(s => s.sql.includes('information_schema.tables'))).toBe(true))
  if (action === 'ddl') await service.query('task', 'ALTER TABLE t ADD COLUMN v text', { readOnly: false })
  if (action === 'disconnect') await service.disconnect('task')
  if (action === 'refresh') await service.connect('task')
  driver.catalog = null
  const replacement = await service.catalog('task')
  held.release(); expect(await old).toBeInstanceOf(Error)
  const statements = driver.statements.length
  expect(await service.catalog('task')).toBe(replacement)
  expect(driver.statements).toHaveLength(statements)
})

it('joins catalog readers and retries a failed wave', async () => {
  await service.connect('task')
  driver.catalog = async () => { throw new Error('catalog failed') }
  await expect(service.catalog('task')).rejects.toThrow('catalog failed')
  driver.catalog = null
  const before = driver.statements.length
  const results = await Promise.all(Array.from({ length: 8 }, () => service.catalog('task')))
  expect(driver.statements.length - before).toBe(1)
  expect(results.every(result => result === results[0])).toBe(true)
})

it('converts only accepted cells and preserves types, metadata, parameters, and final statement selection', async () => {
  let conversions = 0
  driver.rows = Array.from({ length: 250_000 }, () => Object.defineProperty({}, 'v', {
    enumerable: true, get: () => { conversions++; return { text: 'λ🙂' } },
  }))
  const result = await service.query('task', 'SELECT values', { maxRows: 200, parameters: ['λ', null] })
  expect(conversions).toBe(200)
  expect(result).toMatchObject({ columns: ['v'], rowCount: 250_000, command: 'SELECT', truncated: true })
  expect(result.rows.every(row => row[0] === '{"text":"λ🙂"}')).toBe(true)
  expect(driver.statements.find(s => s.sql === 'SELECT values')?.parameters).toEqual(['λ', null])
  const values = ['λ🙂', null, undefined, true, 12.5, new Date('2026-01-01T00:00:00Z'), { v: 1 }]
  driver.result = [{ rows: [], fields: [], command: 'SELECT', rowCount: 0 }, {
    rows: [{ v: values[0], n: values[1], u: values[2], b: values[3], x: values[4], d: values[5], j: values[6] }],
    fields: ['v', 'n', 'u', 'b', 'x', 'd', 'j'].map(name => ({ name })), command: 'SELECT', rowCount: 1,
  }]
  expect((await service.query('task', 'SELECT values; SELECT values')).rows).toEqual([
    ['λ🙂', null, null, 'true', '12.5', '2026-01-01T00:00:00.000Z', '{"v":1}'],
  ])
  expect(driver.releases).toBe(2)
})

it('does not auto-connect after schema resolution is retired', async () => {
  const held = deferred()
  const slowCore = { ...core, tasks: { ...core.tasks, load: async () => { await held.promise; return { projectId: null } } } } as unknown as Parameters<typeof createDataSourceService>[0]
  const slow = createDataSourceService(slowCore)
  const reading = slow.schema('task').catch(error => error)
  await slow.disconnect('task')
  held.release()
  expect(await reading).toBeInstanceOf(Error)
  expect(driver.pools).toHaveLength(0)
})

it('keeps a headless reader alive when an explicit connector departs during handshake', async () => {
  const first = dataSourceFor(service, false); const second = dataSourceFor(service, false)
  const held = deferred(); driver.handshake = () => held.promise
  const connecting = first.connect('task').catch(error => error)
  await vi.waitFor(() => expect(driver.pools).toHaveLength(1))
  const reading = second.query('task', 'SELECT values')
  await first.disconnect('task')
  held.release()
  expect(await connecting).toBeInstanceOf(Error)
  await reading
  expect(driver.pools[0].end).not.toHaveBeenCalled()
  await second.disconnect('task')
  expect(driver.pools[0].end).toHaveBeenCalledTimes(1)
})

it('rolls back and releases a checked-out client when SQL fails', async () => {
  driver.query = async () => { throw new Error('SQL failed') }
  await expect(service.query('task', 'SELECT values')).rejects.toThrow('SQL failed')
  expect(driver.statements.at(-1)?.sql).toBe('ROLLBACK')
  expect(driver.releases).toBe(1)
  driver.query = null
  await service.query('task', 'SELECT values')
  expect(driver.releases).toBe(2)
})

it('bounds row caps and retains the full driver row count', async () => {
  driver.rows = Array.from({ length: 505 }, (_, i) => ({ v: i }))
  expect((await service.query('task', 'SELECT values', { maxRows: 0 })).rows).toEqual([['0']])
  const maximum = await service.query('task', 'SELECT values', { maxRows: Infinity })
  expect(maximum.rows).toHaveLength(500)
  expect(maximum.rowCount).toBe(505)
  expect(maximum.truncated).toBe(true)
})


it('resolves each explicit refresh in order and observes changed URL sources', async () => {
  await service.connect('task')
  const held = deferred()
  driver.handshake = () => held.promise
  driver.url = 'first-refresh'
  const first = service.connect('task')
  const second = service.connect('task')
  await vi.waitFor(() => expect(driver.pools).toHaveLength(2))
  expect(driver.resolutions).toBe(2)
  driver.url = 'second-refresh'
  driver.handshake = null
  held.release()
  expect(await first).toEqual({ database: 'first-refresh' })
  expect(await second).toEqual({ database: 'second-refresh' })
  expect(driver.resolutions).toBe(3)
  await service.query('task', 'SELECT values')
  expect(driver.resolutions).toBe(3)
})

it('keeps a healthy pool usable after a failed explicit refresh', async () => {
  await service.connect('task')
  driver.handshake = async () => { throw new Error('refresh failed') }
  await expect(service.connect('task')).rejects.toThrow('refresh failed')
  expect(driver.pools[0].end).not.toHaveBeenCalled()
  expect(driver.pools[1].end).toHaveBeenCalledTimes(1)
  driver.handshake = null
  await service.query('task', 'SELECT values')
  expect(driver.pools).toHaveLength(2)
})

it('does not clear a replacement catalog wave when an invalidated wave finishes', async () => {
  await service.connect('task')
  const oldGate = deferred(); driver.catalog = () => oldGate.promise
  const old = service.catalog('task').catch(error => error)
  await vi.waitFor(() => expect(driver.statements.filter(s => s.sql.includes('information_schema.tables'))).toHaveLength(1))
  await service.query('task', 'ALTER TABLE t ADD COLUMN v text', { readOnly: false })
  const replacementGate = deferred(); driver.catalog = () => replacementGate.promise
  const replacement = service.catalog('task')
  await vi.waitFor(() => expect(driver.statements.filter(s => s.sql.includes('information_schema.tables'))).toHaveLength(2))
  oldGate.release(); expect(await old).toBeInstanceOf(Error)
  const joining = service.catalog('task')
  await Promise.resolve(); await Promise.resolve()
  expect(driver.statements.filter(s => s.sql.includes('information_schema.tables'))).toHaveLength(2)
  replacementGate.release()
  expect(await joining).toBe(await replacement)
})
