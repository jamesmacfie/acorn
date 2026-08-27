import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IntegrationMapping, IntegrationMappingsResponse, IntegrationProjectsResponse, Workspace, WorkspaceExternalProject, WorkspaceExternalProjectsResponse } from '@acorn/protocol/api.ts'
import { getDb, schema } from '../db'
import { SecretService } from '../../main/core/secrets'
import type { AppEnv } from '../middleware/auth'
import { connectionProviderRegistry } from '../integrations/connectionRegistry'
import { defaultBudgets, publicConnectionProvider } from '../integrations/providers/shared'
import type { ProviderProjectSource } from '../integrations/types'
import { integrations } from './integrations'
import { workspaces } from './workspaces'
import { makeTestDb, type TestDb } from '../../testkit/db'
import type { Env } from '../../main/bindings'

// The end-to-end shape of the host-owned mapping surface, over the real routes and a real database:
// enumerate a connection's projects, write the mapping, and, the invariant the whole design turns on,
// edit one provider's selection without disturbing anyone else's rows.
//
// The same rows are also read and written from the connection's side, which is what Settings →
// Integrations does now: one connection's whole map at once, including the links narrowed to a single
// project rather than a whole workspace.
//
// Written at the route level because the map itself is a component and vitest here cannot render one.
// What it covers is exactly what a manual pass would click, minus the pixels.

vi.mock('../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db')>()
  return { ...actual, getDb: vi.fn() }
})

const OWNER = 'external-projects-test'
const USER = 'james'
const SECRETS = new SecretService('42'.repeat(32))

const provider = (id: string, projects: ProviderProjectSource) => publicConnectionProvider({
  id,
  label: id,
  glyph: 'T',
  kind: 'issue-tracker',
  connection: {
    authKind: 'api-key' as const,
    fields: [],
    connectable: true,
    disconnectable: true,
    async validate() { return 'secret' },
    normalize(_credentials, secret) {
      return { secret, label: id, account: null, scopes: [], config: {}, capabilities: {} }
    },
    async test() { return { ok: true as const } },
  },
  capabilities: { browse: true },
  projects,
  budgets: defaultBudgets,
})

const makeApp = () => {
  const app = new Hono<AppEnv>()
  app.use('/api/*', async (c, next) => {
    c.set('principal', { kind: 'device', userId: USER })
    await next()
  })
  app.route('/api/workspaces', workspaces)
  app.route('/api/integrations', integrations)
  return app
}

const jsonReq = (url: string, method: string, body: unknown) =>
  new Request(`http://acorn.test${url}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

describe('workspace external projects, end to end', () => {
  let t: TestDb
  let app: Hono<AppEnv>

  beforeEach(async () => {
    t = makeTestDb()
    vi.mocked(getDb).mockReturnValue(t.db)
    app = makeApp()

    // One provider that fetches a list, one whose connection is a project, one that fails: the three
    // shapes the picker has to render side by side.
    connectionProviderRegistry.register(provider('tracker', {
      list: () => Promise.resolve([{ id: 'proj-1', label: 'Platform' }, { id: 'proj-2', label: 'Mobile' }]),
    }), OWNER)
    connectionProviderRegistry.register(provider('errors', {
      list: ({ connection }) => Promise.resolve([{ id: `${connection.id}-project`, label: connection.label }]),
    }), OWNER)
    connectionProviderRegistry.register(provider('broken', {
      list: () => Promise.reject(new Error('socket hang up')),
    }), OWNER)

    const now = Date.now()
    const authRef = await SECRETS.seal('live-token')
    for (const [id, providerId] of [['tracker-1', 'tracker'], ['errors-1', 'errors'], ['broken-1', 'broken']]) {
      await t.db.insert(schema.integrations).values({
        id: id!,
        userId: USER,
        provider: providerId!,
        label: `${providerId} one`,
        authRef,
        authKind: 'api-key',
        account: null,
        scopes: '[]',
        capabilities: '{}',
        config: '{}',
        status: 'connected',
        lastValidatedAt: now,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      })
    }
  })

  afterEach(() => {
    connectionProviderRegistry.removeForPlugin(OWNER)
    t.cleanup()
  })

  const env = () => ({ SECRETS } as unknown as Env)

  const createWorkspace = async (name: string): Promise<Workspace> => {
    const res = await app.fetch(jsonReq('/api/workspaces', 'POST', { name }), env())
    expect(res.status).toBe(200)
    return (await res.json()) as Workspace
  }

  const listProjects = async (connectionId: string): Promise<Response> =>
    app.fetch(new Request(`http://acorn.test/api/integrations/${connectionId}/projects`), env())

  const linked = async (workspaceId: string): Promise<WorkspaceExternalProject[]> => {
    const res = await app.fetch(new Request(`http://acorn.test/api/workspaces/${workspaceId}/external-projects`), env())
    expect(res.status).toBe(200)
    return ((await res.json()) as WorkspaceExternalProjectsResponse).projects
  }

  const setLinked = (workspaceId: string, projects: WorkspaceExternalProject[]) =>
    app.fetch(jsonReq(`/api/workspaces/${workspaceId}/external-projects`, 'PUT', { projects }), env())

  const mapped = async (connectionId: string): Promise<IntegrationMapping[]> => {
    const res = await app.fetch(new Request(`http://acorn.test/api/integrations/${connectionId}/mappings`), env())
    expect(res.status).toBe(200)
    return ((await res.json()) as IntegrationMappingsResponse).mappings
  }

  const setMapped = (connectionId: string, mappings: IntegrationMapping[]) =>
    app.fetch(jsonReq(`/api/integrations/${connectionId}/mappings`, 'PUT', { mappings }), env())

  const addProject = async (id: string, name: string, workspaceId: string): Promise<string> => {
    const now = Date.now()
    await t.db.insert(schema.projects).values({ id, name, path: `/tmp/${id}`, workspaceId, sort: 0, hidden: false, createdAt: now, updatedAt: now })
    return id
  }

  it('enumerates each connection independently, and one failing does not touch the others', async () => {
    const ok = await listProjects('tracker-1')
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as IntegrationProjectsResponse).projects).toEqual([
      { id: 'proj-1', label: 'Platform' },
      { id: 'proj-2', label: 'Mobile' },
    ])

    const single = await listProjects('errors-1')
    expect(((await single.json()) as IntegrationProjectsResponse).projects).toEqual([{ id: 'errors-1-project', label: 'errors one' }])

    // The failure is this connection's alone: the two above already answered.
    expect((await listProjects('broken-1')).status).toBe(502)
    // A connection that does not exist is not a 500 and not an empty list.
    expect((await listProjects('nope')).status).toBe(403)
  })

  it('writes a chosen project and reads the row straight back', async () => {
    const workspace = await createWorkspace('Runn')
    expect(await linked(workspace.id)).toEqual([])

    expect((await setLinked(workspace.id, [{ integrationId: 'tracker-1', externalId: 'proj-1' }])).status).toBe(200)

    expect(await linked(workspace.id)).toEqual([{ integrationId: 'tracker-1', externalId: 'proj-1' }])
    const rows = await t.db.select().from(schema.workspaceExternalProjects)
    expect(rows).toMatchObject([{ workspaceId: workspace.id, integrationId: 'tracker-1', externalId: 'proj-1' }])
  })

  it('leaves a sibling provider — and a failed connection — alone when one selection is edited', async () => {
    const workspace = await createWorkspace('Runn')
    // The starting state: one row per provider, including the connection whose list cannot load.
    await setLinked(workspace.id, [
      { integrationId: 'tracker-1', externalId: 'proj-1' },
      { integrationId: 'errors-1', externalId: 'errors-1-project' },
      { integrationId: 'broken-1', externalId: 'legacy-project' },
    ])

    // Exactly what the picker does on a tick: take the current set, add or remove one pair, write it
    // all back. Nothing has to remember to preserve the other rows, because they are never rebuilt.
    const current = await linked(workspace.id)
    const next = [
      ...current.filter((row) => !(row.integrationId === 'tracker-1' && row.externalId === 'proj-1')),
      { integrationId: 'tracker-1', externalId: 'proj-2' },
    ]
    expect((await setLinked(workspace.id, next)).status).toBe(200)

    expect(await linked(workspace.id)).toEqual(expect.arrayContaining([
      { integrationId: 'tracker-1', externalId: 'proj-2' },
      { integrationId: 'errors-1', externalId: 'errors-1-project' },
      // The point of the whole exercise: a connection the picker could not enumerate keeps its mapping.
      { integrationId: 'broken-1', externalId: 'legacy-project' },
    ]))
    expect(await linked(workspace.id)).toHaveLength(3)
  })

  it('narrows a link to one project, and leaves the workspace-wide form alone', async () => {
    const workspace = await createWorkspace('Runn')
    const web = await addProject('project-web', 'web', workspace.id)
    await addProject('project-api', 'api', workspace.id)

    expect((await setLinked(workspace.id, [
      { integrationId: 'tracker-1', externalId: 'proj-1' },
      { integrationId: 'tracker-1', externalId: 'proj-2', projectId: web },
    ])).status).toBe(200)

    // Both come back, and the narrow one still says which project it is for. The wide one omits the
    // field rather than carrying the '' the table stores.
    expect(await linked(workspace.id)).toEqual(expect.arrayContaining([
      { integrationId: 'tracker-1', externalId: 'proj-1' },
      { integrationId: 'tracker-1', externalId: 'proj-2', projectId: 'project-web' },
    ]))
    expect(await linked(workspace.id)).toHaveLength(2)
  })

  it('refuses to scope a link to a project from another workspace', async () => {
    const runn = await createWorkspace('Runn')
    const other = await createWorkspace('Other')
    const stray = await addProject('project-stray', 'stray', other.id)

    expect((await setLinked(runn.id, [{ integrationId: 'tracker-1', externalId: 'proj-1', projectId: stray }])).status).toBe(400)
    expect(await linked(runn.id)).toEqual([])
  })

  it('reads and replaces one connection\'s whole map across workspaces, without touching a sibling connection', async () => {
    const runn = await createWorkspace('Runn')
    const side = await createWorkspace('Side')
    const web = await addProject('project-web', 'web', runn.id)

    expect((await setMapped('tracker-1', [
      { workspaceId: runn.id, externalId: 'proj-1' },
      { workspaceId: runn.id, externalId: 'proj-2', projectId: web },
      { workspaceId: side.id, externalId: 'proj-1' },
    ])).status).toBe(200)
    expect((await setMapped('errors-1', [{ workspaceId: runn.id, externalId: 'errors-1-project' }])).status).toBe(200)

    expect(await mapped('tracker-1')).toEqual(expect.arrayContaining([
      { workspaceId: runn.id, externalId: 'proj-1' },
      { workspaceId: runn.id, externalId: 'proj-2', projectId: 'project-web' },
      { workspaceId: side.id, externalId: 'proj-1' },
    ]))

    // Replacing this connection's map drops all three of its rows and keeps the sibling's, which is
    // the whole reason the write is scoped to the connection rather than to a workspace.
    expect((await setMapped('tracker-1', [{ workspaceId: side.id, externalId: 'proj-2' }])).status).toBe(200)
    expect(await mapped('tracker-1')).toEqual([{ workspaceId: side.id, externalId: 'proj-2' }])
    expect(await mapped('errors-1')).toEqual([{ workspaceId: runn.id, externalId: 'errors-1-project' }])
  })

  it('refuses a connection map the caller has no row for', async () => {
    const workspace = await createWorkspace('Runn')
    expect((await app.fetch(new Request('http://acorn.test/api/integrations/not-mine/mappings'), env())).status).toBe(403)
    expect((await setMapped('not-mine', [{ workspaceId: workspace.id, externalId: 'proj-1' }])).status).toBe(403)
  })

  it('refuses a mapping naming a connection the caller has no row for', async () => {
    const workspace = await createWorkspace('Runn')
    expect((await setLinked(workspace.id, [{ integrationId: 'not-mine', externalId: 'proj-1' }])).status).toBe(403)
    expect(await linked(workspace.id)).toEqual([])
  })

  it('deleting the workspace takes its mappings with it', async () => {
    const workspace = await createWorkspace('Runn')
    await setLinked(workspace.id, [{ integrationId: 'tracker-1', externalId: 'proj-1' }])

    expect((await app.fetch(new Request(`http://acorn.test/api/workspaces/${workspace.id}`, { method: 'DELETE' }), env())).status).toBe(200)
    expect(await t.db.select().from(schema.workspaceExternalProjects)).toEqual([])
  })
})
