import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseBridge } from './database'
import { getDb, schema } from '../../../../core/server/db'
import { ProviderOperationError } from '../../../../core/server/integrations/types'
import type { AppEnv } from '../../../../core/server/middleware/auth'
import { requireUser } from '../../../../core/server/middleware/requireUser'
import { generateTextForConnection } from '../../../../core/server/modelProviders/runtime'
import { makeTestDb, type TestDb } from '../../../../core/server/routes/testDb'
import type { DbSavedQuery } from '../../shared/database'
import { database, setDatabaseBridge } from './database'
import type { Env } from '../../../../core/main/bindings'

vi.mock('../../../../core/server/modelProviders/runtime', () => ({
  generateTextForConnection: vi.fn(),
}))
vi.mock('../../../../core/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../core/server/db')>()
  return { ...actual, getDb: vi.fn() }
})

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
  schema: async () => ({ schema: 'CREATE TABLE "public"."users" ();', source: 'auto' }),
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

  it('generates SQL through the model runtime with the schema in the system prompt', async () => {
    setDatabaseBridge(fake())
    vi.mocked(generateTextForConnection).mockResolvedValueOnce({
      text: '```sql\nSELECT * FROM users;\n```',
      providerId: 'anthropic',
      connectionId: 'conn1',
      modelId: 'claude-sonnet-5',
    })
    const res = await authed().fetch(
      req('/api/tasks/task1/database/generate', 'POST', { connectionId: 'conn1', modelId: 'claude-sonnet-5', prompt: 'all users' }),
      {} as Env,
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sql: 'SELECT * FROM users;', providerId: 'anthropic', modelId: 'claude-sonnet-5' })
    const args = vi.mocked(generateTextForConnection).mock.calls[0][0]
    expect(args.connectionId).toBe('conn1')
    expect(args.userId).toBe('james')
    expect(args.input.modelId).toBe('claude-sonnet-5')
    expect(args.input.system).toContain('CREATE TABLE "public"."users" ();')
    expect(args.input.prompt).toBe('all users')
  })

  it('422s when the schema source fails; maps provider errors to their status', async () => {
    setDatabaseBridge(fake({ schema: async () => ({ error: 'Not connected.' }) }))
    const app = authed()
    const failed = await app.fetch(req('/api/tasks/task1/database/generate', 'POST', { connectionId: 'c', prompt: 'x' }), {} as Env)
    expect(failed.status).toBe(422)
    expect(await failed.json()).toMatchObject({ error: 'db_schema_unavailable', detail: ['Not connected.'] })

    setDatabaseBridge(fake())
    vi.mocked(generateTextForConnection).mockRejectedValueOnce(new ProviderOperationError('provider_needs_auth', 401))
    const denied = await app.fetch(req('/api/tasks/task1/database/generate', 'POST', { connectionId: 'c', prompt: 'x' }), {} as Env)
    expect(denied.status).toBe(401)
    expect(await denied.json()).toMatchObject({ error: 'provider_needs_auth' })

    expect((await app.fetch(req('/api/tasks/task1/database/generate', 'POST', { connectionId: '', prompt: 'x' }), {} as Env)).status).toBe(400)
  })

  it('401s without a principal; 503s without a bridge', async () => {
    const gated = new Hono<AppEnv>().use('/api/*', requireUser).route('/api/tasks', database)
    expect((await gated.fetch(req('/api/tasks/task1/database/tables'), {} as Env)).status).toBe(401)
    expect((await authed().fetch(req('/api/tasks/task1/database/tables'), {} as Env)).status).toBe(503)
  })
})

// Saved queries are repo-scoped rows addressed through a task, so these need a real DB (unlike the
// bridge routes above). Two tasks on different repos prove the scoping.
describe('saved queries (docs/pg.md)', () => {
  let t: TestDb
  let app: Hono<AppEnv>

  const task = (id: string, repoName: string) => ({
    id,
    title: 'T',
    origin: 'local' as const,
    repoOwner: 'acme',
    repoName,
    branch: 'feat/x',
    worktreePath: null,
    pullNumber: null,
    status: 'active' as const,
    parentId: null,
    sort: 0,
    createdAt: 0,
    updatedAt: 0,
    archivedAt: null,
  })

  beforeEach(async () => {
    t = makeTestDb()
    vi.mocked(getDb).mockReturnValue(t.db)
    app = authed()
    await t.db.insert(schema.tasks).values([task('task1', 'widget'), task('other', 'gadget')])
  })
  afterEach(() => {
    t.cleanup()
    setDatabaseBridge(null)
  })

  const list = async (taskId = 'task1'): Promise<DbSavedQuery[]> =>
    (await app.fetch(req(`/api/tasks/${taskId}/database/queries`), {} as Env)).json()
  const save = (body: unknown, taskId = 'task1') => app.fetch(req(`/api/tasks/${taskId}/database/queries`, 'POST', body), {} as Env)

  it('saves, lists and deletes a query', async () => {
    const saved: DbSavedQuery = await (await save({ name: 'paid orders', notes: 'excludes refunds', sql: 'SELECT 1;' })).json()
    expect(saved).toMatchObject({ name: 'paid orders', notes: 'excludes refunds', sql: 'SELECT 1;' })
    expect(await list()).toEqual([saved])

    expect((await app.fetch(req(`/api/tasks/task1/database/queries/${saved.id}`, 'DELETE'), {} as Env)).status).toBe(200)
    expect(await list()).toEqual([])
  })

  it('overwrites in place when the name already exists', async () => {
    const first: DbSavedQuery = await (await save({ name: 'paid orders', notes: 'v1', sql: 'SELECT 1;' })).json()
    const second: DbSavedQuery = await (await save({ name: 'paid orders', notes: '', sql: 'SELECT 2;' })).json()
    expect(second.id).toBe(first.id)
    expect(await list()).toEqual([{ ...second, notes: null, sql: 'SELECT 2;' }])
  })

  it('scopes rows to the task\'s repo — a sibling repo neither sees nor deletes them', async () => {
    const mine: DbSavedQuery = await (await save({ name: 'mine', notes: '', sql: 'SELECT 1;' })).json()
    expect(await list('other')).toEqual([])
    await app.fetch(req(`/api/tasks/other/database/queries/${mine.id}`, 'DELETE'), {} as Env)
    expect(await list()).toEqual([mine])
  })

  it('400s a blank name or empty SQL; 404s an unknown task', async () => {
    expect((await save({ name: ' ', notes: '', sql: 'SELECT 1;' })).status).toBe(400)
    expect((await save({ name: 'x', notes: '', sql: '  ' })).status).toBe(400)
    expect((await save({ name: 'x', notes: '', sql: 'SELECT 1;' }, 'nope')).status).toBe(404)
  })

  it('puts the picked examples in the generate prompt and ignores ids from elsewhere', async () => {
    setDatabaseBridge(fake({ schema: async () => ({ schema: 'SCHEMA', source: 'auto', notes: 'orders.meta holds { coupon }' }) }))
    const picked: DbSavedQuery = await (await save({ name: 'paid orders', notes: 'excludes refunds', sql: 'SELECT 1;' })).json()
    const foreign: DbSavedQuery = await (await save({ name: 'foreign', notes: '', sql: 'SELECT 99;' }, 'other')).json()
    vi.mocked(generateTextForConnection).mockResolvedValueOnce({ text: 'SELECT 1;', providerId: 'anthropic', connectionId: 'c', modelId: 'm' })

    const res = await app.fetch(
      req('/api/tasks/task1/database/generate', 'POST', { connectionId: 'c', prompt: 'p', queryIds: [picked.id, foreign.id, 'ghost'] }),
      {} as Env,
    )
    expect(res.status).toBe(200)
    const system = vi.mocked(generateTextForConnection).mock.calls.at(-1)![0].input.system ?? ''
    expect(system).toContain('orders.meta holds { coupon }')
    expect(system).toContain('-- paid orders\n-- excludes refunds\nSELECT 1;')
    expect(system).not.toContain('SELECT 99;')
  })
})
