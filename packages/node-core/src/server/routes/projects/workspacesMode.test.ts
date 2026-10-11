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
import { createProjectRef } from '../../projects/projects'

vi.mock('../../db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../db')>()),
  getDb: vi.fn(),
}))
const { broadcasts } = vi.hoisted(() => ({ broadcasts: [] as { channel: string; workspaceId?: string }[] }))
vi.mock('../../transport/wsHub', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  wsBroadcast: (frame: { channel: string; workspaceId?: string }) => broadcasts.push(frame),
}))

describe('workspace mode at Node routes and plugin seam', () => {
  let t: TestDb
  let dir: string
  let app: Hono<AppEnv>
  const request = (path: string, method = 'GET', body?: unknown) =>
    app.fetch(
      new Request(`http://acorn.test/api${path}`, {
        method,
        ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      }),
      {} as Env,
    )
  const error = async (response: Response) => (await response.json()) as { error: { code: string; message: string } }

  beforeEach(() => {
    t = makeTestDb()
    broadcasts.length = 0
    vi.mocked(getDb).mockReturnValue(t.db)
    dir = mkdtempSync(join(tmpdir(), 'acorn-workspaces-mode-'))
    app = new Hono<AppEnv>()
    app.use('/api/*', async (c, next) => {
      c.set('principal', { kind: 'device', userId: 'owner' })
      await next()
    })
    app.route('/api/projects', projects)
    app.route('/api/workspaces', workspaces)
    app.route('/api/prefs', prefs)
  })
  afterEach(() => {
    t.cleanup()
    rmSync(dir, { recursive: true, force: true })
  })

  const add = async (name: string, workspaceId?: string) => {
    const path = join(dir, name)
    mkdirSync(path, { recursive: true })
    return request('/projects', 'POST', { path, ...(workspaceId ? { workspaceId } : {}) })
  }

  it('settles an empty Node to off, creates paired workspaces, and refuses other memberships', async () => {
    const first = await add('one')
    expect(first.status).toBe(200)
    const project = ((await first.json()) as { project: { id: string; workspaceId: string } }).project
    expect(t.db.select().from(schema.prefs).get()).toMatchObject({
      userId: 'owner',
      key: WORKSPACES_PREF_KEY,
      value: 'off',
    })
    expect(t.db.select().from(schema.workspaces).all()).toMatchObject([
      { id: project.workspaceId, name: 'one', isDefault: false },
    ])
    expect(broadcasts).toContainEqual({ channel: 'workspace:changed', workspaceId: project.workspaceId })
    expect((await error(await add('two', project.workspaceId))).error).toMatchObject({
      code: 'workspaces_off',
      message: expect.stringContaining('Add a project instead'),
    })
    expect((await error(await request('/workspaces', 'POST', { name: 'Other' }))).error.code).toBe('workspaces_off')
    expect(
      (await error(await request(`/workspaces/${project.workspaceId}`, 'PATCH', { name: 'Other' }))).error.code,
    ).toBe('workspaces_off')
    expect((await error(await request(`/workspaces/${project.workspaceId}`, 'DELETE'))).error.code).toBe(
      'workspaces_off',
    )
    expect((await error(await request(`/projects/${project.id}`, 'PATCH', { workspaceId: 'other' }))).error.code).toBe(
      'workspaces_off',
    )
    expect((await request(`/projects/${project.id}`, 'PATCH', { name: 'Renamed' })).status).toBe(200)
    expect(t.db.select().from(schema.workspaces).get()?.name).toBe('Renamed')
    t.db
      .insert(schema.integrations)
      .values({
        id: 'integration',
        userId: 'owner',
        provider: 'linear',
        label: 'Linear',
        encryptedCredentials: 'secret',
        createdAt: 1,
        updatedAt: 1,
      })
      .run()
    t.db
      .insert(schema.workspaceExternalProjects)
      .values({ workspaceId: project.workspaceId, integrationId: 'integration', externalId: 'external', createdAt: 1 })
      .run()
    t.db
      .insert(schema.datasets)
      .values({
        id: 'dataset',
        workspaceId: project.workspaceId,
        name: 'Data',
        mode: 'snapshot',
        feeder: 'manual',
        feederConfig: '{}',
        identityFields: '[]',
        retentionDays: 1,
        maxRows: 10,
        maxBytes: 1000,
        createdAt: 1,
        updatedAt: 1,
      })
      .run()
    expect((await request(`/projects/${project.id}`, 'DELETE')).status).toBe(200)
    expect(t.db.select().from(schema.workspaces).all()).toEqual([])
    expect(t.db.select().from(schema.workspaceExternalProjects).all()).toEqual([])
    expect(t.db.select().from(schema.datasets).all()).toEqual([])
    expect(
      broadcasts.filter((frame) => frame.channel === 'workspace:changed' && frame.workspaceId === project.workspaceId),
    ).toHaveLength(3)
  })

  it('keeps an install with projects grouped and makes the preference fixed', async () => {
    t.db
      .insert(schema.workspaces)
      .values({ id: 'default', name: 'Default', isDefault: true, sort: 0, createdAt: 1, updatedAt: 1 })
      .run()
    t.db
      .insert(schema.projects)
      .values({ id: 'old', name: 'Old', workspaceId: 'default', createdAt: 1, updatedAt: 1 })
      .run()
    expect((await add('next')).status).toBe(200)
    expect(t.db.select().from(schema.prefs).get()?.value).toBe('on')
    expect(t.db.select().from(schema.workspaces).all()).toHaveLength(1)
    expect((await error(await request('/prefs', 'PUT', { key: WORKSPACES_PREF_KEY, value: 'off' }))).error.code).toBe(
      'workspaces_fixed',
    )
  })

  it('groups separate projects without changing rows, then applies grouped rules on the next request', async () => {
    const first = ((await (await add('one')).json()) as { project: { id: string; workspaceId: string } }).project
    const second = ((await (await add('two')).json()) as { project: { id: string; workspaceId: string } }).project
    const before = {
      projects: t.db.select().from(schema.projects).all(),
      workspaces: t.db.select().from(schema.workspaces).all(),
    }
    broadcasts.length = 0
    expect((await request('/prefs', 'PUT', { key: WORKSPACES_PREF_KEY, value: 'on' })).status).toBe(200)
    expect(t.db.select().from(schema.projects).all()).toEqual(before.projects)
    expect(t.db.select().from(schema.workspaces).all()).toEqual(before.workspaces)
    expect(t.db.select().from(schema.prefs).get()?.value).toBe('on')
    expect(broadcasts).toEqual([{ channel: 'workspaces-mode:changed', mode: 'on' }])

    const team = (await (await request('/workspaces', 'POST', { name: 'Team' })).json()) as { id: string }
    expect((await request(`/workspaces/${team.id}`, 'PATCH', { name: 'Renamed team' })).status).toBe(200)
    expect(
      (await request(`/projects/${first.id}`, 'PATCH', { workspaceId: team.id, name: 'Renamed project' })).status,
    ).toBe(200)
    expect(t.db.select().from(schema.workspaces).all()).toContainEqual(
      expect.objectContaining({ id: first.workspaceId, name: 'one' }),
    )
    expect((await request(`/workspaces/${team.id}`, 'DELETE')).status).toBe(200)
    const defaultWorkspace = t.db
      .select()
      .from(schema.workspaces)
      .all()
      .find((row) => row.isDefault)!
    expect(t.db.select().from(schema.projects).all()).toContainEqual(
      expect.objectContaining({ id: first.id, workspaceId: defaultWorkspace.id }),
    )
    expect((await add('three')).status).toBe(200)
    expect(t.db.select().from(schema.projects).all()).toContainEqual(
      expect.objectContaining({ name: 'three', workspaceId: defaultWorkspace.id }),
    )
    expect((await request(`/projects/${second.id}`, 'DELETE')).status).toBe(200)
    expect(t.db.select().from(schema.workspaces).all()).toContainEqual(
      expect.objectContaining({ id: second.workspaceId }),
    )
  })

  it.each([
    [null, 'off', 200],
    [null, 'on', 200],
    ['off', 'off', 200],
    ['off', 'on', 200],
    ['on', 'on', 200],
    ['on', 'off', 409],
  ] as const)('writes mode %s to %s with status %s and only announces changes', async (stored, value, status) => {
    if (stored) t.db.insert(schema.prefs).values({ userId: 'owner', key: WORKSPACES_PREF_KEY, value: stored }).run()
    const response = await request('/prefs', 'PUT', { key: WORKSPACES_PREF_KEY, value })
    expect(response.status).toBe(status)
    expect(t.db.select().from(schema.prefs).get()?.value).toBe(status === 200 ? value : stored)
    expect(broadcasts).toEqual(
      status === 200 && stored !== value ? [{ channel: 'workspaces-mode:changed', mode: value }] : [],
    )
    if (status === 409)
      expect((await error(response)).error).toMatchObject({
        code: 'workspaces_fixed',
        message: "Grouped workspaces can't be switched back to separate projects.",
      })
  })

  it('refuses separate mode for an unset Node with projects without storing or broadcasting it', async () => {
    t.db.insert(schema.workspaces).values({ id: 'legacy', name: 'Legacy', createdAt: 1, updatedAt: 1 }).run()
    t.db
      .insert(schema.projects)
      .values({ id: 'old', name: 'Old', workspaceId: 'legacy', createdAt: 1, updatedAt: 1 })
      .run()
    expect((await request('/prefs', 'PUT', { key: WORKSPACES_PREF_KEY, value: 'off' })).status).toBe(409)
    expect(t.db.select().from(schema.prefs).all()).toEqual([])
    expect(broadcasts).toEqual([])
  })

  it('changes paired workspace artwork while off and removes only unreferenced images on project deletion', async () => {
    const first = ((await (await add('one')).json()) as { project: { id: string; workspaceId: string } }).project
    const second = ((await (await add('two')).json()) as { project: { id: string; workspaceId: string } }).project
    const imageId = 'a'.repeat(64)
    t.db
      .insert(schema.workspaceIconImages)
      .values({ id: imageId, bytes: Buffer.from('thumbnail') })
      .run()
    const appearance = { version: 1, kind: 'image', imageId }
    for (const project of [first, second]) {
      expect((await request(`/workspaces/${project.workspaceId}`, 'PATCH', { appearance })).status).toBe(200)
    }
    expect((await request(`/projects/${first.id}`, 'DELETE')).status).toBe(200)
    expect(t.db.select().from(schema.workspaceIconImages).all()).toHaveLength(1)
    expect((await request(`/projects/${second.id}`, 'DELETE')).status).toBe(200)
    expect(t.db.select().from(schema.workspaceIconImages).all()).toEqual([])
  })

  it('honours an explicit on preference on an empty Node and keeps Default', async () => {
    expect((await request('/prefs', 'PUT', { key: WORKSPACES_PREF_KEY, value: 'on' })).status).toBe(200)
    const response = await add('one')
    expect(response.status).toBe(200)
    const project = ((await response.json()) as { project: { workspaceId: string } }).project
    expect(t.db.select().from(schema.workspaces).all()).toMatchObject([
      { id: project.workspaceId, name: 'Default', isDefault: true },
    ])
    expect((await request('/prefs', 'PUT', { key: WORKSPACES_PREF_KEY, value: 'on' })).status).toBe(200)
    expect((await error(await request('/prefs', 'PUT', { key: WORKSPACES_PREF_KEY, value: 'off' }))).error.code).toBe(
      'workspaces_fixed',
    )
  })

  it.each(['off', 'on'] as const)(
    'places two folders in the expected workspaces after the wizard saves %s',
    async (mode) => {
      expect((await request('/prefs', 'PUT', { key: WORKSPACES_PREF_KEY, value: mode })).status).toBe(200)
      const first = ((await (await add('one')).json()) as { project: { id: string; workspaceId: string } }).project
      const second = ((await (await add('two')).json()) as { project: { id: string; workspaceId: string } }).project
      expect(first.id).not.toBe(second.id)
      expect(first.workspaceId === second.workspaceId).toBe(mode === 'on')
      expect(t.db.select().from(schema.workspaces).all()).toHaveLength(mode === 'on' ? 1 : 2)
    },
  )

  it('keeps grouped deletion behavior: reassigns projects and removes the workspace datasets', async () => {
    await request('/prefs', 'PUT', { key: WORKSPACES_PREF_KEY, value: 'on' })
    const created = await add('one')
    const project = ((await created.json()) as { project: { id: string; workspaceId: string } }).project
    const grouped = (await (await request('/workspaces', 'POST', { name: 'Team' })).json()) as { id: string }
    expect((await request(`/projects/${project.id}`, 'PATCH', { workspaceId: grouped.id })).status).toBe(200)
    t.db
      .insert(schema.datasets)
      .values({
        id: 'dataset',
        workspaceId: grouped.id,
        name: 'Data',
        mode: 'snapshot',
        feeder: 'manual',
        feederConfig: '{}',
        identityFields: '[]',
        retentionDays: 1,
        maxRows: 10,
        maxBytes: 1000,
        createdAt: 1,
        updatedAt: 1,
      })
      .run()
    expect((await request(`/workspaces/${grouped.id}`, 'DELETE')).status).toBe(200)
    expect(t.db.select().from(schema.projects).get()?.workspaceId).toBe(project.workspaceId)
    expect(t.db.select().from(schema.workspaces).all()).toMatchObject([{ id: project.workspaceId, isDefault: true }])
    expect(t.db.select().from(schema.datasets).all()).toEqual([])
  })

  it('rejects invalid preferences without settling an empty Node', async () => {
    expect(
      (await error(await request('/prefs', 'PUT', { key: WORKSPACES_PREF_KEY, value: 'sometimes' }))).error.code,
    ).toBe('bad_request')
    expect(t.db.select().from(schema.prefs).all()).toEqual([])
  })

  it('refuses explicit membership on a re-add while off but keeps the plain re-add idempotent', async () => {
    const first = await add('one')
    const project = ((await first.json()) as { project: { id: string; workspaceId: string } }).project
    const refused = await add('one', project.workspaceId)
    expect(refused.status).toBe(409)
    expect((await error(refused)).error.code).toBe('workspaces_off')
    const repeated = await add('one')
    expect(((await repeated.json()) as { project: { id: string } }).project.id).toBe(project.id)
    expect(t.db.select().from(schema.projects).all()).toHaveLength(1)
  })

  it('uses the same rule for deferred plugin projects', async () => {
    const ref = await createProjectRef(t.db, { name: 'Remote', github: { owner: 'acme', name: 'remote' } }, 'owner')
    expect(t.db.select().from(schema.workspaces).get()?.name).toBe('Remote')
    await expect(
      createProjectRef(
        t.db,
        { name: 'Other', workspaceId: ref.workspaceId, github: { owner: 'acme', name: 'other' } },
        'owner',
      ),
    ).rejects.toThrow('Add a project instead')
  })
})
