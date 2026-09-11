import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { ApiError } from '@acorn/protocol/api.ts'
import type { ToolCeiling } from '@acorn/protocol/workflow.ts'
import { registerAgentTool, removeAgentTools, ToolError, TOOL_PERMS_PREF_KEY, type AgentToolContribution, type ToolPerms } from '../../agentTools/registry'
import { getDb, schema } from '../../db'
import type { AppEnv } from '../../middleware/auth'
import { agentTools, agentToolsCatalog } from './agentTools'
import { makeTestDb, type TestDb } from '../../../testkit/db'
import type { Env } from '../../bindings'

vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>()
  return { ...actual, getDb: vi.fn() }
})

// One fixture registry drives both projections' tests (the agent-tool registry acceptance: "covered by table-driven
// tests from the same contribution fixture"). The MCP projection is proven in mcp/server.test.ts;
// this is the harness HTTP projection over the identical shapes.
const OWNER = 'test'
const calls: {
  name: string
  args: unknown
  taskId: string
  session?: string
  callId?: string
  toolCeiling?: ToolCeiling
}[] = []
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
      calls.push({
        name: 'read_tool',
        args: _a,
        taskId: ctx.taskId,
        session: ctx.sessionId,
        callId: ctx.callId,
        toolCeiling: ctx.toolCeiling,
      })
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
    name: 'orchestration_tool',
    description: 'requires a signed owner session',
    input: z.object({}),
    scope: 'task',
    risk: 'execute',
    requiresSession: true,
    handler: async (_a, ctx) => {
      calls.push({ name: 'orchestration_tool', args: _a, taskId: ctx.taskId, session: ctx.sessionId })
      return { ran: true }
    },
  },
  {
    name: 'throws_tool',
    description: 'maps a typed error',
    input: z.object({ conflict: z.boolean().optional() }),
    scope: 'task',
    risk: 'read',
    handler: async (input) => {
      if ((input as { conflict?: boolean }).conflict) throw new ToolError('conflict', 'busy')
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
    // Incremental registration under one owner, which is what a plugin's init does through ctx.tools.
    // Removed first so the fixture is idempotent across cases: the registry is a module singleton.
    removeAgentTools(OWNER)
    for (const tool of FIXTURE) registerAgentTool(OWNER, tool)
    app = new Hono<AppEnv>()
    app.use('/api/*', async (c, next) => {
      const kind = c.req.header('x-test-principal') === 'device' ? 'device' : 'internal'
      // An internal principal now carries a scope. These cases address many different task ids, so the
      // default is the unbound 'service' scope; 'x-test-task' opts into a 'task'-scoped credential bound
      // to one task, which is what the cross-task case needs.
      const boundTask = c.req.header('x-test-task')
      const sessionId = c.req.header('x-test-session')
      const maxRisk = c.req.header('x-test-max-risk') as ToolCeiling['maxRisk'] | undefined
      c.set(
        'principal',
        kind === 'device'
          ? { kind, userId: 'james' }
          : boundTask
            ? {
                kind,
                userId: 'james',
                scope: 'task' as const,
                taskId: boundTask,
                ...(sessionId ? { sessionId } : {}),
                ...(maxRisk ? { toolCeiling: { maxRisk } } : {}),
              }
            : {
                kind,
                userId: 'james',
                scope: 'service' as const,
                ...(sessionId ? { sessionId } : {}),
                ...(maxRisk ? { toolCeiling: { maxRisk } } : {}),
              },
      )
      await next()
    })
    app.route('/api/tasks', agentTools)
    app.route('/api/agent-tools', agentToolsCatalog)
  })

  afterEach(() => {
    removeAgentTools(OWNER)
    t.cleanup()
  })

  const get = (path: string, headers?: Record<string, string>) => app.fetch(new Request(`http://acorn.test${path}`, { headers }), {} as Env)
  const post = (path: string, body: unknown, headers?: Record<string, string>) =>
    app.fetch(new Request(`http://acorn.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }), {} as Env)

  it('503s when nothing has contributed a tool', async () => {
    removeAgentTools(OWNER)
    expect((await get('/api/tasks/t1/tools')).status).toBe(503)
    expect((await post('/api/tasks/t1/tools/read_tool', {})).status).toBe(503)
  })

  it('rejects a duplicate tool name rather than letting init order pick the winner', () => {
    expect(() => registerAgentTool('other', FIXTURE[0])).toThrow(/Duplicate agent tool 'read_tool'/)
  })

  // The idempotency the plugin host relies on: a second boot in one process re-registers, and without
  // per-owner removal it would either throw on the duplicate name or leave handlers closed over the
  // first boot's (now closed) database.
  it('replaces an owner’s tools on re-registration instead of appending them', async () => {
    removeAgentTools(OWNER)
    for (const tool of FIXTURE) registerAgentTool(OWNER, tool)
    const catalog = (await (await get('/api/agent-tools')).json()) as { tools: { name: string }[] }
    expect(catalog.tools.map((tool) => tool.name)).toEqual(FIXTURE.map((tool) => tool.name))
  })

  it('manifest lists available tools with JSON schema; dynamic `when` gates a tool per task', async () => {
    await setPerms({ tiers: { execute: true } }) // execute denies by default; this case is about `when`
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

  // An installation that has never opened Settings → Agent tools has no preference row at all, which is
  // the state every installation is in for a tool added by a later release. Execute has to deny there,
  // or shipping a new run-target tool grants it to everyone on upgrade with nothing shown to the owner.
  it('denies the execute tier when the owner has expressed no preference', async () => {
    const manifest = (await (await get('/api/tasks/ready/tools')).json()) as { tools: { name: string }[] }
    expect(manifest.tools.map((tool) => tool.name).sort()).toEqual(['read_tool', 'throws_tool', 'write_tool'])
    expect((await post('/api/tasks/ready/tools/exec_tool', {})).status).toBe(404)
    // The `when` predicate is never reached: a denied tier is decided before availability is asked.
    expect(availabilityCalls).toBe(0)

    // Read and write are the other half of the decision, and they stay allowed with no preference set.
    expect((await post('/api/tasks/ready/tools/read_tool', {})).status).toBe(200)
    expect((await post('/api/tasks/ready/tools/write_tool', { slug: 'x' })).status).toBe(200)

    // Turning the tier on in settings is what makes it reachable, and nothing else.
    await setPerms({ tiers: { execute: true } })
    expect((await post('/api/tasks/ready/tools/exec_tool', {})).status).toBe(200)
  })

  it('sources session identity from the verified principal and carries transport call metadata', async () => {
    const res = await post('/api/tasks/task9/tools/read_tool', {}, {
      'x-test-task': 'task9',
      'x-test-session': 'signed-sess-1',
      'x-acorn-session-id': 'forged-sess-2',
      'x-acorn-tool-call-id': 'call-1',
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: 'ok', task: 'task9' })
    expect(calls[0]).toMatchObject({
      name: 'read_tool',
      taskId: 'task9',
      session: 'signed-sess-1',
      callId: 'call-1',
    })
  })

  it('hides a session-required contribution without a signed session claim', async () => {
    await setPerms({ tiers: { execute: true } })
    const forged = { 'x-acorn-session-id': 'forged-sess' }
    const manifest = (await (await get('/api/tasks/ready/tools', forged)).json()) as { tools: { name: string }[] }
    expect(manifest.tools.map((tool) => tool.name)).not.toContain('orchestration_tool')
    expect((await post('/api/tasks/ready/tools/orchestration_tool', {}, forged)).status).toBe(404)

    const signed = { 'x-test-task': 'ready', 'x-test-session': 'signed-sess' }
    const visible = (await (await get('/api/tasks/ready/tools', signed)).json()) as { tools: { name: string }[] }
    expect(visible.tools.map((tool) => tool.name)).toContain('orchestration_tool')
    expect((await post('/api/tasks/ready/tools/orchestration_tool', {}, signed)).status).toBe(200)
  })

  it('does not expose session-required tools to the same session token on another task', async () => {
    await setPerms({ tiers: { execute: true } })
    const foreign = { 'x-test-task': 'task-one', 'x-test-session': 'signed-sess' }
    expect((await get('/api/tasks/task-two/tools', foreign)).status).toBe(404)
    expect((await post('/api/tasks/task-two/tools/orchestration_tool', {}, foreign)).status).toBe(404)
  })

  it('rejects bad input against the zod schema (400) before the handler', async () => {
    const res = await post('/api/tasks/t1/tools/write_tool', { slug: 123 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as ApiError).error.code).toBe('bad_request')
    expect(calls).toHaveLength(0)
  })

  it('maps a thrown ToolError kind → status + envelope', async () => {
    const res = await post('/api/tasks/t1/tools/throws_tool', {})
    expect(res.status).toBe(404)
    expect(((await res.json()) as ApiError).error).toMatchObject({ code: 'not_found', message: 'nope' })

    const conflict = await post('/api/tasks/t1/tools/throws_tool', { conflict: true })
    expect(conflict.status).toBe(409)
    expect(((await conflict.json()) as ApiError).error).toMatchObject({ code: 'conflict', message: 'busy' })
  })

  it('404s an unknown tool and an unavailable (`when` false) tool alike', async () => {
    expect((await post('/api/tasks/t1/tools/nope', {})).status).toBe(404)
    expect((await post('/api/tasks/t1/tools/exec_tool', {})).status).toBe(404) // when=false for t1
  })

  it('keeps the harness internal-only and renderer-projects only opted-in tools', async () => {
    expect((await get('/api/tasks/t1/tools', { 'x-test-principal': 'device' })).status).toBe(404)
    expect((await post('/api/tasks/t1/renderer-tools/write_tool', { slug: 'x' }, { 'x-test-principal': 'device' })).status).toBe(404)
    expect((await post('/api/tasks/t1/renderer-tools/read_tool', {}, { 'x-test-principal': 'device' })).status).toBe(200)
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

  it('enforces the signed ceiling and treats ACORN_TOOL_CEILING as metadata only', async () => {
    const headers = {
      'x-test-max-risk': 'read',
      // A caller-controlled transport ceiling that permits execute must not widen the signed claim.
      'x-acorn-tool-ceiling': 'eyJtYXhSaXNrIjoiZXhlY3V0ZSJ9',
    }
    const manifest = (await (await get('/api/tasks/ready/tools', headers)).json()) as { tools: { name: string }[] }
    expect(manifest.tools.map((tool) => tool.name).sort()).toEqual(['read_tool', 'throws_tool'])
    expect((await post('/api/tasks/ready/tools/write_tool', { slug: 'x' }, headers)).status).toBe(404)
    expect((await post('/api/tasks/ready/tools/read_tool', {}, headers)).status).toBe(200)
    expect(calls.at(-1)?.toolCeiling).toEqual({ maxRisk: 'read' })

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
        { name: 'orchestration_tool', description: 'requires a signed owner session', risk: 'execute' },
        { name: 'throws_tool', description: 'maps a typed error', risk: 'read' },
      ],
    })
  })
})
