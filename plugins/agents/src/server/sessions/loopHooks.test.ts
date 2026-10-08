import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureAcornMcp } from '@acorn/plugin-api/node'
import { makeTestNodeContext, type TestNodeContext } from '@acorn/plugin-api/testkit'
import { AFTER_TOOL_HOOK, BEFORE_TOOL_HOOK, LOOP_HOOK_VERSION, type AgentAfterToolPayload, type AgentLoopHookRequest } from '../../contract/loopHook.ts'
import { CLAUDE_HOOK_INPUT } from '../drivers/__fixtures__/claudeHookInput'
import { AgentDriverRegistry } from '../drivers/registry'
import { FakeAgentDriver } from '../drivers/fake'
import type { AgentDriverSession, AgentDriverStartOptions } from '../drivers/types'
import { ManagedAgentRuntime } from './runtime'

// A bridge call through the real hook chain: agents declares both loop points, a second plugin context
// handles them, and the call arrives the way the route hands it over, for the token's task and session.

const FORCE_PUSH = { ...CLAUDE_HOOK_INPUT.bashPre, tool_input: { command: 'git push --force' } }
const pre = (input: unknown = FORCE_PUSH): AgentLoopHookRequest => ({ version: LOOP_HOOK_VERSION, harness: 'claude', event: 'PreToolUse', input })
const decision = (output: string) => (output ? JSON.parse(output).hookSpecificOutput : null)

describe('harness bridge calls', () => {
  let agents: TestNodeContext
  let policy: TestNodeContext
  let runtime: ManagedAgentRuntime
  let starts: AgentDriverStartOptions[]

  beforeEach(() => {
    agents = makeTestNodeContext({ plugin: { name: 'agents' } })
    policy = makeTestNodeContext({ plugin: { name: 'policy' } })
    agents.hooks.declare(BEFORE_TOOL_HOOK)
    agents.hooks.declare(AFTER_TOOL_HOOK)
    configureAcornMcp('acorn-dev', { command: '/app/node', args: ['/app/helper/mcp.js'], env: {} })
    vi.spyOn(agents.core.tasks, 'requireRoot').mockResolvedValue('/work/task')
    vi.spyOn(agents.core.tasks, 'workspaceId').mockResolvedValue('workspace')
    starts = []
    const registry = new AgentDriverRegistry()
    registry.registerNative('fake', () => ({
      providerId: 'fake',
      profileId: 'fake',
      loopHooks: true,
      probe: () => new FakeAgentDriver().probe(),
      start: async (start): Promise<AgentDriverSession> => {
        starts.push(start)
        await start.onEvent({ type: 'session_state', state: 'ready' })
        return {
          providerSessionRef: start.session.id, ready: true,
          // The turn stays active, as it does while the harness waits on its own hook.
          sendTurn: async () => ({}),
          cancel: async () => {}, resolveRequest: async () => { throw new Error('the harness parked nothing') }, stop: async () => {},
        }
      },
    }))
    runtime = new ManagedAgentRuntime({
      db: agents.storage.open(), dataDir: agents.dataDir, core: agents.core, registry, hooks: agents.hooks,
      internalEnv: () => ({}), secrets: agents.env.SECRETS, currentUserId: () => 'owner',
    })
  })
  afterEach(async () => { await runtime.stop(); policy.cleanup(); agents.cleanup(); vi.restoreAllMocks() })

  const start = async (posture?: 'autonomous') => {
    const session = await runtime.store.createSession({
      taskId: randomUUID(), providerId: 'fake', profileId: 'fake', kind: posture ? 'workflow' : 'interactive', config: {},
    }, await new FakeAgentDriver().probe(), posture)
    await runtime.enqueueTurn(session.id, {
      input: [{ type: 'text', text: 'Push it.' }], source: 'interactive', effectivePolicy: {}, idempotencyKey: randomUUID(),
    })
    await vi.waitFor(() => expect(starts).toHaveLength(1))
    return { session, caller: { taskId: session.taskId, sessionId: session.id } }
  }
  const handle = (point: string, mode: 'veto' | 'ask' | 'transform', run: (payload: Record<string, unknown>) => Promise<unknown>) =>
    policy.hooks.handle(`agents:${point}`, { id: `${point}-${mode}`, mode, run })

  it('installs no bridge and answers nothing when no plugin handles a point', async () => {
    const { caller } = await start()
    expect(starts[0]!.loopHooks).toBeUndefined()
    await expect(runtime.loopHook(caller, pre())).resolves.toEqual({ version: LOOP_HOOK_VERSION, output: '' })
  })

  it('installs only the handled point and denies a veto with its reason, for the model to read', async () => {
    const seen: Record<string, unknown>[] = []
    handle(BEFORE_TOOL_HOOK.id, 'veto', async (payload) => { seen.push(payload); return { ok: false, reason: 'No force-push.' } })
    const { session, caller } = await start()
    expect(starts[0]!.loopHooks).toEqual({
      command: '/app/node', args: ['/app/helper/loop-hook.js', '/v1/p/agents/loop-hook', 'agents.loopHook.v1'], beforeTool: true, afterTool: false,
    })

    const reply = await runtime.loopHook(caller, pre())
    expect(decision(reply.output)).toEqual({
      hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Blocked by policy: No force-push.',
    })
    // The same subject and the same tool call id the permission hook would see for this call.
    expect(seen).toEqual([{
      sessionId: session.id, taskId: session.taskId, providerId: 'fake', unattended: false, root: '/work/task',
      toolCallId: 'toolu_01QWwwWDsrhnC1af97vgWNB8', toolName: 'Bash', kind: 'command', title: 'git push --force',
      command: 'git push --force', paths: [],
    }])
  })

  it('answers nothing for a session the token does not own', async () => {
    const run = vi.fn(async () => ({ ok: false, reason: 'no' }))
    handle(BEFORE_TOOL_HOOK.id, 'veto', run)
    const { session } = await start()
    await expect(runtime.loopHook({ taskId: randomUUID(), sessionId: session.id }, pre())).resolves.toMatchObject({ output: '' })
    await expect(runtime.loopHook({ taskId: session.taskId, sessionId: randomUUID() }, pre())).resolves.toMatchObject({ output: '' })
    expect(run).not.toHaveBeenCalled()
  })

  it('holds an ask on a card naming the plugin: a refusal denies, an approval is no decision', async () => {
    handle(BEFORE_TOOL_HOOK.id, 'ask', async () => ({ ask: true, reason: 'This pushes to a remote.' }))
    const { session, caller } = await start()
    const pending = async () => {
      const requests = (await runtime.store.snapshot(session.id)).requests.filter((request) => request.status === 'pending')
      expect(requests).toHaveLength(1)
      return requests[0]!
    }

    const refused = runtime.loopHook(caller, pre())
    const card = await vi.waitFor(pending)
    expect(card).toMatchObject({ kind: 'permission', title: 'git push --force', detail: 'policy wants you to decide: This pushes to a remote.' })
    await runtime.resolveRequest(session.id, card.providerRequestId, { optionId: 'reject' }, randomUUID())
    expect(decision((await refused).output)).toMatchObject({
      permissionDecision: 'deny', permissionDecisionReason: 'The person refused this when policy asked them: This pushes to a remote.',
    })

    const allowed = runtime.loopHook(caller, pre())
    const second = await vi.waitFor(pending)
    await runtime.resolveRequest(session.id, second.providerRequestId, { optionId: 'allow' }, randomUUID())
    // No decision, so the harness's own permission checks still run. Never an allow.
    await expect(allowed).resolves.toEqual({ version: LOOP_HOOK_VERSION, output: '' })
    expect(await runtime.store.request(session.id, second.providerRequestId)).toMatchObject({ status: 'resolved' })
  })

  it('denies an autonomous plugin ask immediately without publishing a request', async () => {
    handle(BEFORE_TOOL_HOOK.id, 'ask', async () => ({ ask: true, reason: 'Confirm this push.' }));
    const { session, caller } = await start('autonomous');
    const response = await runtime.loopHook(caller, pre());
    expect(decision(response.output)).toMatchObject({ permissionDecision: 'deny', permissionDecisionReason: expect.stringContaining('This run is unattended') });
    const snapshot = await runtime.store.snapshot(session.id);
    expect(snapshot.requests).toEqual([]);
    expect(snapshot.session.attention).not.toBe('permission');
  });

  it('leaves the call to the harness when a handler throws or stalls', async () => {
    handle(BEFORE_TOOL_HOOK.id, 'veto', async () => { throw new Error('broken') })
    const { caller } = await start()
    await expect(runtime.loopHook(caller, pre())).resolves.toMatchObject({ output: '' })
  })

  it('hands the model a bounded after-tool note beside the result', async () => {
    handle(AFTER_TOOL_HOOK.id, 'transform', async (payload) => ({ payload: { ...payload, note: `  Write the test first.${'x'.repeat(5_000)}` } }))
    const { caller } = await start()
    expect(starts[0]!.loopHooks).toMatchObject({ beforeTool: false, afterTool: true })
    const reply = await runtime.loopHook(caller, { version: LOOP_HOOK_VERSION, harness: 'claude', event: 'PostToolUse', input: CLAUDE_HOOK_INPUT.writePost })
    const context = decision(reply.output).additionalContext as string
    expect(context.startsWith('Write the test first.')).toBe(true)
    expect(context).toHaveLength(4_096)
  })

  it('passes the payload an after-tool handler is declared with', async () => {
    const seen: AgentAfterToolPayload[] = []
    handle(AFTER_TOOL_HOOK.id, 'transform', async (payload) => { seen.push(payload as AgentAfterToolPayload); return { payload } })
    const { caller } = await start()
    await expect(runtime.loopHook(caller, { version: LOOP_HOOK_VERSION, harness: 'claude', event: 'PostToolUse', input: CLAUDE_HOOK_INPUT.writePost }))
      .resolves.toMatchObject({ output: '' })
    expect(seen[0]).toMatchObject({ toolName: 'Write', kind: 'edit', succeeded: true, note: '', paths: ['/private/tmp/p10-probe/claude-cwd/notes.txt'] })
  })
})
