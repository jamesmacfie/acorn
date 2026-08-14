import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { schema } from '@acorn/node-core/server/db/index.ts'
import { createTaskService } from '@acorn/node-core/main/core/tasks.ts'
import { createProjectService } from '@acorn/node-core/main/core/projects.ts'
import type { GenerateTextRequest, ModelService } from '@acorn/node-core/main/core/index.ts'
import { ProviderOperationError } from '@acorn/node-core/server/integrations/types.ts'
import type { Principal } from '@acorn/node-core/server/middleware/auth.ts'
import type { PluginRequestContext } from '@acorn/plugin-api/node'
import { makeTestDb, makeTestPluginDb, type TestDb, type TestPluginDb } from '@acorn/node-core/testkit/db.ts'
import type { PluginCompletionResponse } from '@acorn/protocol/documentSurface.ts'
import type { DbSavedQuery } from '../../shared/database'
import type { DatabaseBridge } from '../../main/database'
import { createDatabaseFetch } from './database'

// These routes run over the PORTABLE CARRIER now — no host Hono stack, no middleware-set principal, and
// the identity arriving as the request context the host binds. So does the bridge: it is a closure
// argument rather than a capability resolved out of `c.env`, which is what lets a fake be handed in
// without a global registry to reset afterwards.
const principal = (userId: string, kind: Principal['kind'] = 'device'): Principal => ({ kind, userId })

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
  catalog: async () => ({ tables: [] }),
  ...over,
})

// One fixture for every describe: core's DB (tasks and projects), the plugin's DB (saved queries and
// scratch), and a stub for the one core service the routes call out to.
type Fixture = {
  core: TestDb
  plugin: TestPluginDb
  generateText: ReturnType<typeof vi.fn<ModelService['generateText']>>
  available: ReturnType<typeof vi.fn<ModelService['available']>>
  call: (path: string, init?: RequestInit, bridge?: DatabaseBridge, caller?: Principal) => Promise<Response>
  cleanup: () => void
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

const fixture = (): Fixture => {
  const core = makeTestDb()
  const plugin = makeTestPluginDb('database')
  const generateText = vi.fn<ModelService['generateText']>()
  const available = vi.fn<ModelService['available']>(async () => [])
  const call: Fixture['call'] = async (path, init, bridge = fake(), caller = principal('james')) => {
    const context: PluginRequestContext = {
      userId: caller.userId,
      principal: caller,
      providers: {
        connections: () => { throw new Error('database has no provider') },
        resource: () => { throw new Error('database has no provider') },
        withConnections: () => { throw new Error('database has no provider') },
        items: () => { throw new Error('database has no provider') },
      },
    }
    const services = { tasks: createTaskService(core.db), projects: createProjectService(core.db), models: { generateText, available } }
    return createDatabaseFetch(plugin.db, services, bridge)(new Request(`http://acorn.test${path}`, init), context)
  }
  return {
    core,
    plugin,
    generateText,
    available,
    call,
    cleanup: () => {
      plugin.cleanup()
      core.cleanup()
    },
  }
}

// Two tasks on different projects, which is what proves the project scoping on saved queries.
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

const seed = async (f: Fixture) => {
  const now = Date.now()
  await f.core.db.insert(schema.workspaces).values({ id: 'workspace-1', name: 'Default', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
  await f.core.db.insert(schema.projects).values([
    { id: 'project-widget', name: 'widget', path: null, workspaceId: 'workspace-1', sort: 0, hidden: false, vcs: 'git', defaultBranch: 'main', remoteUrl: null, githubOwner: 'acme', githubName: 'widget', githubRepoId: 1, createdAt: now, updatedAt: now },
    { id: 'project-gadget', name: 'gadget', path: null, workspaceId: 'workspace-1', sort: 1, hidden: false, vcs: 'git', defaultBranch: 'main', remoteUrl: null, githubOwner: 'acme', githubName: 'gadget', githubRepoId: 2, createdAt: now, updatedAt: now },
  ])
  await f.core.db.insert(schema.tasks).values([task('task1', 'widget'), task('other', 'gadget')])
}

describe('database routes', () => {
  let f: Fixture
  beforeEach(async () => {
    f = fixture()
    await seed(f)
  })
  afterEach(() => f.cleanup())

  it('connects and lists tables', async () => {
    expect(await (await f.call('/tasks/task1/connect', { method: 'POST' })).json()).toEqual({ ok: true, database: 'dev' })
    expect(await (await f.call('/tasks/task1/tables')).json()).toEqual({ tables: [] })
  })

  it('forwards a query and an update to the bridge', async () => {
    let sql: string | null = null
    let upd: unknown = null
    const bridge = fake({
      query: async (_t, s) => ((sql = s), { columns: [], rows: [], rowCount: 0, command: 'UPDATE', ms: 2 }),
      update: async (_t, schema, name, column, value, pk) => ((upd = { schema, name, column, value, pk }), { ok: true, rowCount: 1 }),
    })
    await f.call('/tasks/task1/query', json({ sql: 'select 1' }), bridge)
    expect(sql).toBe('select 1')
    await f.call('/tasks/task1/update', json({ schema: 'public', name: 't', column: 'c', value: 'v', pk: { id: '1' } }), bridge)
    expect(upd).toEqual({ schema: 'public', name: 't', column: 'c', value: 'v', pk: { id: '1' } })
  })

  it('400s malformed execute bodies and missing browse params', async () => {
    expect((await f.call('/tasks/task1/query', json({ sql: '' }))).status).toBe(400)
    expect((await f.call('/tasks/task1/update', json({ schema: 'public' }))).status).toBe(400)
    expect((await f.call('/tasks/task1/columns')).status).toBe(400) // no schema/name
  })

  it('generates SQL through the model service with the schema in the system prompt', async () => {
    f.generateText.mockResolvedValueOnce({
      text: '```sql\nSELECT * FROM users;\n```',
      providerId: 'anthropic',
      connectionId: 'conn1',
      modelId: 'claude-sonnet-5',
    })
    const res = await f.call('/tasks/task1/generate', json({ connectionId: 'conn1', modelId: 'claude-sonnet-5', prompt: 'all users' }))
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
    const noSchema = fake({ schema: async () => ({ error: 'Not connected.' }) })
    const failed = await f.call('/tasks/task1/generate', json({ connectionId: 'c', prompt: 'x' }), noSchema)
    expect(failed.status).toBe(422)
    expect(await failed.json()).toMatchObject({ error: { code: 'db_schema_unavailable', message: 'Not connected.' } })

    f.generateText.mockRejectedValueOnce(new ProviderOperationError('provider_needs_auth', 401))
    const denied = await f.call('/tasks/task1/generate', json({ connectionId: 'c', prompt: 'x' }))
    expect(denied.status).toBe(401)
    expect(await denied.json()).toMatchObject({ error: { code: 'provider_needs_auth' } })

    expect((await f.call('/tasks/task1/generate', json({ connectionId: '', prompt: 'x' }))).status).toBe(400)
  })

  // Generation and the picker behind it spend the owner's provider key, billed to the owner. A
  // task-scoped agent token must not reach either — the compiled route enforced this through the host's
  // `canUseProviderCredential`, which reads a middleware-set principal a loaded bundle does not have, so
  // this is the same rule read off the request context instead.
  it('refuses generation and the connection list to a task-scoped agent token', async () => {
    const agent = principal('james', 'internal')
    expect((await f.call('/tasks/task1/generate', json({ connectionId: 'c', prompt: 'x' }), fake(), agent)).status).toBe(403)
    expect((await f.call('/tasks/task1/model-connections', undefined, fake(), agent)).status).toBe(403)
    expect(f.generateText).not.toHaveBeenCalled()
  })
})

// The document surface's two routes. What the HOST does with them is its business; what this plugin owes
// is `{ text }` back, `{ text }` in, and a task that exists.
describe('the scratch document', () => {
  let f: Fixture
  beforeEach(async () => {
    f = fixture()
    await seed(f)
  })
  afterEach(() => f.cleanup())

  it('reads empty, writes, and reads back', async () => {
    expect(await (await f.call('/tasks/task1/scratch')).json()).toEqual({ text: '' })
    const put = await f.call('/tasks/task1/scratch', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'SELECT 1;' }) })
    expect(put.status).toBe(200)
    expect(await (await f.call('/tasks/task1/scratch')).json()).toEqual({ text: 'SELECT 1;' })
  })

  it('is per task, and 404s a task that does not exist on either verb', async () => {
    await f.call('/tasks/task1/scratch', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'SELECT 1;' }) })
    expect(await (await f.call('/tasks/other/scratch')).json()).toEqual({ text: '' })
    expect((await f.call('/tasks/ghost/scratch')).status).toBe(404)
    // The write is checked too: an autosave for a task that has gone should not quietly create a row
    // nothing will ever read again.
    const orphan = await f.call('/tasks/ghost/scratch', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'x' }) })
    expect(orphan.status).toBe(404)
  })
})

describe('completions', () => {
  let f: Fixture
  beforeEach(async () => {
    f = fixture()
    await seed(f)
  })
  afterEach(() => f.cleanup())

  const catalog = fake({
    catalog: async () => ({ tables: [{ schema: 'public', name: 'orders', columns: [{ name: 'id', dataType: 'uuid' }, { name: 'total', dataType: 'numeric' }] }] }),
  })

  it('offers a table after FROM and that table\'s columns after its alias', async () => {
    const after = async (text: string, column: number): Promise<PluginCompletionResponse> =>
      (await f.call('/tasks/task1/completions', json({ text, position: { line: 1, column } }), catalog)).json()

    const tables = await after('SELECT * FROM ', 15)
    expect(tables.items.map((i) => i.label)).toEqual(['orders'])

    const columns = await after('SELECT o. FROM orders o', 10)
    expect(columns.items.map((i) => i.label)).toEqual(['id', 'total'])
    expect(columns.items[0].kind).toBe('field')
  })

  // Typing before the pane has reached the database is normal, and an empty popup is the right answer:
  // a red line under the editor for "not connected yet" would be noise on every keystroke.
  it('answers an empty list rather than an error when there is no connection', async () => {
    const offline = fake({ catalog: async () => ({ error: 'Not connected.' }) })
    const res = await f.call('/tasks/task1/completions', json({ text: 'SELECT ', position: { line: 1, column: 8 } }), offline)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ items: [] })
  })
})

// Saved queries are project-scoped rows addressed through a task, so these need both databases.
describe('saved queries', () => {
  let f: Fixture
  beforeEach(async () => {
    f = fixture()
    await seed(f)
  })
  afterEach(() => f.cleanup())

  const list = async (taskId = 'task1'): Promise<DbSavedQuery[]> => (await f.call(`/tasks/${taskId}/queries`)).json()
  const save = (body: unknown, taskId = 'task1') => f.call(`/tasks/${taskId}/queries`, json(body))

  it('saves, lists and deletes a query', async () => {
    const saved: DbSavedQuery = await (await save({ name: 'paid orders', notes: 'excludes refunds', sql: 'SELECT 1;' })).json()
    expect(saved).toMatchObject({ name: 'paid orders', notes: 'excludes refunds', sql: 'SELECT 1;' })
    expect(await list()).toEqual([saved])

    expect((await f.call(`/tasks/task1/queries/${saved.id}`, { method: 'DELETE' })).status).toBe(200)
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
    await f.call(`/tasks/other/queries/${mine.id}`, { method: 'DELETE' })
    expect(await list()).toEqual([mine])
  })

  it('400s a blank name or empty SQL; 404s an unknown task', async () => {
    expect((await save({ name: ' ', notes: '', sql: 'SELECT 1;' })).status).toBe(400)
    expect((await save({ name: 'x', notes: '', sql: '  ' })).status).toBe(400)
    expect((await save({ name: 'x', notes: '', sql: 'SELECT 1;' }, 'nope')).status).toBe(404)
  })

  it('puts the picked examples in the generate prompt and ignores ids from elsewhere', async () => {
    const withNotes = fake({ schema: async () => ({ schema: 'SCHEMA', source: 'auto', notes: 'orders.meta holds { coupon }' }) })
    const picked: DbSavedQuery = await (await save({ name: 'paid orders', notes: 'excludes refunds', sql: 'SELECT 1;' })).json()
    const foreign: DbSavedQuery = await (await save({ name: 'foreign', notes: '', sql: 'SELECT 99;' }, 'other')).json()
    f.generateText.mockResolvedValueOnce({ text: 'SELECT 1;', providerId: 'anthropic', connectionId: 'c', modelId: 'm' })

    const res = await f.call(
      '/tasks/task1/generate',
      json({ connectionId: 'c', prompt: 'p', queryIds: [picked.id, foreign.id, 'ghost'] }),
      withNotes,
    )
    expect(res.status).toBe(200)
    const system = (f.generateText.mock.calls.at(-1)![0] as GenerateTextRequest).input.system ?? ''
    expect(system).toContain('orders.meta holds { coupon }')
    expect(system).toContain('-- paid orders\n-- excludes refunds\nSELECT 1;')
    expect(system).not.toContain('SELECT 99;')
  })

  // The agent composer's entry, moved off the client with the rest of the plugin. The interesting half
  // is the scoping: the options a task offers are its project's, not every project's.
  it('serves the composer its options and captures the picked ones', async () => {
    const mine: DbSavedQuery = await (await save({ name: 'paid orders', notes: 'excludes refunds', sql: 'SELECT 1;' })).json()
    await save({ name: 'foreign', notes: '', sql: 'SELECT 99;' }, 'other')

    const options = await (await f.call('/context-options?taskId=task1')).json()
    expect(options).toEqual([{ id: mine.id, label: 'paid orders', description: 'excludes refunds' }])

    const captured = await (await f.call('/context-capture', json({ taskId: 'task1', optionIds: [mine.id] }))).json()
    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({ contextId: mine.id, label: 'Database · paid orders', deepLink: { pane: 'database' } })
    expect(captured[0].content).toContain('SELECT 1;')
    // The connection URL is resolved per connect and never persisted, so there is nothing here to leak —
    // this asserts that the snapshot really is only the query and its notes.
    expect(captured[0].content).not.toContain('postgres://')
  })
})
