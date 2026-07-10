import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import type { DatabaseBridge } from './database'
import type { AppEnv } from '../middleware/auth'
import { requireUser } from '../middleware/requireUser'
import { database, setDatabaseBridge } from './database'

// Transport contract for the database routes: auth + body validation + bridge-unavailable. The
// SQL-injection posture (identifiers validated against the introspected schema), connection-URL
// non-persistence, and pool teardown on disconnect are properties of main/database.ts that need a
// live Postgres to exercise — they are verified in the live/integration pass, not here (no test DB).

const req = (url: string, method = 'GET', body?: unknown) =>
  new Request(`http://acorn.test${url}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const authed = () => {
  const app = new Hono<AppEnv>()
  app.use('/api/*', async (c, next) => {
    c.set('principal', { kind: 'user', user: { token: 't', login: 'james', name: '', avatar: '', scopes: [] } })
    await next()
  })
  return app.route('/api/tasks', database)
}

const fake = (over: Partial<DatabaseBridge> = {}): DatabaseBridge => ({
  connect: async () => ({ ok: true, database: 'dev' }),
  disconnect: async () => ({ ok: true }),
  tables: async () => ({ tables: [] }),
  columns: async () => ({ columns: [] }),
  rows: async () => ({ columns: [], rows: [], rowCount: 0, command: 'SELECT', total: 0 }),
  query: async () => ({ columns: [], rows: [], rowCount: 0, command: 'SELECT', ms: 1 }),
  update: async () => ({ ok: true, rowCount: 1 }),
  insert: async () => ({ ok: true, rowCount: 1 }),
  remove: async () => ({ ok: true, rowCount: 1 }),
  ...over,
})

describe('database routes', () => {
  afterEach(() => setDatabaseBridge(null))

  it('connects and lists tables', async () => {
    setDatabaseBridge(fake())
    const app = authed()
    expect(await (await app.fetch(req('/api/tasks/task1/database/connect', 'POST'), {} as Env)).json()).toEqual({ ok: true, database: 'dev' })
    expect(await (await app.fetch(req('/api/tasks/task1/database/tables'), {} as Env)).json()).toEqual({ tables: [] })
  })

  it('forwards a query and an update to the bridge', async () => {
    let sql: string | null = null
    let upd: unknown = null
    setDatabaseBridge(fake({
      query: async (_t, s) => ((sql = s), { columns: [], rows: [], rowCount: 0, command: 'UPDATE', ms: 2 }),
      update: async (_t, schema, name, column, value, pk) => ((upd = { schema, name, column, value, pk }), { ok: true, rowCount: 1 }),
    }))
    const app = authed()
    await app.fetch(req('/api/tasks/task1/database/query', 'POST', { sql: 'select 1' }), {} as Env)
    expect(sql).toBe('select 1')
    await app.fetch(req('/api/tasks/task1/database/update', 'POST', { schema: 'public', name: 't', column: 'c', value: 'v', pk: { id: '1' } }), {} as Env)
    expect(upd).toEqual({ schema: 'public', name: 't', column: 'c', value: 'v', pk: { id: '1' } })
  })

  it('400s malformed execute bodies and missing browse params', async () => {
    setDatabaseBridge(fake())
    const app = authed()
    expect((await app.fetch(req('/api/tasks/task1/database/query', 'POST', { sql: '' }), {} as Env)).status).toBe(400)
    expect((await app.fetch(req('/api/tasks/task1/database/update', 'POST', { schema: 'public' }), {} as Env)).status).toBe(400)
    expect((await app.fetch(req('/api/tasks/task1/database/columns'), {} as Env)).status).toBe(400) // no schema/name
  })

  it('401s without a principal; 503s without a bridge', async () => {
    const gated = new Hono<AppEnv>().use('/api/*', requireUser).route('/api/tasks', database)
    expect((await gated.fetch(req('/api/tasks/task1/database/tables'), {} as Env)).status).toBe(401)
    expect((await authed().fetch(req('/api/tasks/task1/database/tables'), {} as Env)).status).toBe(503)
  })
})
