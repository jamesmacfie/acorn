import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestNodeContext, schema, type TestNodeContext } from '@acorn/plugin-api/testkit'
import { agentProfileRegistry, type ToolContext } from '@acorn/plugin-api/node'
import type { AgentConfigOption, AgentProviderDescriptor, AgentSession } from '../../contract/wire.ts'
import type { AgentDriver, AgentDriverSession, AgentDriverStartOptions } from '../drivers/types'
import { AgentDriverRegistry } from '../drivers/registry'
import { claudeCodeProfile } from '../profiles/claudeCode'
import { ManagedAgentRuntime } from '../sessions/runtime'
import { defaultAgentSessionDefaults } from '../../shared/sessionDefaults'
import { writeAgentSessionDefaults } from '../sessionDefaultsStore'
import { AgentDelegationService } from './service'
import { AgentDelegationStore } from './store'

// A delegated child runs no wider than its parent (docs/managed-agents/delegation.md § Execution
// policy). The fake harness reports Claude Code's mode, so the real runtime reads, applies, and checks
// it the way it does for a real one.

const option = (id: string, category: AgentConfigOption['category'], currentValue: string, values: string[]) => ({
  id,
  label: id,
  category,
  currentValue,
  values: values.map((value) => ({ value, label: value })),
})

class PolicyDriver implements AgentDriver {
  readonly providerId = 'claude'
  readonly profileId = 'claude-code'
  // The mode each session starts in, as the harness's own settings choose it. Undefined reports none.
  startMode: (session: AgentSession) => string | undefined = () => 'default'
  readonly sent: string[] = []

  async probe(): Promise<AgentProviderDescriptor> {
    return {
      id: this.providerId,
      profileId: this.profileId,
      label: 'Policy test',
      driverKind: 'acp',
      driverVersion: 'test-1',
      installed: true,
      authenticated: true,
      statusAuthority: 'protocol',
      capabilities: ['streaming_messages'],
      configOptions: [],
      commands: [],
      skills: [],
      diagnostics: [],
    }
  }

  async start(options: AgentDriverStartOptions): Promise<AgentDriverSession> {
    const mode = this.startMode(options.session)
    let current: AgentConfigOption[] = [
      ...(mode ? [option('mode', 'mode', mode, ['default', 'acceptEdits', 'auto', 'bypassPermissions'])] : []),
      option('model', 'model', 'sonnet', ['sonnet', 'opus']),
      option('reasoning', 'reasoning', 'medium', ['medium', 'high']),
    ]
    await options.onEvent({ type: 'session_metadata', providerSessionRef: options.session.id, configOptions: current })
    await options.onEvent({ type: 'session_state', state: 'ready' })
    const sent = this.sent
    let active = false
    return {
      providerSessionRef: options.session.id,
      get ready() {
        return !active
      },
      async sendTurn({ turn }) {
        active = true
        sent.push(turn.id)
        await options.onEvent({ type: 'assistant_message', text: 'Done.' })
        await options.onEvent({ type: 'turn_completed', stopReason: 'end_turn' })
        active = false
        return { providerTurnRef: turn.id }
      },
      async cancel() {
        active = false
      },
      async resolveRequest() {},
      async setConfig(optionId: string, value: string) {
        current = current.map((entry) => (entry.id === optionId ? { ...entry, currentValue: value } : entry))
        return current
      },
      async stop() {},
    }
  }
}

describe('delegation keeps the parent’s execution policy', () => {
  let ctx: TestNodeContext
  let runtime: ManagedAgentRuntime
  let driver: PolicyDriver
  let service: AgentDelegationService
  let taskId: string
  let releaseProfile: () => void

  beforeEach(async () => {
    releaseProfile = agentProfileRegistry.register(claudeCodeProfile)
    ctx = makeTestNodeContext({ plugin: { name: 'agents' } })
    const worktree = join(ctx.dataDir, 'worktree')
    await mkdir(worktree)
    const at = Date.now()
    const workspaceId = randomUUID()
    taskId = randomUUID()
    await ctx.db.insert(schema.workspaces).values({ id: workspaceId, name: 'W', createdAt: at, updatedAt: at })
    await ctx.db.insert(schema.projects).values({
      id: 'project-policy',
      name: 'policy',
      path: worktree,
      workspaceId,
      sort: 0,
      hidden: false,
      vcs: 'git',
      defaultBranch: 'main',
      remoteUrl: null,
      githubOwner: 'acorn',
      githubName: 'policy',
      githubRepoId: null,
      createdAt: at,
      updatedAt: at,
    })
    await ctx.db.insert(schema.tasks).values({
      id: taskId,
      title: 'Policy test',
      origin: 'local',
      projectId: 'project-policy',
      branch: 'test',
      worktreePath: worktree,
      status: 'active',
      createdAt: at,
      updatedAt: at,
    })
    driver = new PolicyDriver()
    const registry = new AgentDriverRegistry()
    registry.registerNative('claude', () => driver)
    runtime = new ManagedAgentRuntime({
      db: ctx.storage.open(),
      dataDir: ctx.dataDir,
      core: ctx.core,
      internalEnv: () => ({}),
      secrets: ctx.env.SECRETS,
      currentUserId: () => 'owner',
      registry,
    })
    service = new AgentDelegationService(runtime, new AgentDelegationStore(ctx.storage.open()), async () => [])
  })

  afterEach(async () => {
    await runtime.stop()
    releaseProfile()
    ctx.cleanup()
  })

  /** A parent session in `mode`, with children starting in `childMode` unless a test changes it. */
  const parentIn = async (mode: string, childMode = mode) => {
    driver.startMode = (session) => (session.kind === 'delegated' ? childMode : mode)
    const parent = await runtime.createSession({
      taskId,
      providerId: 'claude',
      profileId: 'claude-code',
      title: 'Parent',
      kind: 'interactive',
      config: {},
    })
    await vi.waitFor(async () => expect((await runtime.store.requireSession(parent.id)).runtimeState).toBe('ready'))
    return parent
  }

  const caller = (parent: AgentSession, callId: string): ToolContext => ({
    taskId,
    sessionId: parent.id,
    callId,
    userLogin: 'owner',
    toolCeiling: { allow: ['agent_spawn', 'agent_prompt'], maxRisk: 'execute' },
  })

  const settled = async (turnId: string) => {
    await vi.waitFor(
      async () => expect(['completed', 'failed']).toContain((await runtime.store.turn(turnId))?.status),
      { timeout: 5_000 },
    )
    return (await runtime.store.turn(turnId))!
  }

  const optionValue = async (sessionId: string, id: string) =>
    ((await runtime.store.requireSession(sessionId)).config.configOptions as AgentConfigOption[]).find(
      (entry) => entry.id === id,
    )?.currentValue

  const childTurns = async (sessionId: string) => (await runtime.store.snapshot(sessionId, 0)).turns

  it('refuses a spawn that asks for a wider mode, and queues no child', async () => {
    const parent = await parentIn('default')
    await expect(
      service.spawn(
        { title: 'Child', prompt: 'Run it.', isolation: 'shared', configOptions: { mode: 'bypassPermissions' } },
        caller(parent, 'wider-spawn'),
      ),
    ).rejects.toMatchObject({ kind: 'bad_request' })
    const sessions = await runtime.store.listSessions({ taskId })
    expect(sessions.sessions.map((session) => session.id)).toEqual([parent.id])
    expect(driver.sent).toEqual([])
  })

  it('applies the model and reasoning a spawn asks for, and runs the turn', async () => {
    const parent = await parentIn('auto', 'default')
    const result = await service.spawn(
      {
        title: 'Child',
        prompt: 'Run it.',
        isolation: 'shared',
        configOptions: { model: 'opus', reasoning: 'high' },
      },
      caller(parent, 'eligible-spawn'),
    )
    expect((await settled(result.turnId!)).status).toBe('completed')
    expect(driver.sent).toEqual([result.turnId])
    expect(await optionValue(result.sessionId!, 'model')).toBe('opus')
    expect(await optionValue(result.sessionId!, 'reasoning')).toBe('high')
    expect((await runtime.store.requireSession(result.sessionId!)).config.executionCeiling).toBe(2)
  })

  it('sends no turn to a child that starts wider than its parent', async () => {
    const parent = await parentIn('default', 'bypassPermissions')
    const result = await service.spawn(
      { title: 'Child', prompt: 'Run it.', isolation: 'shared' },
      caller(parent, 'wide-start'),
    )
    const turn = await settled(result.turnId!)
    expect(turn.status).toBe('failed')
    expect(turn.error?.message).toContain('wider permissions than the agent that started it')
    expect(driver.sent).toEqual([])
  })

  it('sends no turn to a child whose harness reports no mode', async () => {
    const parent = await parentIn('default')
    driver.startMode = (session) => (session.kind === 'delegated' ? undefined : 'default')
    const result = await service.spawn(
      { title: 'Child', prompt: 'Run it.', isolation: 'shared' },
      caller(parent, 'no-mode'),
    )
    const turn = await settled(result.turnId!)
    expect(turn.status).toBe('failed')
    expect(turn.error?.message).toContain("doesn't report a permission mode")
    expect(driver.sent).toEqual([])
  })

  it('lets the owner’s own spawn default run a child wider than its parent', async () => {
    await writeAgentSessionDefaults(ctx.core.prefs, 'owner', {
      ...defaultAgentSessionDefaults(),
      spawned: { mode: 'explicit', profileId: null, pinned: { claude: { mode: 'auto' } } },
    })
    const parent = await parentIn('default')
    const result = await service.spawn(
      { title: 'Child', prompt: 'Run it.', isolation: 'shared' },
      caller(parent, 'owner-default'),
    )
    expect((await settled(result.turnId!)).status).toBe('completed')
    expect(await optionValue(result.sessionId!, 'mode')).toBe('auto')
  })

  it('refuses a prompt that asks for a wider mode or reaches a widened child, and queues no turn', async () => {
    const parent = await parentIn('auto', 'default')
    const spawned = await service.spawn(
      { title: 'Child', prompt: 'Run it.', isolation: 'shared' },
      caller(parent, 'spawn'),
    )
    await settled(spawned.turnId!)
    const childId = spawned.sessionId!

    await expect(
      service.prompt(
        { sessionId: childId, prompt: 'Again.', configOptions: { mode: 'bypassPermissions' } },
        caller(parent, 'wider-prompt'),
      ),
    ).rejects.toMatchObject({ kind: 'bad_request' })
    expect(await optionValue(childId, 'mode')).toBe('default')
    expect(await childTurns(childId)).toHaveLength(1)

    const eligible = await service.prompt(
      { sessionId: childId, prompt: 'Think harder.', configOptions: { model: 'opus', reasoning: 'high' } },
      caller(parent, 'eligible-prompt'),
    )
    expect((await settled(eligible.turnId)).status).toBe('completed')
    expect(await optionValue(childId, 'model')).toBe('opus')
    expect(await optionValue(childId, 'reasoning')).toBe('high')

    // Widened by some other route, such as a person, the child takes no further delegated turn.
    const child = await runtime.store.requireSession(childId)
    await runtime.patchSession(childId, {
      config: {
        ...child.config,
        configOptions: (child.config.configOptions as AgentConfigOption[]).map((entry) =>
          entry.id === 'mode' ? { ...entry, currentValue: 'bypassPermissions' } : entry,
        ),
      },
    })
    await expect(
      service.prompt({ sessionId: childId, prompt: 'Once more.' }, caller(parent, 'widened-child')),
    ).rejects.toMatchObject({ kind: 'conflict' })
    expect(await childTurns(childId)).toHaveLength(2)
    expect(driver.sent).toEqual([spawned.turnId, eligible.turnId])
  })
})
