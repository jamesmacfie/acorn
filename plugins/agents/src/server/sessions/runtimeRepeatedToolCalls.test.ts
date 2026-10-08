import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestNodeContext, schema, type TestNodeContext } from '@acorn/plugin-api/testkit'
import type { PluginNotice } from '@acorn/protocol/notices.ts'
import type { AgentProviderDescriptor, AgentToolCall } from '../../contract/wire.ts'
import type { AgentDriver, AgentDriverSession, AgentDriverStartOptions } from '../drivers/types'
import { AgentDriverRegistry } from '../drivers/registry'
import { defaultAgentSessionDefaults } from '../../shared/sessionDefaults'
import { writeAgentSessionDefaults } from '../sessionDefaultsStore'
import { ManagedAgentRuntime } from './runtime'

// The repeated tool call warning (docs/managed-agents/repeated-tool-calls.md), driven
// through the runtime so the setting, the transcript line, and the bell row are checked together.

const OWNER = 'owner'

/** Each turn reports the calls in `calls`, then completes. */
class RepeatingDriver implements AgentDriver {
  readonly providerId = 'repeat-test'
  readonly profileId = 'repeat-test'
  calls: AgentToolCall[] = []

  async probe(): Promise<AgentProviderDescriptor> {
    return {
      id: this.providerId, profileId: this.profileId, label: 'Repeat test', driverKind: 'acp',
      driverVersion: 'test-1', installed: true, authenticated: true, statusAuthority: 'protocol',
      capabilities: ['streaming_messages'], configOptions: [], commands: [], skills: [], diagnostics: [],
    }
  }

  async start(options: AgentDriverStartOptions): Promise<AgentDriverSession> {
    await options.onEvent({ type: 'session_metadata', providerSessionRef: randomUUID() })
    await options.onEvent({ type: 'session_state', state: 'ready' })
    let active = false
    return {
      providerSessionRef: randomUUID(),
      get ready() { return !active },
      sendTurn: async () => {
        active = true
        for (const tool of this.calls) await options.onEvent({ type: 'tool', tool })
        await options.onEvent({ type: 'turn_completed', stopReason: 'end_turn' })
        active = false
        return {}
      },
      async cancel() {},
      async resolveRequest() {},
      async stop() {},
    }
  }
}

const bash = (count: number, command = 'gh pr checks'): AgentToolCall[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `call-${index}-${randomUUID()}`, title: command, kind: 'execute', status: 'completed', input: command,
  }))

describe('warning about repeated tool calls', () => {
  let ctx: TestNodeContext
  let runtime: ManagedAgentRuntime
  let driver: RepeatingDriver
  let notices: PluginNotice[]
  let taskId: string

  beforeEach(async () => {
    ctx = makeTestNodeContext({ plugin: { name: 'agents' } })
    const worktree = join(ctx.dataDir, 'worktree')
    await mkdir(worktree)
    const at = Date.now()
    const workspaceId = randomUUID()
    taskId = randomUUID()
    await ctx.db.insert(schema.workspaces).values({ id: workspaceId, name: 'W', createdAt: at, updatedAt: at })
    await ctx.db.insert(schema.projects).values({
      id: 'project-repeat', name: 'repeat', path: worktree, workspaceId, sort: 0, hidden: false, vcs: 'git',
      defaultBranch: 'main', remoteUrl: null, githubOwner: 'acorn', githubName: 'repeat', githubRepoId: null,
      createdAt: at, updatedAt: at,
    })
    await ctx.db.insert(schema.tasks).values({
      id: taskId, title: 'Repeat test', origin: 'local', projectId: 'project-repeat', branch: 'test',
      worktreePath: worktree, status: 'active', createdAt: at, updatedAt: at,
    })
    driver = new RepeatingDriver()
    notices = []
    const registry = new AgentDriverRegistry()
    registry.registerNative(driver.providerId, () => driver)
    runtime = new ManagedAgentRuntime({
      db: ctx.storage.open(),
      dataDir: ctx.dataDir,
      core: ctx.core,
      internalEnv: () => ({}),
      secrets: ctx.env.SECRETS,
      currentUserId: () => OWNER,
      registry,
      notice: (notice) => notices.push(notice),
    })
  })

  afterEach(async () => {
    await runtime.stop()
    ctx.cleanup()
  })

  const runTurn = async () => {
    const session = await runtime.createSession({
      taskId, providerId: driver.providerId, profileId: driver.profileId, kind: 'interactive', config: {},
    })
    await runtime.enqueueTurn(session.id, {
      input: [{ type: 'text', text: 'Wait for CI.' }], source: 'interactive', effectivePolicy: {}, idempotencyKey: randomUUID(),
    })
    await vi.waitFor(async () => expect((await runtime.store.snapshot(session.id)).turns.every((turn) =>
      !['queued', 'dispatching', 'active'].includes(turn.status))).toBe(true))
    const { events } = await runtime.store.snapshot(session.id)
    return {
      // Titled from the first prompt by now.
      session: await runtime.store.requireSession(session.id),
      warnings: events.flatMap((record) =>
        record.event.type === 'diagnostic' && record.event.message.includes('times in a row') ? [record.event.message] : []),
    }
  }

  it('warns once, at the third identical call, in the transcript and the bell', async () => {
    driver.calls = bash(6)
    const { session, warnings } = await runTurn()
    expect(warnings).toEqual([
      'The agent has run “gh pr checks” 3 times in a row with the same input. It may be stuck. If it isn\'t making progress, stop the turn.',
    ])
    expect(notices).toEqual([{
      taskId,
      title: 'An agent may be stuck',
      detail: `“${session.title}” has made the same tool call 3 times in a row.`,
      target: { kind: 'managed-agent', resourceId: session.id },
    }])
  })

  it('says nothing when the calls differ', async () => {
    driver.calls = [...bash(2), ...bash(1, 'git status'), ...bash(2)]
    expect((await runTurn()).warnings).toEqual([])
    expect(notices).toEqual([])
  })

  it('follows the owner\'s setting, including off', async () => {
    await writeAgentSessionDefaults(ctx.core.prefs, OWNER, { ...defaultAgentSessionDefaults(), warnRepeatedToolCallsAfter: 5 })
    driver.calls = bash(4)
    expect((await runTurn()).warnings).toEqual([])
    driver.calls = bash(5)
    expect((await runTurn()).warnings).toHaveLength(1)

    await writeAgentSessionDefaults(ctx.core.prefs, OWNER, { ...defaultAgentSessionDefaults(), warnRepeatedToolCallsAfter: 0 })
    driver.calls = bash(12)
    expect((await runTurn()).warnings).toEqual([])
    expect(notices).toHaveLength(1)
  })
})
