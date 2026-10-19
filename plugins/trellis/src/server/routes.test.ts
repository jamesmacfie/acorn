import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv } from '@acorn/plugin-api/node'
import { appRoutes } from './routes'
import { AppStore } from './store'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function world(kind: 'device' | 'internal' = 'device') {
  const root = mkdtempSync(join(tmpdir(), 'trellis-routes-'))
  roots.push(root)
  const store = new AppStore(root)
  const changed = vi.fn()
  const app = new Hono<AppEnv>()
    .use(async (c, next) => {
      c.set('principal', { kind } as never)
      await next()
    })
    .route(
      '/',
      appRoutes({
        store,
        changed,
        loadTask: async (id) => (['t1', 't2', 't3'].includes(id) ? { id, projectId: 'p1' } : undefined),
      }),
    )
  const shown = await store.create({ taskId: 't1' }, 'Checklist', 'Steps', 's1')
  await store.publish(
    shown.appId,
    { program: 'root = Text("x")', plans: {} },
    { note: 'First.', library: { id: 'l', version: 1 } },
  )
  await store.create({ taskId: 't1' }, 'Draft', '')
  const send = (method: string) => (path: string, body: unknown) =>
    app.request(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { app, store, changed, appId: shown.appId, put: send('PUT'), post: send('POST') }
}

describe('the app routes', () => {
  it('lists the apps that have been shown, with the session that built each', async () => {
    const { app, appId } = await world()
    expect(await (await app.request('/apps')).json()).toEqual([
      expect.objectContaining({ appId, taskId: 't1', name: 'Checklist', head: 1, sessionId: 's1' }),
    ])
  })

  it("saves an app's $ variables up to 256 KiB, and refuses anything else", async () => {
    const { app, appId, put } = await world()
    expect((await put(`/apps/${appId}/state`, { state: { $ticked: ['a'] } })).status).toBe(204)
    expect(await (await app.request(`/apps/${appId}/state`)).json()).toEqual({ state: { $ticked: ['a'] } })
    expect((await put(`/apps/${appId}/state`, { state: { form: 1 } })).status).toBe(400)
    expect((await put(`/apps/${appId}/state`, { state: { $big: 'x'.repeat(256 * 1024) } })).status).toBe(413)
  })

  it("names an editing session, and tells clients when Restore moves an app's head", async () => {
    const { app, store, changed, appId, put } = await world()
    expect((await put(`/apps/${appId}/session`, { sessionId: 's2' })).status).toBe(204)
    expect((await store.meta(appId))?.sessionId).toBe('s2')
    await app.request(`/apps/${appId}/restore`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ revision: 1 }),
    })
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ appId, head: 2 }))
  })

  it('publishes a task app to its project, then its draft, and refuses a draft whose project app moved', async () => {
    const { app, store, appId, post, put } = await world()
    await put(`/apps/${appId}/state`, { state: { $ticked: ['a'] } })
    const first = (await (await post(`/apps/${appId}/publish`, {})).json()) as { appId: string; revision: number }
    expect(first.revision).toBe(1)
    expect(await store.meta(first.appId)).toMatchObject({ projectId: 'p1', name: 'Checklist', head: 1 })
    expect((await store.meta(first.appId))?.taskId).toBeUndefined()
    expect((await store.revision(first.appId, 1))?.meta.publishedFrom).toEqual({
      taskId: 't1',
      appId,
      revision: 1,
      sessionId: 's1',
    })
    expect(await store.state(first.appId)).toEqual({ $ticked: ['a'] })
    expect((await store.meta(appId))?.draftOf).toEqual({ appId: first.appId, revision: 1, head: 1 })

    // A draft in another task, which publishes first.
    const other = (await (await post(`/apps/${first.appId}/drafts`, { taskId: 't2' })).json()) as { appId: string }
    expect(await store.meta(other.appId)).toMatchObject({
      taskId: 't2',
      head: 1,
      draftOf: { appId: first.appId, revision: 1 },
    })
    expect(await store.state(other.appId)).toEqual({ $ticked: ['a'] })
    await store.publish(
      other.appId,
      { program: 'root = Text("y")', plans: {} },
      { note: 'Y.', library: { id: 'l', version: 1 } },
    )
    expect((await post(`/apps/${other.appId}/publish`, {})).status).toBe(200)

    await store.publish(
      appId,
      { program: 'root = Text("z")', plans: {} },
      { note: 'Z.', library: { id: 'l', version: 1 } },
    )
    await store.saveState(first.appId, { $ticked: ['b'] })
    expect((await post(`/apps/${appId}/publish`, {})).status).toBe(409)
    expect((await store.meta(first.appId))?.head).toBe(2)

    expect(await (await post(`/apps/${appId}/publish`, { mode: 'replace' })).json()).toEqual({
      appId: first.appId,
      revision: 3,
    })
    expect((await store.revision(first.appId, 3))?.files.program).toBe('root = Text("z")')
    // Publishing doesn't overwrite the project app's state.
    expect(await store.state(first.appId)).toEqual({ $ticked: ['b'] })

    await store.publish(
      other.appId,
      { program: 'root = Text("w")', plans: {} },
      { note: 'W.', library: { id: 'l', version: 1 } },
    )
    const fork = (await (await post(`/apps/${other.appId}/publish`, { mode: 'new' })).json()) as { appId: string }
    expect(fork.appId).not.toBe(first.appId)
    expect((await store.meta(other.appId))?.draftOf?.appId).toBe(fork.appId)
    expect(
      ((await (await app.request('/apps')).json()) as { projectId?: string }[]).filter((row) => row.projectId),
    ).toHaveLength(2)
  })

  it('keeps one draft per task, and deletes, restores, and removes a project app', async () => {
    const { app, store, appId, post, put } = await world()
    const project = (await (await post(`/apps/${appId}/publish`, {})).json()) as { appId: string }
    const draft = (await (await post(`/apps/${project.appId}/drafts`, { taskId: 't3' })).json()) as { appId: string }
    expect(await (await post(`/apps/${project.appId}/drafts`, { taskId: 't3' })).json()).toEqual(draft)
    expect((await post(`/apps/${project.appId}/drafts`, { taskId: 'elsewhere' })).status).toBe(404)
    // The task app itself isn't a project app.
    expect((await put(`/apps/${appId}/deleted`, { deleted: true })).status).toBe(404)

    expect((await app.request(`/apps/${project.appId}`, { method: 'DELETE' })).status).toBe(404)
    expect((await put(`/apps/${project.appId}/deleted`, { deleted: true })).status).toBe(204)
    expect((await post(`/apps/${project.appId}/drafts`, { taskId: 't2' })).status).toBe(404)
    // A deleted project app is no draft's publish target, so the draft publishes as a new app.
    await store.publish(
      draft.appId,
      { program: 'root = Text("y")', plans: {} },
      { note: 'Y.', library: { id: 'l', version: 1 } },
    )
    expect(((await (await post(`/apps/${draft.appId}/publish`, {})).json()) as { appId: string }).appId).not.toBe(
      project.appId,
    )
    expect((await put(`/apps/${project.appId}/deleted`, { deleted: false })).status).toBe(204)
    expect((await store.meta(project.appId))?.deletedAt).toBeUndefined()
    await put(`/apps/${project.appId}/deleted`, { deleted: true })
    expect((await app.request(`/apps/${project.appId}`, { method: 'DELETE' })).status).toBe(204)
    expect(await store.meta(project.appId)).toBeNull()
  })

  it("refuses an agent's token", async () => {
    const { app, appId, put } = await world('internal')
    expect((await app.request('/apps')).status).toBe(403)
    expect((await put(`/apps/${appId}/state`, { state: {} })).status).toBe(403)
  })
})
