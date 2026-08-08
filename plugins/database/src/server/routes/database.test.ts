import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseBridge } from './database'
import { schema } from '@acorn/node-core/server/db/index.ts'
import { createTaskService } from '@acorn/node-core/main/core/tasks.ts'
import { createProjectService } from '@acorn/node-core/main/core/projects.ts'
import type { GenerateTextRequest, ModelService } from '@acorn/node-core/main/core/index.ts'
import { ProviderOperationError } from '@acorn/node-core/server/integrations/types.ts'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import { requireUser } from '@acorn/node-core/server/middleware/requireUser.ts'
import { makeTestDb, makeTestPluginDb, type TestDb, type TestPluginDb } from '@acorn/node-core/testkit/db.ts'
import type { DbSavedQuery } from '../../shared/database'
import { databaseRoutes, setDatabaseBridge } from './database'
import { migrationsDir } from '../../node/migrations'
import type { Env } from '@acorn/node-core/main/bindings.ts'

const req = (url: string, method = 'GET', body?: unknown) =>
  new Request(`http://acorn.test${url}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

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

// One fixture for both describes: core's DB (tasks), the plugin's DB (saved queries), and a stub for
// the one core service the routes call out to.
type Fixture = {
  core: TestDb
  plugin: TestPluginDb
  generateText: ReturnType<typeof vi.fn<ModelService['generateText']>>
  router: () => Hono<AppEnv>
  cleanup: () => void
}

const fixture = (): Fixture => {
  const core = makeTestDb()
  const plugin = makeTestPluginDb('database', migrationsDir())
  const generateText = vi.fn<ModelService['generateText']>()
  const router = () => databaseRoutes(plugin.db, { tasks: createTaskService(core.db), projects: createProjectService(core.db), models: { generateText } })
  return {
    core,
    plugin,
    generateText,
    router,
    cleanup: () => {
      plugin.cleanup()
      core.cleanup()
      setDatabaseBridge(null)
    },
  }
}

describe('database routes', () => {
  let f: Fixture

  const authed = () => {
    const app = new Hono<AppEnv>()
    app.use('/api/*', async (c, next) => {
      c.set('principal', { kind: 'device', userId: 'james' })
      await next()
    })
    return app.route('/api/tasks', f.router())
  }

  beforeEach(() => {
    f = fixture()
  })
  afterEach(() => f.cleanup())

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

  it('generates SQL through the model service with the schema in the system prompt', async () => {
    setDatabaseBridge(fake())
    f.generateText.mockResolvedValueOnce({
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
    const args = f.generateText.mock.calls[0][0] as GenerateTextRequest
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
    expect(await failed.json()).toMatchObject({ error: { code: 'db_schema_unavailable', message: 'Not connected.' } })

    setDatabaseBridge(fake())
    f.generateText.mockRejectedValueOnce(new ProviderOperationError('provider_needs_auth', 401))
    const denied = await app.fetch(req('/api/tasks/task1/database/generate', 'POST', { connectionId: 'c', prompt: 'x' }), {} as Env)
    expect(denied.status).toBe(401)
    expect(await denied.json()).toMatchObject({ error: { code: 'provider_needs_auth' } })

    expect((await app.fetch(req('/api/tasks/task1/database/generate', 'POST', { connectionId: '', prompt: 'x' }), {} as Env)).status).toBe(400)
  })

  it('401s without a principal; 503s without a bridge', async () => {
    const gated = new Hono<AppEnv>().use('/api/*', requireUser).route('/api/tasks', f.router())
    expect((await gated.fetch(req('/api/tasks/task1/database/tables'), {} as Env)).status).toBe(401)
    expect((await authed().fetch(req('/api/tasks/task1/database/tables'), {} as Env)).status).toBe(503)
  })
})

// Saved queries are project-scoped rows addressed through a task, so these need both databases. Two tasks
// on different projects prove the scoping.
describe('saved queries (docs/pg.md)', () => {
  let f: Fixture
  let app: Hono<AppEnv>

  const task = (id: string, projectName: string) => ({
    id,
    title: 'T',
    origin: 'local' as const,
    projectId: `project-${projectName}`,
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
    f = fixture()
    app = new Hono<AppEnv>()
    app.use('/api/*', async (c, next) => {
      c.set('principal', { kind: 'device', userId: 'james' })
      await next()
    })
    app.route('/api/tasks', f.router())
    const now = Date.now()
    await f.core.db.insert(schema.workspaces).values({ id: 'workspace-1', name: 'Default', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
    await f.core.db.insert(schema.projects).values([
      { id: 'project-widget', name: 'widget', path: null, workspaceId: 'workspace-1', sort: 0, hidden: false, vcs: 'git', defaultBranch: 'main', remoteUrl: null, githubOwner: 'acme', githubName: 'widget', githubRepoId: 1, createdAt: now, updatedAt: now },
      { id: 'project-gadget', name: 'gadget', path: null, workspaceId: 'workspace-1', sort: 1, hidden: false, vcs: 'git', defaultBranch: 'main', remoteUrl: null, githubOwner: 'acme', githubName: 'gadget', githubRepoId: 2, createdAt: now, updatedAt: now },
    ])
    await f.core.db.insert(schema.tasks).values([task('task1', 'widget'), task('other', 'gadget')])
  })
  afterEach(() => f.cleanup())

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

  it('scopes rows to the task\'s project — a sibling project neither sees nor deletes them', async () => {
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
    f.generateText.mockResolvedValueOnce({ text: 'SELECT 1;', providerId: 'anthropic', connectionId: 'c', modelId: 'm' })

    const res = await app.fetch(
      req('/api/tasks/task1/database/generate', 'POST', { connectionId: 'c', prompt: 'p', queryIds: [picked.id, foreign.id, 'ghost'] }),
      {} as Env,
    )
    expect(res.status).toBe(200)
    const system = (f.generateText.mock.calls.at(-1)![0] as GenerateTextRequest).input.system ?? ''
    expect(system).toContain('orders.meta holds { coupon }')
    expect(system).toContain('-- paid orders\n-- excludes refunds\nSELECT 1;')
    expect(system).not.toContain('SELECT 99;')
  })
})
