import { Hono } from 'hono'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WORKSPACES_PREF_KEY } from '@acorn/protocol/workspacesMode.ts'
import { getDb, schema } from '../../db'
import type { AppEnv } from '../../middleware/auth'
import { projects } from './projects'
import { workspaces } from './workspaces'
import { prefs } from '../prefs'
import { makeTestDb, type TestDb } from '../../../testkit/db'
import type { Env } from '../../bindings'
import { createProjectRef } from '../../projects'

vi.mock('../../db', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../db')>()), getDb: vi.fn() }))
const { broadcasts } = vi.hoisted(() => ({ broadcasts: [] as { channel: string; workspaceId?: string }[] }))
vi.mock('../../transport/wsHub', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  wsBroadcast: (frame: { channel: string; workspaceId?: string }) => broadcasts.push(frame),
}))

describe('workspace mode at Node routes and plugin seam', () => {
  let t: TestDb
  let dir: string
  let app: Hono<AppEnv>
  const request = (path: string, method = 'GET', body?: unknown) => app.fetch(new Request(`http://acorn.test/api${path}`, {
    method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  }), {} as Env)
  const error = async (response: Response) => (await response.json()) as { error: { code: string; message: string } }

  beforeEach(() => {
    t = makeTestDb()
    broadcasts.length = 0
    vi.mocked(getDb).mockReturnValue(t.db)
    dir = mkdtempSync(join(tmpdir(), 'acorn-workspaces-mode-'))
    app = new Hono<AppEnv>()
    app.use('/api/*', async (c, next) => { c.set('principal', { kind: 'device', userId: 'owner' }); await next() })
    app.route('/api/projects', projects)
    app.route('/api/workspaces', workspaces)
    app.route('/api/prefs', prefs)
  })
  afterEach(() => { t.cleanup(); rmSync(dir, { recursive: true, force: true }) })

  const add = async (name: string, workspaceId?: string) => {
    const path = join(dir, name)
    mkdirSync(path)
    return request('/projects', 'POST', { path, ...(workspaceId ? { workspaceId } : {}) })
  }

  it('settles an empty Node to off, creates paired workspaces, and refuses other memberships', async () => {
    expect(await (await request('/workspaces/bootstrap', 'POST')).json()).toEqual([])
    const first = await add('one')
    expect(first.status).toBe(200)
    const project = ((await first.json()) as { project: { id: string; workspaceId: string } }).project
    expect(t.db.select().from(schema.prefs).get()).toMatchObject({ userId: 'owner', key: WORKSPACES_PREF_KEY, value: 'off' })
    expect(t.db.select().from(schema.workspaces).all()).toMatchObject([{ id: project.workspaceId, name: 'one', isDefault: false }])
    expect(broadcasts).toContainEqual({ channel: 'workspace:changed', workspaceId: project.workspaceId })
    expect((await error(await add('two', project.workspaceId))).error).toMatchObject({ code: 'workspaces_off', message: expect.stringContaining('Add a project instead') })
    expect((await error(await request('/workspaces', 'POST', { name: 'Other' }))).error.code).toBe('workspaces_off')
    expect((await error(await request(`/workspaces/${project.workspaceId}`, 'PATCH', { name: 'Other' }))).error.code).toBe('workspaces_off')
    expect((await error(await request(`/workspaces/${project.workspaceId}`, 'DELETE'))).error.code).toBe('workspaces_off')
    expect((await error(await request(`/projects/${project.id}`, 'PATCH', { workspaceId: 'other' }))).error.code).toBe('workspaces_off')
    expect((await request(`/projects/${project.id}`, 'PATCH', { name: 'Renamed' })).status).toBe(200)
    expect(t.db.select().from(schema.workspaces).get()?.name).toBe('Renamed')
    t.db.insert(schema.integrations).values({ id: 'integration', userId: 'owner', provider: 'linear', label: 'Linear', encryptedCredentials: 'secret', createdAt: 1, updatedAt: 1 }).run()
    t.db.insert(schema.workspaceExternalProjects).values({ workspaceId: project.workspaceId, integrationId: 'integration', externalId: 'external', createdAt: 1 }).run()
    t.db.insert(schema.datasets).values({ id: 'dataset', workspaceId: project.workspaceId, name: 'Data', mode: 'snapshot', feeder: 'manual', feederConfig: '{}', identityFields: '[]', retentionDays: 1, maxRows: 10, maxBytes: 1000, createdAt: 1, updatedAt: 1 }).run()
    expect((await request(`/projects/${project.id}`, 'DELETE')).status).toBe(200)
    expect(t.db.select().from(schema.workspaces).all()).toEqual([])
    expect(t.db.select().from(schema.workspaceExternalProjects).all()).toEqual([])
    expect(t.db.select().from(schema.datasets).all()).toEqual([])
    expect(broadcasts.filter((frame) => frame.channel === 'workspace:changed' && frame.workspaceId === project.workspaceId)).toHaveLength(3)
  })

  it('keeps an install with projects grouped and makes the preference fixed', async () => {
    t.db.insert(schema.workspaces).values({ id: 'default', name: 'Default', isDefault: true, sort: 0, createdAt: 1, updatedAt: 1 }).run()
    t.db.insert(schema.projects).values({ id: 'old', name: 'Old', workspaceId: 'default', createdAt: 1, updatedAt: 1 }).run()
    expect((await add('next')).status).toBe(200)
    expect(t.db.select().from(schema.prefs).get()?.value).toBe('on')
    expect(t.db.select().from(schema.workspaces).all()).toHaveLength(1)
    expect((await error(await request('/prefs', 'PUT', { key: WORKSPACES_PREF_KEY, value: 'off' }))).error.code).toBe('workspaces_fixed')
  })

  it('uses the same rule for deferred plugin projects', async () => {
    const ref = await createProjectRef(t.db, { name: 'Remote', github: { owner: 'acme', name: 'remote' } }, 'owner')
    expect(t.db.select().from(schema.workspaces).get()?.name).toBe('Remote')
    await expect(createProjectRef(t.db, { name: 'Other', workspaceId: ref.workspaceId, github: { owner: 'acme', name: 'other' } }, 'owner'))
      .rejects.toThrow('Add a project instead')
  })
})
