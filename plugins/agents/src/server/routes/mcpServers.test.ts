import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppEnv, Env } from '@acorn/plugin-api/testkit'
import type { AgentMcpServer } from '../../shared/mcpServers'
import { agentMcpServers, setAgentMcpServersBridge, type AgentMcpServersBridge } from './mcpServers'

const request = (path: string, method = 'GET', body?: unknown) => new Request(`http://acorn.test${path}`, {
  method,
  headers: body === undefined ? undefined : { 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
})

const as = (principal: Record<string, unknown>) => {
  const app = new Hono<AppEnv>()
  app.use('/api/*', async (c, next) => {
    c.set('principal', principal as never)
    await next()
  })
  return app.route('/api/agents', agentMcpServers)
}
const device = () => as({ kind: 'device', userId: 'james' })
// An agent session's own ACORN_API_TOKEN.
const agent = () => as({ kind: 'internal', userId: 'james', scope: 'task', taskId: 'task1' })

const saved: AgentMcpServer = {
  name: 'linear', transport: 'stdio', command: 'npx', args: [], url: null, values: [], enabled: true, updatedAt: 1,
}

describe('Settings → MCP servers routes', () => {
  afterEach(() => setAgentMcpServersBridge(null))

  const bridge = (calls: string[]): AgentMcpServersBridge => ({
    list: async () => { calls.push('list'); return [saved] },
    save: async (name) => { calls.push(`save:${name}`); return saved },
    remove: async (name) => { calls.push(`remove:${name}`); return name === 'linear' },
    test: async () => null,
  })

  // A stdio server is a command the next session runs, so an agent must neither add one nor read them.
  it('refuses every route to a task-scoped agent before reaching the bridge', async () => {
    const calls: string[] = []
    setAgentMcpServersBridge(bridge(calls))
    const app = agent()
    const valid = { transport: 'stdio', command: 'npx', enabled: true }
    expect((await app.fetch(request('/api/agents/mcp-servers'), {} as Env)).status).toBe(403)
    expect((await app.fetch(request('/api/agents/mcp-servers/linear', 'PUT', valid), {} as Env)).status).toBe(403)
    expect((await app.fetch(request('/api/agents/mcp-servers/linear', 'DELETE'), {} as Env)).status).toBe(403)
    expect(calls).toEqual([])
  })

  it('validates the name and the body at the boundary', async () => {
    const calls: string[] = []
    setAgentMcpServersBridge(bridge(calls))
    const app = device()
    expect((await app.fetch(request('/api/agents/mcp-servers/acorn', 'PUT', { transport: 'stdio', command: 'x', enabled: true }), {} as Env)).status).toBe(400)
    expect((await app.fetch(request('/api/agents/mcp-servers/bad%20name', 'PUT', { transport: 'stdio', command: 'x', enabled: true }), {} as Env)).status).toBe(400)
    expect((await app.fetch(request('/api/agents/mcp-servers/docs', 'PUT', { transport: 'http', url: 'file:///etc/passwd', enabled: true }), {} as Env)).status).toBe(400)
    expect((await app.fetch(request('/api/agents/mcp-servers/linear', 'PUT', { transport: 'stdio', command: 'npx', enabled: true }), {} as Env)).status).toBe(200)
    expect((await app.fetch(request('/api/agents/mcp-servers/gone', 'DELETE'), {} as Env)).status).toBe(404)
    expect(calls).toEqual(['save:linear', 'remove:gone'])
  })
})
