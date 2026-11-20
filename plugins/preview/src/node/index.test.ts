import { describe, expect, it, vi } from 'vitest'
import type { PluginFetchHandler } from '@acorn/plugin-api/node'
import { previewPlugin } from './index'

// The preview plugin's own routes, served by the handler it registers.
function routes() {
  let serve: PluginFetchHandler | undefined
  const plugin = previewPlugin()
  const ctx = {
    core: { tasks: { load: async () => undefined, active: async () => [] } },
    capabilities: { get: () => undefined, provide: () => {} },
    events: { send: vi.fn(), on: () => {} },
    routes: { fetch: (handler: PluginFetchHandler) => void (serve = handler), loopback: () => {} },
    log: { warn: () => {} },
  }
  void plugin.init!(ctx as never)
  const principals = {
    device: { kind: 'device', userId: 'owner', deviceId: 'laptop' },
    taskToken: { kind: 'internal', userId: 'owner', scope: 'task', taskId: 't1' },
  } as const
  return (who: keyof typeof principals, method: string, path: string, body?: unknown) =>
    serve!(new Request(`http://node${path}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) }), {
      principal: principals[who],
    } as never)
}

describe('the recipe route', () => {
  it('refuses a task’s own token, so an agent can’t move the address the owner’s preview shows', async () => {
    const call = routes()
    const refused = await call('taskToken', 'POST', '/tasks/t1/recipe-url', { url: 'http://localhost:5432' })
    expect(refused.status).toBe(403)
    expect(await (await call('device', 'GET', '/tasks/t1/url')).json()).toBeNull()

    const picked = await call('device', 'POST', '/tasks/t1/recipe-url', { url: 'http://localhost:5173' })
    expect(picked.status).toBe(200)
    expect(await (await call('taskToken', 'GET', '/tasks/t1/url')).json()).toMatchObject({
      url: 'http://localhost:5173',
      source: 'recipe',
    })
  })
})
