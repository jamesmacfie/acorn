import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createApp } from '../index'
import { makeTestDb, testEnv, type TestDb } from '../../testkit/db'
import { mintInternalToken } from '../auth/internalTokens'
import { schema } from '../db'
import { clearHooks, registerHookHandler } from '../pluginHost/hooks'
import { buildAgentTools } from './coreTools'
import { registerAgentTool, removeAgentTools, TOOL_PERMS_PREF_KEY, type ToolContext } from './registry'
import { runScript, SCRIPT_LIMITS } from './runScript'

describe('the interpreter', () => {
  const defaults = { ...SCRIPT_LIMITS }
  afterEach(() => Object.assign(SCRIPT_LIMITS, defaults))

  // Answers every call with its own name and input, and records what the runner passed it.
  const seen: { name: string; callId?: string; signal: AbortSignal }[] = []
  const context = (callTool?: ToolContext['callTool']): ToolContext => ({
    taskId: 't',
    userLogin: 'u',
    callId: 'outer',
    callTool:
      callTool ??
      (async (name, input, call) => {
        seen.push({ name, ...call })
        return { ok: true, value: { name, input } }
      }),
  })
  const hang: ToolContext['callTool'] = (name, _input, call) => {
    seen.push({ name, ...call })
    return new Promise(() => {})
  }
  beforeEach(() => void (seen.length = 0))

  it('runs tool calls side by side and returns the result, logs, and calls', async () => {
    const result = await runScript(
      'const [a, b] = await Promise.all([tools.one({ x: 1 }), tools.two()])\nconsole.log("got", a.name, { b })\nreturn [a, b]',
      context(),
    )
    expect(result).toEqual({
      ok: true,
      value: [
        { name: 'one', input: { x: 1 } },
        { name: 'two', input: {} },
      ],
      logs: ['got one {"b":{"name":"two","input":{}}}'],
      calls: [
        { tool: 'one', ok: true },
        { tool: 'two', ok: true },
      ],
    })
    expect(seen.map((call) => call.callId)).toEqual(['outer:1', 'outer:2'])
  })

  it('reaches nothing outside the engine', async () => {
    const result = await runScript(
      `const global = Function('return this')()
      let imported
      try { await import('node:fs'); imported = 'loaded' } catch (error) { imported = String(error) }
      return {
        globals: [typeof process, typeof require, typeof fetch, typeof setTimeout, typeof global.process, typeof eval('this').process],
        imported,
      }`,
      context(),
    )
    expect(result).toMatchObject({ ok: true, value: { globals: Array(6).fill('undefined') } })
    expect((result as { value: { imported: string } }).value.imported).toMatch(/could not load module/)
  })

  it('hands the program JSON copies, so changing them never reaches the host', async () => {
    const host = { nested: { value: 1 } }
    const result = await runScript(
      'const copy = await tools.read({})\ncopy.nested.value = 2\ncopy.__proto__.polluted = true\nObject.prototype.polluted = true\nreturn copy.nested.value',
      context(async () => ({ ok: true, value: host })),
    )
    expect(result).toMatchObject({ ok: true, value: 2 })
    expect(host.nested.value).toBe(1)
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined()
  })

  it('reports a thrown error and a syntax error with the line in the program', async () => {
    expect(await runScript('const a = 1\n\nthrow new TypeError("boom")', context())).toMatchObject({
      ok: false,
      error: { message: 'TypeError: boom', line: 3 },
    })
    expect(await runScript('const a = 1\nconst b = (', context())).toMatchObject({
      ok: false,
      error: { message: expect.stringMatching(/^SyntaxError: /), line: 2 },
    })
  })

  it('throws a refused call into the program, which can catch it', async () => {
    const result = await runScript(
      'try { await tools.nope({}) } catch (error) { return error.message }',
      context(async () => ({ ok: false, status: 404, error: 'not_found' })),
    )
    expect(result).toMatchObject({
      ok: true,
      value: 'nope: not_found',
      calls: [{ tool: 'nope', ok: false, error: 'not_found' }],
    })
  })

  it('stops a busy program at the time limit', async () => {
    SCRIPT_LIMITS.timeMs = 200
    const result = await runScript('await tools.first({})\nwhile (true) {}', context())
    expect(result).toMatchObject({
      ok: false,
      error: { message: 'The program stopped. It ran past the 0.2-second limit.' },
      calls: [{ tool: 'first', ok: true }],
    })
  })

  it('stops a program that runs JavaScript too long, counting only the engine', async () => {
    SCRIPT_LIMITS.engineMs = 100
    const slow: ToolContext['callTool'] = (name) =>
      new Promise((resolve) => setTimeout(() => resolve({ ok: true, value: name }), 150))
    expect(await runScript('return await tools.slow({})', context(slow))).toMatchObject({ ok: true, value: 'slow' })
    const started = Date.now()
    expect(await runScript('while (true) {}', context())).toMatchObject({
      ok: false,
      error: { message: 'The program stopped. It ran JavaScript for more than 0.1 seconds.' },
    })
    expect(Date.now() - started).toBeLessThan(1_000)
    for (const thrown of ['{ toJSON() { while (true) {} } }', '{ get message() { while (true) {} } }']) {
      expect(await runScript(`throw ${thrown}`, context())).toMatchObject({
        ok: false,
        error: { message: 'The program stopped. It ran JavaScript for more than 0.1 seconds.' },
      })
    }
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  it('stops waiting on a host call at the time limit and aborts it', async () => {
    SCRIPT_LIMITS.timeMs = 200
    const result = await runScript('return await tools.slow({})', context(hang))
    expect(result).toMatchObject({
      ok: false,
      error: { message: 'The program stopped. It ran past the 0.2-second limit.' },
      calls: [{ tool: 'slow', ok: false, error: 'cancelled' }],
    })
    expect(seen[0].signal.aborted).toBe(true)
  })

  it('cancels the program and its calls when the outer call is cancelled', async () => {
    const outer = new AbortController()
    // Cancels once the call has started; a fixed delay can fire before a slow machine reaches it.
    const hangThenCancel: ToolContext['callTool'] = (name, input, call) => {
      setTimeout(() => outer.abort())
      return hang(name, input, call)
    }
    const running = runScript('return await tools.slow({})', { ...context(hangThenCancel), signal: outer.signal })
    expect(await running).toMatchObject({
      ok: false,
      error: { message: 'The program stopped. The call was cancelled.' },
    })
    expect(seen[0].signal.aborted).toBe(true)
  })

  it('refuses the call past the limit and lists the calls already made', async () => {
    const result = await runScript('for (let i = 0; i < 60; i++) await tools.ping({ i })', context())
    expect(result).toMatchObject({ ok: false, error: { message: 'Error: run_script allows 50 tool calls.' } })
    expect(result.calls).toHaveLength(50)
  })

  it('stops a program at its memory limit', async () => {
    const result = await runScript('const all = []\nwhile (true) all.push(new Array(100000).fill(1))', context())
    expect(result).toMatchObject({ ok: false, error: { message: expect.stringMatching(/out of memory/) } })
  })

  it('fails deep recursion as an error, and survives a value too deep for the host stack', async () => {
    expect(await runScript('const f = () => f()\nf()', context())).toMatchObject({
      ok: false,
      error: { message: expect.stringMatching(/stack overflow/) },
    })
    expect(
      await runScript('let o = {}\nfor (let i = 0; i < 200000; i++) o = { o }\nreturn o', context()),
    ).toMatchObject({ ok: false, error: { message: expect.stringMatching(/^The interpreter failed: /) } })
    expect(await runScript('return 1', context())).toMatchObject({ ok: true, value: 1 })
  })

  it('fails a program that waits on a promise nothing will settle', async () => {
    expect(await runScript('await new Promise(() => {})', context())).toMatchObject({
      ok: false,
      error: { message: 'The program is waiting on a promise that nothing will settle.' },
    })
  })

  it('caps the logs', async () => {
    SCRIPT_LIMITS.logChars = 10
    const result = await runScript('for (let i = 0; i < 5; i++) console.log("abcd")', context())
    expect(result.logs).toEqual(['abcd', 'abcd', '[acorn dropped the rest of the logs]'])
  })
})

// Through the real app, route, token, and registry: an inner call passes every gate a direct call does.
describe('run_script through the Node', () => {
  const key = 'run-script-test-key'
  const writes: string[] = []
  let db: TestDb
  const app = createApp()

  beforeEach(() => {
    writes.length = 0
    db = makeTestDb()
    const runScriptTool = buildAgentTools({ db: db.db, secrets: db.secrets }).find(
      (tool) => tool.name === 'run_script',
    )!
    registerAgentTool('core', runScriptTool)
    registerAgentTool('probe', {
      name: 'probe_read',
      description: 'reads',
      input: z.object({}),
      scope: 'task',
      risk: 'read',
      handler: async (_input, ctx) => ({ callId: ctx.callId }),
    })
    registerAgentTool('probe', {
      name: 'probe_other',
      description: 'reads too',
      input: z.object({}),
      scope: 'task',
      risk: 'read',
      handler: async () => ({ read: true }),
    })
    registerAgentTool('probe', {
      name: 'probe_write',
      description: 'writes',
      input: z.object({ text: z.string() }),
      scope: 'task',
      risk: 'write',
      handler: async (input) => {
        writes.push((input as { text: string }).text)
        return { written: true }
      },
    })
  })
  afterEach(() => {
    removeAgentTools('core')
    removeAgentTools('probe')
    clearHooks('approver')
    db.cleanup()
  })

  const env = () =>
    testEnv({ DB: db.db, INTERNAL_TOKEN: key, ACTIVE_IDENTITY: { get: () => 'owner', set: () => {}, clear: () => {} } })
  const headers = (claims: Partial<Parameters<typeof mintInternalToken>[1]> = {}) => ({
    'content-type': 'application/json',
    'x-acorn-tool-call-id': 'outer',
    'x-acorn-internal': mintInternalToken(key, { scope: 'task', taskId: 'own', ...claims }),
  })
  const run = async (code: string, claims?: Partial<Parameters<typeof mintInternalToken>[1]>) => {
    const response = await app.request(
      '/v1/core/tasks/own/tools/run_script',
      { method: 'POST', headers: headers(claims), body: JSON.stringify({ code }) },
      env(),
    )
    return { status: response.status, body: (await response.json()) as Record<string, unknown> }
  }
  // Each call's outcome as the program saw it.
  const tryEach = (...calls: string[]) =>
    `const tryCall = async (name, input) => { try { await tools[name](input); return 'ok' } catch (error) { return error.message } }
return [${calls.map((call) => `await tryCall(${call})`).join(', ')}]`
  const BOTH = tryEach(`'probe_read', {}`, `'probe_other', {}`)

  it('is listed with its input schema', async () => {
    const response = await app.request('/v1/core/tasks/own/tools', { headers: headers() }, env())
    const { tools } = (await response.json()) as { tools: { name: string; risk: string; inputSchema: unknown }[] }
    expect(tools.find((tool) => tool.name === 'run_script')).toMatchObject({
      risk: 'read',
      inputSchema: { properties: { code: { type: 'string', maxLength: 20_000 } }, required: ['code'] },
    })
  })

  it('runs inner calls with numbered call ids', async () => {
    const { status, body } = await run('return [await tools.probe_read({}), await tools.probe_read({})]')
    expect(status).toBe(200)
    expect(body).toMatchObject({ ok: true, value: [{ callId: 'outer:1' }, { callId: 'outer:2' }] })
  })

  it('refuses an inner call to a tool switched off in permissions', async () => {
    db.db
      .insert(schema.prefs)
      .values({ userId: 'owner', key: TOOL_PERMS_PREF_KEY, value: JSON.stringify({ tools: { probe_other: false } }) })
      .run()
    const { body } = await run(BOTH)
    expect(body).toMatchObject({
      ok: true,
      value: ['ok', 'probe_other: not_found'],
      calls: [
        { tool: 'probe_read', ok: true },
        { tool: 'probe_other', ok: false, error: 'not_found' },
      ],
    })
  })

  // A harness asks the person about a write by its name, and inside a script it would see only run_script.
  it('refuses every write call, even when the write tier is on', async () => {
    const { body } = await run(tryEach(`'probe_write', { text: 'hi' }`))
    expect(body).toMatchObject({ ok: true, value: ['probe_write: not_found'] })
    expect(writes).toEqual([])
  })

  it("keeps a workflow step's allow list for inner calls", async () => {
    const { body } = await run(BOTH, { toolCeiling: { allow: ['run_script', 'probe_read'] } })
    expect(body).toMatchObject({ ok: true, value: ['ok', 'probe_other: not_found'] })
  })

  it('lets a before-tool-call veto stop an inner call', async () => {
    registerHookHandler({
      id: 'approver:gate',
      pluginId: 'approver',
      point: 'core:before-tool-call',
      mode: 'veto',
      priority: 500,
      call: async (payload) => (payload.tool === 'probe_other' ? { ok: false, reason: 'not that one' } : { ok: true }),
    })
    const { body } = await run(BOTH)
    expect(body).toMatchObject({ ok: true, value: ['ok', 'probe_other: needs-trust (approver: not that one)'] })
  })

  it('treats run_script as missing from inside a program', async () => {
    const { body } = await run(
      `try { await tools.run_script({ code: 'return 1' }) } catch (error) { return error.message }`,
    )
    expect(body).toMatchObject({ ok: true, value: 'run_script: not_found' })
  })

  it('refuses a program over 20,000 characters', async () => {
    expect((await run(`return ${'1'.repeat(20_000)}`)).status).toBe(400)
  })
})
