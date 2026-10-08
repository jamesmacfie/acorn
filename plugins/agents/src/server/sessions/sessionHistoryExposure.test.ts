import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import { makeTestNodeContext } from '@acorn/plugin-api/testkit'
import type { AppEnv } from '../../../../../packages/node-core/src/server/middleware/auth'
import { agentTools } from '../../../../../packages/node-core/src/server/routes/plugins/agentTools'
import { AgentStore } from './store'
import { sessionHistoryTools } from './sessionHistoryTools'

describe('history tool registry exposure', () => {
  const context = makeTestNodeContext({ plugin: { name: 'agents' } })
  afterEach(() => context.cleanup())

  it('hides both tools from a task token without a signed session claim', async () => {
    const store = new AgentStore(context.storage.open(), context.core)
    for (const tool of sessionHistoryTools(store)) context.tools.register(tool)
    const app = new Hono<AppEnv>()
    app.use('/api/*', async (c, next) => {
      c.set('principal', {
        kind: 'internal', userId: 'owner', scope: 'task', taskId: 'task',
        ...(c.req.header('x-test-session') ? { sessionId: 'signed-session' } : {}),
      })
      await next()
    })
    app.route('/api/tasks', agentTools)
    const request = (path: string, session = false, body?: unknown) => app.fetch(new Request(`http://acorn.test${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(session ? { 'x-test-session': 'yes' } : {}), 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), context.env)

    const missingClaim = await request('/api/tasks/task/tools')
    expect(missingClaim.status).toBe(200)
    const hidden = (await missingClaim.json()) as { tools: Array<{ name: string }> }
    expect(hidden.tools.map((tool) => tool.name)).not.toContain('session_history_search')
    expect(hidden.tools.map((tool) => tool.name)).not.toContain('session_history_read')
    expect((await request('/api/tasks/task/tools/session_history_search', false, { query: 'text' })).status).toBe(404)
    expect((await request('/api/tasks/task/tools/session_history_read', false, { seq: 1 })).status).toBe(404)

    const signed = (await (await request('/api/tasks/task/tools', true)).json()) as { tools: Array<{ name: string }> }
    expect(signed.tools.map((tool) => tool.name)).toEqual(['session_history_search', 'session_history_read'])
  })
})
