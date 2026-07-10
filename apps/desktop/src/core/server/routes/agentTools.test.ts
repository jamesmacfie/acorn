import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { ApiError } from '../../shared/api'
import { encodeToolCeiling } from '../../shared/workflow'
import { setAgentTools, ToolError, TOOL_PERMS_PREF_KEY, type AgentToolContribution, type ToolPerms } from '../agentTools/registry'
import { getDb, schema } from '../db'
import type { AppEnv } from '../middleware/auth'
import { agentTools, agentToolsCatalog } from './agentTools'
import { makeTestDb, type TestDb } from './testDb'

vi.mock('../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db')>()
  return { ...actual, getDb: vi.fn() }
})

// One fixture registry drives BOTH projections' tests (the agent-tool registry acceptance: "covered by table-driven
// tests from the same contribution fixture"). The MCP projection is proven in mcp/server.test.ts;
// this is the harness HTTP projection over the identical shapes.
const calls: { name: string; args: unknown; taskId: string; session?: string }[] = []
let availabilityCalls = 0
const dynamicWhen = async (ctx: { taskId: string }) => {
  availabilityCalls++
  return ctx.taskId === 'ready'
}
const FIXTURE: AgentToolContribution[] = [
  {
    name: 'read_tool',
    description: 'a read tool',
    input: z.object({}),
    scope: 'task',
    risk: 'read',
    exposeToRenderer: true,
    handler: async (_a, ctx) => {
      calls.push({ name: 'read_tool', args: _a, taskId: ctx.taskId, session: ctx.sessionId })
      return { data: 'ok', task: ctx.taskId }
    },
  },
  {
    name: 'write_tool',
    description: 'a write tool',
    input: z.object({ slug: z.string() }),
    scope: 'task',
    risk: 'write',
    handler: async (a) => {
      calls.push({ name: 'write_tool', args: a, taskId: '' })
      return { ok: true }
    },
  },
  {
    name: 'exec_tool',
    description: 'a dynamic execute tool',
    input: z.object({}),
    scope: 'task',
    risk: 'execute',
    when: dynamicWhen,
    whenDescription: 'Only when ready.',
    handler: async () => ({ ran: true }),
  },
  {
    name: 'exec_tool_2',
    description: 'another dynamic execute tool',
    input: z.object({}),
    scope: 'task',
    risk: 'execute',
    when: dynamicWhen,
    whenDescription: 'Only when ready.',
    handler: async () => ({ ran: true }),
  },
  {
    name: 'throws_tool',
    description: 'maps a typed error',
    input: z.object({}),
    scope: 'task',
    risk: 'read',
    handler: async () => {
      throw new ToolError('not_found', 'nope')
    },
  },
]

describe('agent-tool harness projection (docs/agent-tools.md)', () => {
  let t: TestDb
  let app: Hono<AppEnv>

  const setPerms = async (perms: ToolPerms) => {
    await t.db
      .insert(schema.prefs)
      .values({ userId: 'james', key: TOOL_PERMS_PREF_KEY, value: JSON.stringify(perms) })
      .onConflictDoUpdate({ target: [schema.prefs.userId, schema.prefs.key], set: { value: JSON.stringify(perms) } })
  }

  beforeEach(() => {
    calls.length = 0
    availabilityCalls = 0
    t = makeTestDb()
    vi.mocked(getDb).mockReturnValue(t.db)
    setAgentTools(FIXTURE)
    app = new Hono<AppEnv>()
    app.use('/api/*', async (c, next) => {
      const kind = c.req.header('x-test-principal') === 'user' ? 'user' : 'internal'
      c.set('principal', { kind, user: { token: '', login: 'james', name: '', avatar: '', scopes: [] } })
      await next()
    })
    app.route('/api/tasks', agentTools)
    app.route('/api/agent-tools', agentToolsCatalog)
  })

  afterEach(() => {
    setAgentTools(null)
    t.cleanup()
  })

  const get = (path: string, headers?: Record<string, string>) => app.fetch(new Request(`http://acorn.test${path}`, { headers }), {} as Env)
  const post = (path: string, body: unknown, headers?: Record<string, string>) =>
    app.fetch(new Request(`http://acorn.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }), {} as Env)

  it('503s when no registry is installed (dev:node)', async () => {
    setAgentTools(null)
    expect((await get('/api/tasks/t1/tools')).status).toBe(503)
    expect((await post('/api/tasks/t1/tools/read_tool', {})).status).toBe(503)
  })

  it('manifest lists available tools with JSON schema; dynamic `when` gates a tool per task', async () => {
    const notReady = (await (await get('/api/tasks/t1/tools')).json()) as { tools: { name: string; inputSchema: unknown }[] }
    expect(notReady.tools.map((t) => t.name).sort()).toEqual(['read_tool', 'throws_tool', 'write_tool']) // exec_tool hidden
    expect(notReady.tools.find((t) => t.name === 'read_tool')?.inputSchema).toEqual({ type: 'object', properties: {} })
    expect(notReady.tools.find((t) => t.name === 'write_tool')?.inputSchema).toEqual({
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: { slug: { type: 'string' } },
      required: ['slug'],
    })
    expect(availabilityCalls).toBe(1) // shared predicate evaluated once for the manifest

    availabilityCalls = 0
    const ready = (await (await get('/api/tasks/ready/tools')).json()) as { tools: { name: string }[] }
    expect(ready.tools.map((t) => t.name)).toEqual(expect.arrayContaining(['exec_tool', 'exec_tool_2']))
    expect(availabilityCalls).toBe(1)
  })

  it('runs a tool: validates input, passes taskId + session header to the handler', async () => {
    const res = await post('/api/tasks/task9/tools/read_tool', {}, { 'x-acorn-session-id': 'sess-1' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: 'ok', task: 'task9' })
    expect(calls[0]).toMatchObject({ name: 'read_tool', taskId: 'task9', session: 'sess-1' })
  })

  it('rejects bad input against the zod schema (400) before the handler', async () => {
    const res = await post('/api/tasks/t1/tools/write_tool', { slug: 123 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as ApiError).error).toBe('bad_request')
    expect(calls).toHaveLength(0)
  })

  it('maps a thrown ToolError kind → status + envelope', async () => {
    const res = await post('/api/tasks/t1/tools/throws_tool', {})
    expect(res.status).toBe(404)
    expect((await res.json()) as ApiError).toEqual({ error: 'not_found', detail: ['nope'] })
  })

  it('404s an unknown tool and an unavailable (`when` false) tool alike', async () => {
    expect((await post('/api/tasks/t1/tools/nope', {})).status).toBe(404)
    expect((await post('/api/tasks/t1/tools/exec_tool', {})).status).toBe(404) // when=false for t1
  })

  it('keeps the harness internal-only and renderer-projects only opted-in tools', async () => {
    expect((await get('/api/tasks/t1/tools', { 'x-test-principal': 'user' })).status).toBe(404)
    expect((await post('/api/tasks/t1/renderer-tools/write_tool', { slug: 'x' }, { 'x-test-principal': 'user' })).status).toBe(404)
    expect((await post('/api/tasks/t1/renderer-tools/read_tool', {}, { 'x-test-principal': 'user' })).status).toBe(200)
  })

  it('permission toggle removes a tool from the manifest AND rejects the call (tier then per-tool)', async () => {
    await setPerms({ tiers: { write: false } })
    const manifest = (await (await get('/api/tasks/t1/tools')).json()) as { tools: { name: string }[] }
    expect(manifest.tools.map((t) => t.name)).not.toContain('write_tool')
    expect((await post('/api/tasks/t1/tools/write_tool', { slug: 'x' })).status).toBe(404)

    // A per-tool override wins over its (enabled) tier.
    await setPerms({ tools: { read_tool: false } })
    const m2 = (await (await get('/api/tasks/t1/tools')).json()) as { tools: { name: string }[] }
    expect(m2.tools.map((t) => t.name)).not.toContain('read_tool')
    expect((await post('/api/tasks/t1/tools/read_tool', {})).status).toBe(404)
  })

  it('intersects workflow allowlists/risk ceilings with global permissions for list and call', async () => {
    const ceiling = encodeToolCeiling({ allow: ['read_tool', 'write_tool'], maxRisk: 'read' })
    const headers = { 'x-acorn-tool-ceiling': ceiling }
    const manifest = (await (await get('/api/tasks/ready/tools', headers)).json()) as { tools: { name: string }[] }
    expect(manifest.tools.map((tool) => tool.name).sort()).toEqual(['read_tool'])
    expect((await post('/api/tasks/ready/tools/write_tool', { slug: 'x' }, headers)).status).toBe(404)
    expect((await post('/api/tasks/ready/tools/read_tool', {}, headers)).status).toBe(200)

    // Global permission is still authoritative even when the workflow allowlist includes a tool.
    await setPerms({ tools: { read_tool: false } })
    expect((await post('/api/tasks/ready/tools/read_tool', {}, headers)).status).toBe(404)
  })

  it('catalog lists every registered tool with its risk tier (settings page source)', async () => {
    const res = await get('/api/agent-tools')
    expect(await res.json()).toEqual({
      tools: [
        { name: 'read_tool', description: 'a read tool', risk: 'read' },
        { name: 'write_tool', description: 'a write tool', risk: 'write' },
        { name: 'exec_tool', description: 'a dynamic execute tool', risk: 'execute', availability: 'Only when ready.' },
        { name: 'exec_tool_2', description: 'another dynamic execute tool', risk: 'execute', availability: 'Only when ready.' },
        { name: 'throws_tool', description: 'maps a typed error', risk: 'read' },
      ],
    })
  })
})
