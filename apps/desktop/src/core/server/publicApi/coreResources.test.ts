import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAutomationApp } from './app'
import { buildCoreResourceContribution } from './coreResources'
import { IdempotencyStore } from './idempotency'
import { AutomationApiRegistry } from './registry'
import { TaskService } from './services/taskService'
import { WorkspaceService } from './services/workspaceService'
import { TokenService } from './tokenService'
import { makeTestDb, type TestDb } from '../routes/testDb'

const HOST = '127.0.0.1:4318'

describe('core resource endpoints', () => {
  let t: TestDb
  let app: ReturnType<typeof createAutomationApp>
  let write: string
  let read: string

  beforeEach(async () => {
    t = makeTestDb()
    const tokens = new TokenService(t.db)
    write = (await tokens.create({ userId: 'octocat', name: 'w', scopes: ['read', 'write'], expiresAt: null })).token
    read = (await tokens.create({ userId: 'octocat', name: 'r', scopes: ['read'], expiresAt: null })).token
    const registry = new AutomationApiRegistry()
    registry.registerContribution(
      buildCoreResourceContribution({ db: t.db, workspaces: new WorkspaceService(t.db), tasks: new TaskService(t.db) }),
      'core',
    )
    app = createAutomationApp({ snapshot: registry.freeze(), tokens, idempotency: new IdempotencyStore(t.db), allowedHost: HOST })
  })
  afterEach(() => t.cleanup())

  const call = (path: string, init: RequestInit = {}, token = write) => {
    const headers = new Headers(init.headers)
    headers.set('host', HOST)
    headers.set('authorization', `Bearer ${token}`)
    return app.fetch(new Request(`http://${HOST}/api/v1${path}`, { ...init, headers }), {} as Env)
  }
  const json = (method: string, path: string, body: unknown, extra: Record<string, string> = {}, token = write) =>
    call(path, { method, headers: { 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) }, token)

  it('creates, reads, patches, and deletes a workspace', async () => {
    const created = await json('POST', '/workspaces', { name: 'Runn', icon: { kind: 'emoji', value: '🌰' } })
    expect(created.status).toBe(201)
    const ws = (await created.json()).data
    expect(ws.name).toBe('Runn')
    expect(ws.icon).toEqual({ kind: 'emoji', value: '🌰' })
    expect(created.headers.get('location')).toBe(`/api/v1/workspaces/${ws.id}`)

    const list = (await (await call('/workspaces')).json()).data
    expect(list.items.map((w: { name: string }) => w.name)).toContain('Runn')

    const patched = (await (await json('PATCH', `/workspaces/${ws.id}`, { name: 'Runn 2' })).json()).data
    expect(patched.name).toBe('Runn 2')

    expect((await call(`/workspaces/${ws.id}`, { method: 'DELETE' })).status).toBe(204)
    expect((await call(`/workspaces/${ws.id}`)).status).toBe(404)
  })

  it('refuses deleting the Default workspace', async () => {
    await json('POST', '/workspaces/bootstrap', undefined) // seeds Default
    const list = (await (await call('/workspaces')).json()).data.items
    const def = list.find((w: { isDefault: boolean }) => w.isDefault)
    const res = await call(`/workspaces/${def.id}`, { method: 'DELETE' })
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('cannot_delete_default')
  })

  it('enforces write scope and idempotency on task creation', async () => {
    const body = { origin: 'local', repoOwner: 'acme', repoName: 'web', branch: 'feature/x' }

    // read token cannot create
    const denied = await json('POST', '/tasks', body, { 'idempotency-key': 'k1' }, read)
    expect(denied.status).toBe(403)

    // required idempotency key missing
    const noKey = await json('POST', '/tasks', body)
    expect(noKey.status).toBe(400)

    const first = await json('POST', '/tasks', body, { 'idempotency-key': 'k1' })
    expect(first.status).toBe(201)
    const task = (await first.json()).data
    expect(task.title).toBe('web · feature/x')
    expect(task.status).toBe('active')

    // replay returns the same task
    const replay = await json('POST', '/tasks', body, { 'idempotency-key': 'k1' })
    expect((await replay.json()).data.id).toBe(task.id)
  })

  it('lists, patches, archives, restores, and reports task status', async () => {
    const task = (await (await json('POST', '/tasks', { origin: 'local', repoOwner: 'a', repoName: 'b', branch: 'main' }, { 'idempotency-key': 'kk' })).json()).data

    const active = (await (await call('/tasks')).json()).data.items
    expect(active).toHaveLength(1)

    await json('PATCH', `/tasks/${task.id}`, { title: 'Renamed' })
    expect((await (await call(`/tasks/${task.id}`)).json()).data.title).toBe('Renamed')

    const archived = (await (await json('POST', `/tasks/${task.id}/archive`, {})).json()).data
    expect(archived.status).toBe('archived')
    expect(archived.archivedAt).toBeGreaterThan(0)
    // default active filter now excludes it
    expect((await (await call('/tasks')).json()).data.items).toHaveLength(0)
    expect((await (await call('/tasks?status=archived')).json()).data.items).toHaveLength(1)

    const restored = (await (await json('POST', `/tasks/${task.id}/restore`, undefined)).json()).data
    expect(restored.status).toBe('active')

    const status = (await (await call(`/tasks/${task.id}/status`)).json()).data
    expect(status).toEqual({ taskId: task.id, worktreePath: null, dirty: false, dirtyCount: 0, missing: false, runningSessionCount: 0, runningWorkflowCount: 0 })
  })

  it('rejects immediate worktree creation without the desktop runtime', async () => {
    const res = await json('POST', '/tasks', { origin: 'local', repoOwner: 'a', repoName: 'b', branch: 'm', checkout: { mode: 'create-worktree' } }, { 'idempotency-key': 'w1' })
    expect(res.status).toBe(503)
    expect((await res.json()).error.code).toBe('capability_unavailable')
  })

  it('manages repository assignments', async () => {
    const ws = (await (await json('POST', '/workspaces', { name: 'WS' })).json()).data
    const put = await json('PUT', '/repository-assignments/acme/web', { workspaceId: ws.id })
    expect(put.status).toBe(200)
    expect((await put.json()).data).toMatchObject({ owner: 'acme', name: 'web', workspaceId: ws.id, ignored: false })

    const patched = (await (await json('PATCH', '/repository-assignments/acme/web', { ignored: true })).json()).data
    expect(patched.ignored).toBe(true)

    const listed = (await (await call('/repository-assignments?ignored=true')).json()).data.items
    expect(listed).toHaveLength(1)
  })
})
