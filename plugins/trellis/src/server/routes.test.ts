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
    .route('/', appRoutes(store, changed))
  const shown = await store.create('t1', 'Checklist', 'Steps', 's1')
  await store.publish(
    shown.appId,
    { program: 'root = Text("x")', plans: {} },
    { note: 'First.', library: { id: 'l', version: 1 } },
  )
  await store.create('t1', 'Draft', '')
  const put = (path: string, body: unknown) =>
    app.request(path, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { app, store, changed, appId: shown.appId, put }
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

  it("refuses an agent's token", async () => {
    const { app, appId, put } = await world('internal')
    expect((await app.request('/apps')).status).toBe(403)
    expect((await put(`/apps/${appId}/state`, { state: {} })).status).toBe(403)
  })
})
