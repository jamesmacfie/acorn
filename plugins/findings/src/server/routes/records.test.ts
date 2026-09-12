import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PluginRequestContext, Principal } from '@acorn/plugin-api/node'
import { makeTestNodeContext, schema, type TestNodeContext } from '@acorn/plugin-api/testkit'
import { FindingCapture } from '../capture'
import { FindingsRuntime } from '../runtime'
import { findingsRecordRoutes } from './records'
import { portableFetch } from './carrier'

describe('finding device routes', () => {
  let ctx: TestNodeContext
  let runtime: FindingsRuntime

  beforeEach(() => {
    ctx = makeTestNodeContext({ plugin: { name: 'findings' } })
    const now = Date.now()
    ctx.db.insert(schema.workspaces).values({ id: 'ws', name: 'Workspace', isDefault: true, sort: 0, createdAt: now, updatedAt: now }).run()
    ctx.db.insert(schema.projects).values({ id: 'project', name: 'Acorn', path: ctx.dataDir, workspaceId: 'ws', createdAt: now, updatedAt: now }).run()
    ctx.db.insert(schema.tasks).values([
      { id: 'task-a', title: 'Task A', origin: 'local', projectId: 'project', status: 'active', createdAt: now, updatedAt: now },
      { id: 'task-b', title: 'Task B', origin: 'local', projectId: 'project', status: 'active', createdAt: now, updatedAt: now },
    ]).run()
    runtime = new FindingsRuntime({
      capture: new FindingCapture({
        db: ctx.storage.open(), core: ctx.core,
        kinds: () => [{ id: 'findings:observation', descriptor: { version: 1, label: 'Observation' } }],
      }),
      emit: () => {}, producerEntries: () => [],
    })
  })

  afterEach(() => ctx.cleanup())

  const request = (principal: Principal, path: string, init?: RequestInit) => {
    const context = { userId: principal.userId, principal, providers: {} } as PluginRequestContext
    return portableFetch(findingsRecordRoutes(runtime))(new Request(`http://acorn.test${path}`, init), context)
  }

  it('stamps device origin and keeps reads inside the task route', async () => {
    const principal: Principal = { kind: 'device', userId: 'owner', deviceId: 'device-1' }
    const created = await request(principal, '/tasks/task-a/observations', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceKey: 'device-capture', title: 'Finding', body: 'Body', claimStatus: 'asked' }),
    })
    expect(created.status).toBe(200)
    const id = ((await created.json()) as { id: string }).id

    const own = await request(principal, `/tasks/task-a/observations/${id}`)
    expect(own.status).toBe(200)
    expect(await own.json()).toMatchObject({ scope: { kind: 'task', taskId: 'task-a' }, origin: { kind: 'device', deviceId: 'device-1' } })
    expect((await request(principal, `/tasks/task-b/observations/${id}`)).status).toBe(404)
  })

  it('keeps the owner history routes unavailable to internal task credentials', async () => {
    const internal: Principal = { kind: 'internal', userId: 'owner', scope: 'task', taskId: 'task-a', sessionId: 'session-1' }
    expect((await request(internal, '/tasks/task-a/observations')).status).toBe(403)
    expect((await request(internal, '/tasks/task-a/observations', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceKey: 'spoof', title: 'Spoof', body: 'Body', claimStatus: 'observed' }),
    })).status).toBe(403)
  })

  it('lets a paired device capture project, workspace, and private observations without supplying origin', async () => {
    const principal: Principal = { kind: 'device', userId: 'owner', deviceId: 'device-1' }
    for (const [at, scope] of [
      { kind: 'project', projectId: 'project' },
      { kind: 'workspace', workspaceId: 'ws' },
      { kind: 'private' },
    ].entries()) {
      const response = await request(principal, '/observations', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope, observation: { sourceKey: `scope-${at}`, title: 'Scoped', body: 'Body', claimStatus: 'observed' } }),
      })
      expect(response.status).toBe(200)
    }
  })
})
