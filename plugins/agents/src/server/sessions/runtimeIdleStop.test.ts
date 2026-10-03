import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestNodeContext, schema, type TestNodeContext } from '@acorn/plugin-api/testkit'
import type { AgentNormalizedEvent, AgentProviderDescriptor } from '../../contract/wire.ts'
import type { AgentDriver, AgentDriverSession, AgentDriverStartOptions } from '../drivers/types'
import { AgentDriverRegistry } from '../drivers/registry'
import { defaultAgentSessionDefaults } from '../../shared/sessionDefaults'
import { writeAgentConcurrency } from '../concurrencyStore'
import { writeAgentSessionDefaults } from '../sessionDefaultsStore'
import { ManagedAgentRuntime } from './runtime'

// The idle sweep (docs/managed-agents/operations.md § Operations and failure). Each case calls the sweep with a
// clock past the limit rather than waiting for its timer, except the one that checks the timer itself.

const MINUTE = 60_000
const OWNER = 'owner'

type TurnPlan = 'complete' | 'hold' | 'background' | 'fail'

/** One instance serves every session, so a case can ask which sessions it stopped and what each start
 *  resumed. `plan` says what the next turn does. */
class IdleDriver implements AgentDriver {
  readonly providerId = 'idle-test'
  readonly profileId = 'idle-test'
  readonly starts: AgentDriverStartOptions[] = []
  readonly stopped: string[] = []
  readonly emitters = new Map<string, AgentDriverStartOptions['onEvent']>()
  readonly pids = new Map<string, number>()
  plan: TurnPlan = 'complete'

  async probe(): Promise<AgentProviderDescriptor> {
    return {
      id: this.providerId,
      profileId: this.profileId,
      label: 'Idle test',
      driverKind: 'acp',
      driverVersion: 'test-1',
      installed: true,
      authenticated: true,
      statusAuthority: 'protocol',
      capabilities: ['streaming_messages', 'resume'],
      configOptions: [],
      commands: [],
      skills: [],
      diagnostics: [],
    }
  }

  async start(options: AgentDriverStartOptions): Promise<AgentDriverSession> {
    this.starts.push(options)
    this.emitters.set(options.session.id, options.onEvent)
    const providerSessionRef = options.session.providerSessionRef ?? randomUUID()
    let active = false
    let release: ((error: Error) => void) | null = null
    await options.onEvent({ type: 'session_metadata', providerSessionRef })
    await options.onEvent({ type: 'session_state', state: 'ready' })
    // A process id per start, which the footprint case walks a fake process table from.
    const pid = 1000 + this.starts.length
    this.pids.set(options.session.id, pid)
    return {
      providerSessionRef,
      pid,
      get ready() {
        return !active
      },
      sendTurn: async () => {
        active = true
        const plan = this.plan
        if (plan === 'hold') await new Promise<never>((_, reject) => { release = reject })
        if (plan === 'fail') {
          await options.onEvent({ type: 'error', code: 'test_turn_failed', message: 'The model call failed.', retryable: false })
          active = false
          throw new Error('The model call failed.')
        }
        if (plan === 'background') {
          await options.onEvent({
            type: 'subagent',
            subagent: { id: 'sub-bg', title: 'Watch the build', status: 'running', background: true },
          })
        }
        await options.onEvent({ type: 'assistant_message', text: 'Done.' })
        await options.onEvent({ type: 'turn_completed', stopReason: 'end_turn' })
        active = false
        return {}
      },
      async cancel() {},
      async resolveRequest() {},
      stop: async () => {
        this.stopped.push(options.session.id)
        release?.(new Error('Agent protocol process stopped.'))
      },
    }
  }

  async push(sessionId: string, event: AgentNormalizedEvent): Promise<void> {
    await this.emitters.get(sessionId)?.(event)
  }
}

describe('stopping idle provider processes', () => {
  let ctx: TestNodeContext
  let runtime: ManagedAgentRuntime
  let driver: IdleDriver
  let taskId: string

  const build = (options: { idleSweepMs?: number } = {}) => {
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
      ...options,
    })
  }

  beforeEach(async () => {
    ctx = makeTestNodeContext({ plugin: { name: 'agents' } })
    const worktree = join(ctx.dataDir, 'worktree')
    await mkdir(worktree)
    const at = Date.now()
    const workspaceId = randomUUID()
    taskId = randomUUID()
    await ctx.db.insert(schema.workspaces).values({ id: workspaceId, name: 'W', createdAt: at, updatedAt: at })
    await ctx.db.insert(schema.projects).values({
      id: 'project-idle',
      name: 'idle',
      path: worktree,
      workspaceId,
      sort: 0,
      hidden: false,
      vcs: 'git',
      defaultBranch: 'main',
      remoteUrl: null,
      githubOwner: 'acorn',
      githubName: 'idle',
      githubRepoId: null,
      createdAt: at,
      updatedAt: at,
    })
    await ctx.db.insert(schema.tasks).values({
      id: taskId,
      title: 'Idle test',
      origin: 'local',
      projectId: 'project-idle',
      branch: 'test',
      worktreePath: worktree,
      status: 'active',
      createdAt: at,
      updatedAt: at,
    })
    driver = new IdleDriver()
    build()
  })

  afterEach(async () => {
    vi.useRealTimers()
    await runtime.stop()
    ctx.cleanup()
  })

  const open = () => runtime.createSession({
    taskId,
    providerId: driver.providerId,
    profileId: driver.profileId,
    kind: 'interactive',
    config: {},
  })
  const prompt = (sessionId: string, text = 'Do the thing.') => runtime.enqueueTurn(sessionId, {
    input: [{ type: 'text', text }],
    source: 'interactive',
    effectivePolicy: {},
    idempotencyKey: randomUUID(),
  })
  const settle = async (sessionId: string) => {
    await vi.waitFor(async () => expect((await runtime.store.snapshot(sessionId)).turns.every((turn) =>
      !['queued', 'dispatching', 'active'].includes(turn.status))).toBe(true))
  }
  const idleSession = async () => {
    const session = await open()
    await prompt(session.id)
    await settle(session.id)
    return session
  }
  const later = (minutes: number) => Date.now() + minutes * MINUTE

  it('stops a session idle past the limit, and a later prompt resumes the same conversation', async () => {
    const session = await idleSession()
    const before = await runtime.store.requireSession(session.id)

    // Under the default 30 minutes nothing happens.
    expect(await runtime.stopIdleSessions(later(20))).toEqual([])
    expect(driver.stopped).toEqual([])

    expect(await runtime.stopIdleSessions(later(31))).toEqual([session.id])
    expect(driver.stopped).toEqual([session.id])
    const stopped = await runtime.store.snapshot(session.id)
    expect(stopped.session.runtimeState).toBe('stopped')
    // Resumable, not failed: the attention the finished turn left is untouched.
    expect(stopped.session.attention).toBe(before.attention)
    expect(stopped.events.at(-1)?.event).toEqual({
      type: 'session_state',
      state: 'stopped',
      detail: 'The provider process stopped after 30 minutes idle to free memory. Send a prompt to resume.',
    })

    const startsBefore = driver.starts.length
    const resumed = await prompt(session.id, 'Carry on.')
    await settle(session.id)
    expect(driver.starts.slice(startsBefore).map((start) => start.session.id)).toEqual([session.id])
    expect(driver.starts.at(-1)!.session.providerSessionRef).toBe(before.providerSessionRef)
    expect((await runtime.store.turn(resumed.id))?.status).toBe('completed')
    expect((await runtime.store.requireSession(session.id)).runtimeState).toBe('ready')
  })

  it('measures idleness from the last provider event, not from the start', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const session = await idleSession()
    vi.setSystemTime(later(25))
    // Traffic with no turn, the way a harness can stream after its prompt call returned.
    await driver.push(session.id, { type: 'diagnostic', level: 'info', message: 'Still here.' })

    // 40 minutes after the start, 15 after the last event.
    expect(await runtime.stopIdleSessions(later(15))).toEqual([])
    expect(await runtime.stopIdleSessions(later(31))).toEqual([session.id])
  })

  it('skips a session with a turn in flight or a turn queued', async () => {
    await writeAgentConcurrency(ctx.core.prefs, OWNER, { provider: 1, workspace: 3 })
    const working = await open()
    const waiting = await open()
    driver.plan = 'hold'
    const held = await prompt(working.id)
    await vi.waitFor(async () => expect((await runtime.store.turn(held.id))?.status).toBe('active'))
    // The one provider slot is taken, so this turn stays queued on a session that is otherwise idle.
    const queued = await prompt(waiting.id)
    await vi.waitFor(async () => expect((await runtime.store.requireSession(waiting.id)).queuedTurns).toBe(1))

    expect(await runtime.stopIdleSessions(later(31))).toEqual([])
    expect(driver.stopped).toEqual([])
    expect((await runtime.store.turn(queued.id))?.status).toBe('queued')
  })

  it('skips a session with a request the owner has not answered', async () => {
    const session = await idleSession()
    await driver.push(session.id, {
      type: 'request',
      requestId: 'permission-1',
      kind: 'permission',
      title: 'Run the test command?',
      options: [{ id: 'allow-once', label: 'Allow once', kind: 'allow_once' }],
    })
    await vi.waitFor(async () => expect(await runtime.store.pendingRequests(session.id)).toHaveLength(1))

    expect(await runtime.stopIdleSessions(later(31))).toEqual([])
    expect(driver.stopped).toEqual([])
  })

  it('skips a session whose background subagent is still running', async () => {
    driver.plan = 'background'
    const session = await idleSession()
    expect((await runtime.store.requireSession(session.id)).subagents.map((entry) => entry.status)).toEqual(['running'])

    expect(await runtime.stopIdleSessions(later(31))).toEqual([])
    expect(driver.stopped).toEqual([])
  })

  it('stops a failed session without hiding the failure', async () => {
    driver.plan = 'fail'
    const session = await idleSession()
    expect((await runtime.store.requireSession(session.id)).runtimeState).toBe('failed')

    expect(await runtime.stopIdleSessions(later(31))).toEqual([session.id])
    expect(driver.stopped).toEqual([session.id])
    const after = await runtime.store.snapshot(session.id)
    expect(after.session.runtimeState).toBe('failed')
    expect(after.events.some((record) => record.event.type === 'session_state' && record.event.state === 'stopped')).toBe(false)
  })

  it('reads the limit at sweep time, and Never keeps every process', async () => {
    const session = await idleSession()
    await writeAgentSessionDefaults(ctx.core.prefs, OWNER, { ...defaultAgentSessionDefaults(), stopIdleAfterMinutes: 0 })
    expect(await runtime.stopIdleSessions(later(24 * 60))).toEqual([])

    await writeAgentSessionDefaults(ctx.core.prefs, OWNER, { ...defaultAgentSessionDefaults(), stopIdleAfterMinutes: 15 })
    expect(await runtime.stopIdleSessions(later(16))).toEqual([session.id])
    expect((await runtime.store.snapshot(session.id)).events.at(-1)?.event).toMatchObject({
      detail: 'The provider process stopped after 15 minutes idle to free memory. Send a prompt to resume.',
    })
  })

  it('sweeps on its own timer once a provider has started', async () => {
    await runtime.stop()
    build({ idleSweepMs: 20 })
    vi.useFakeTimers({ toFake: ['Date'] })
    const session = await idleSession()
    vi.setSystemTime(later(31))

    await vi.waitFor(() => expect(driver.stopped).toEqual([session.id]))
    expect((await runtime.store.requireSession(session.id)).runtimeState).toBe('stopped')
  })

  it('stops every idle session now when asked, whatever the limit, and leaves a busy one', async () => {
    await writeAgentSessionDefaults(ctx.core.prefs, OWNER, { ...defaultAgentSessionDefaults(), stopIdleAfterMinutes: 0 })
    const idle = await idleSession()
    const busy = await open()
    driver.plan = 'hold'
    const held = await prompt(busy.id)
    await vi.waitFor(async () => expect((await runtime.store.turn(held.id))?.status).toBe('active'))

    expect(await runtime.stopIdleSessionsNow()).toEqual([idle.id])
    expect(driver.stopped).toEqual([idle.id])
    expect((await runtime.store.snapshot(idle.id)).events.at(-1)?.event).toEqual({
      type: 'session_state',
      state: 'stopped',
      detail: 'The provider process was stopped from Settings to free memory. Send a prompt to resume.',
    })
  })

  it('counts running and idle sessions and sums each process tree', async () => {
    const idle = await idleSession()
    const busy = await open()
    driver.plan = 'hold'
    const held = await prompt(busy.id)
    await vi.waitFor(async () => expect((await runtime.store.turn(held.id))?.status).toBe('active'))
    const idlePid = driver.pids.get(idle.id)!
    const busyPid = driver.pids.get(busy.id)!
    // Each provider has an MCP server under it, and one of those has a child of its own. The node and
    // an unrelated process are not counted.
    const table = [
      { pid: 1, ppid: 0, rssBytes: 999 },
      { pid: idlePid, ppid: 1, rssBytes: 100 },
      { pid: 2001, ppid: idlePid, rssBytes: 10 },
      { pid: 2002, ppid: 2001, rssBytes: 1 },
      { pid: busyPid, ppid: 1, rssBytes: 200 },
      { pid: 3001, ppid: busyPid, rssBytes: 20 },
    ]

    expect(await runtime.processFootprint(async () => table)).toEqual({ live: 2, idle: 1, memoryBytes: 331 })
    // Where the node cannot list processes, the counts stand and memory is unknown.
    expect(await runtime.processFootprint(async () => null)).toEqual({ live: 2, idle: 1, memoryBytes: null })
  })
})
