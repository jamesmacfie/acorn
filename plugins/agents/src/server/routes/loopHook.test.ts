import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppEnv, Env } from '@acorn/plugin-api/testkit'
import { LOOP_HOOK_VERSION } from '../../contract/loopHook.ts'
import { agentLoopHooks, setAgentLoopHooksBridge } from './loopHook'

const as = (principal: Record<string, unknown> | null) => {
  const app = new Hono<AppEnv>()
  app.use('/api/*', async (c, next) => {
    c.set('principal', principal as never)
    await next()
  })
  return app.route('/api/agents', agentLoopHooks)
}
const post = (app: Hono<AppEnv>, body: unknown) =>
  app.fetch(
    new Request('http://acorn.test/api/agents/loop-hook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    {} as Env,
  )

const call = { version: LOOP_HOOK_VERSION, harness: 'claude', event: 'PreToolUse', input: { tool_name: 'Bash' } }
// An agent session's own ACORN_API_TOKEN, which names its task and its session.
const agent = { kind: 'internal', userId: 'james', scope: 'task', taskId: 'task1', sessionId: 'session1' }

describe('the bridge ingress', () => {
  afterEach(() => setAgentLoopHooksBridge(null))

  it('answers for the session the token names, never one the body names', async () => {
    const callers: unknown[] = []
    setAgentLoopHooksBridge({
      answer: async (caller) => {
        callers.push(caller)
        return { version: LOOP_HOOK_VERSION, output: 'deny' }
      },
      coverage: async () => ({ harnesses: [] }),
    })
    const response = await post(as(agent), { ...call, sessionId: 'someone-else' })
    expect(await response.json()).toEqual({ version: LOOP_HOOK_VERSION, output: 'deny' })
    expect(callers).toEqual([{ taskId: 'task1', sessionId: 'session1' }])
  })

  it('gives no decision to a device, a token with no session, or a body it does not recognise', async () => {
    const callers: unknown[] = []
    setAgentLoopHooksBridge({
      answer: async (caller) => {
        callers.push(caller)
        return { version: LOOP_HOOK_VERSION, output: 'deny' }
      },
      coverage: async () => ({ harnesses: [] }),
    })
    const none = { version: LOOP_HOOK_VERSION, output: '' }
    expect(await (await post(as({ kind: 'device', userId: 'james' }), call)).json()).toEqual(none)
    expect(await (await post(as({ ...agent, sessionId: undefined }), call)).json()).toEqual(none)
    expect(await (await post(as(agent), { ...call, harness: 'codex' })).json()).toEqual(none)
    expect(await (await post(as(agent), { ...call, version: 'agents.loopHook.v2' })).json()).toEqual(none)
    expect(callers).toEqual([])
  })

  it('shows coverage to a device only', async () => {
    setAgentLoopHooksBridge({
      answer: async () => ({ version: LOOP_HOOK_VERSION, output: '' }),
      coverage: async () => ({ harnesses: [{ label: 'Claude Code', beforeTool: 'every', afterTool: true }] }),
    })
    const read = (principal: Record<string, unknown>) =>
      as(principal).fetch(new Request('http://acorn.test/api/agents/loop-coverage/policy'), {} as Env)
    expect((await read(agent)).status).toBe(403)
    expect(await (await read({ kind: 'device', userId: 'james' })).json()).toEqual({
      harnesses: [{ label: 'Claude Code', beforeTool: 'every', afterTool: true }],
    })
  })
})
