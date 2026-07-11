import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeHarness, type Harness } from '../../../../test/publicApi/harness'
import type { DatabaseBridge } from './routes/database'
import { buildDatabasePublicApi } from './publicApi'

const TASK = '44444444-4444-4444-8444-444444444444'

// A stub bridge exercises the plugin's error-union → domain-error mapping without a real Postgres.
function stubBridge(over: Partial<DatabaseBridge> = {}): DatabaseBridge {
  return {
    connect: async () => ({ ok: true, database: 'appdb' }),
    disconnect: async () => ({ ok: true }),
    tables: async () => ({ tables: [{ schema: 'public', name: 'users' }] }),
    columns: async () => ({ columns: [{ name: 'id', dataType: 'int', nullable: false, isPk: true }] }),
    rows: async () => ({ columns: ['id'], rows: [['1']], rowCount: 1, command: 'SELECT', total: 1 }),
    query: async () => ({ columns: ['n'], rows: [['1']], rowCount: 1, command: 'SELECT', ms: 3 }),
    insert: async () => ({ ok: true, rowCount: 1 }),
    update: async () => ({ ok: true, rowCount: 1 }),
    remove: async () => ({ ok: true, rowCount: 1 }),
    ...over,
  }
}

describe('database plugin public API', () => {
  let h: Harness
  const build = async (bridge: DatabaseBridge) => {
    h = await makeHarness([{ owner: 'database', contribution: buildDatabasePublicApi(bridge) }])
  }
  afterEach(() => h?.cleanup())

  const base = `/api/v1/plugins/database/tasks/${TASK}`
  const post = (p: string, body?: unknown) =>
    h.request(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, h.writeToken)
  const get = (p: string) => h.request(`${base}${p}`, {}, h.readToken)

  it('connects (returns only the database name), lists tables, and runs a query', async () => {
    await build(stubBridge())
    const conn = await post('/connection')
    expect(conn.status).toBe(200)
    const body = await conn.json()
    expect(body.data).toEqual({ database: 'appdb' })
    expect(JSON.stringify(body)).not.toMatch(/postgres:\/\//)

    const tables = (await (await get('/tables')).json()).data
    expect(tables.items).toEqual([{ schema: 'public', name: 'users' }])

    const q = (await (await post('/query', { sql: 'select 1 as n' })).json()).data
    expect(q).toMatchObject({ command: 'SELECT', durationMs: 3 })
  })

  it('maps a bridge error union to a non-2xx domain error', async () => {
    await build(stubBridge({ query: async () => ({ error: 'syntax error at or near "slect"' }) }))
    const res = await post('/query', { sql: 'slect 1' })
    expect(res.status).toBe(422)
    expect((await res.json()).error.code).toBe('provider_validation_failed')
  })

  it('maps a failed connection to 424 provider_unavailable', async () => {
    await build(stubBridge({ connect: async () => ({ ok: false, error: 'no DATABASE_URL' }) }))
    const res = await post('/connection')
    expect(res.status).toBe(424)
    expect((await res.json()).error.code).toBe('provider_unavailable')
  })

  it('requires write scope for a SQL query (even a SELECT)', async () => {
    await build(stubBridge())
    const res = await h.request(`${base}/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sql: 'select 1' }),
    }, h.readToken)
    expect(res.status).toBe(403)
  })
})
