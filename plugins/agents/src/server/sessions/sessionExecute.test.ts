import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestNodeContext, schema, type TestNodeContext } from '@acorn/plugin-api/testkit'
import type { AgentConfigOption, AgentProviderDescriptor } from '@acorn/protocol/managedAgents.ts'
import type { AgentDriver, AgentDriverSession, AgentDriverStartOptions, AgentDriverTurnOptions } from '../drivers/types'
import { AgentDriverRegistry } from '../drivers/registry'
import { ManagedAgentRuntime } from './runtime'
import { createSessionExecute } from './sessionExecute'

// A workflow step's turn (docs/workflows.md § Execution model). The step names the provider options
// it wants and they have to be applied to the session, because the Claude driver takes a switch only
// through `setConfig` and never off the turn.

const advertised = (): AgentConfigOption[] => [
  {
    id: 'model',
    label: 'Model',
    category: 'model',
    currentValue: 'sonnet',
    values: [{ value: 'sonnet', label: 'Sonnet 5' }, { value: 'opus', label: 'Opus 5' }],
  },
  {
    id: 'reasoning',
    label: 'Reasoning effort',
    category: 'reasoning',
    currentValue: 'medium',
    values: [{ value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }],
  },
]

// Registered as the profile `agents.sessionExecute` maps to a managed provider, so the whole path
// runs rather than falling through to the caller's headless fallback.
class ConfigDriver implements AgentDriver {
  readonly providerId = 'claude'
  readonly profileId = 'claude-code'
  readonly configSets: Array<[string, string]> = []
  readonly turns: AgentDriverTurnOptions[] = []

  async probe(): Promise<AgentProviderDescriptor> {
    return {
      id: this.providerId,
      profileId: this.profileId,
      label: 'Config test',
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
    const providerSessionRef = options.session.providerSessionRef ?? `cfg-${randomUUID()}`
    let active = false
    let current = advertised()
    await options.onEvent({ type: 'session_metadata', providerSessionRef, configOptions: current })
    await options.onEvent({ type: 'session_state', state: 'ready' })
    const driver = this
    return {
      providerSessionRef,
      get ready() {
        return !active
      },
      async sendTurn(turn: AgentDriverTurnOptions) {
        active = true
        driver.turns.push(turn)
        await options.onEvent({ type: 'assistant_message', text: 'Done.' })
        await options.onEvent({ type: 'turn_completed', stopReason: 'end_turn' })
        active = false
        return { providerTurnRef: `turn-${turn.turn.id}` }
      },
      async cancel() {
        active = false
      },
      async resolveRequest() {},
      async setConfig(optionId: string, value: string) {
        driver.configSets.push([optionId, value])
        current = current.map((option) => option.id === optionId ? { ...option, currentValue: value } : option)
        return current
      },
      async stop() {},
    }
  }
}

describe('agents.sessionExecute config options', () => {
  let ctx: TestNodeContext
  let runtime: ManagedAgentRuntime
  let driver: ConfigDriver
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
      id: 'project-cfg',
      name: 'cfg',
      path: worktree,
      workspaceId,
      sort: 0,
      hidden: false,
      vcs: 'git',
      defaultBranch: 'main',
      remoteUrl: null,
      githubOwner: 'acorn',
      githubName: 'cfg',
      githubRepoId: null,
      createdAt: at,
      updatedAt: at,
    })
    await ctx.db.insert(schema.tasks).values({
      id: taskId,
      title: 'Config test',
      origin: 'local',
      projectId: 'project-cfg',
      branch: 'test',
      worktreePath: worktree,
      status: 'active',
      createdAt: at,
      updatedAt: at,
    })
    driver = new ConfigDriver()
    const registry = new AgentDriverRegistry()
    registry.registerNative('claude', () => driver)
    runtime = new ManagedAgentRuntime({
      db: ctx.storage.open(),
      dataDir: ctx.dataDir,
      core: ctx.core,
      internalEnv: () => ({}),
      secrets: ctx.env.SECRETS,
      currentUserId: () => null,
      registry,
    })
  })

  afterEach(async () => {
    await runtime.stop()
    ctx.cleanup()
  })

  const execute = (configOptions?: Record<string, string>) => createSessionExecute(runtime)({
    taskId,
    profileId: 'claude-code',
    title: 'Workflow: synthesise',
    prompt: 'Write one answer.',
    configOptions,
    runId: 'run-1',
    stepId: 'step-1',
  })

  it('applies what the provider advertised, and puts the same request on the turn', async () => {
    const result = await execute({ model: 'opus', reasoning: 'high' })
    expect(result?.status).toBe('ok')
    expect(driver.configSets).toEqual([['model', 'opus'], ['reasoning', 'high']])

    const session = await runtime.store.requireSession(result!.agentSessionId!)
    const options = session.config.configOptions as AgentConfigOption[]
    expect(options.map((option) => [option.id, option.currentValue])).toEqual([['model', 'opus'], ['reasoning', 'high']])

    // Codex reads the model and the effort off the turn, so both drivers see the same request.
    const policy = driver.turns[0]!.turn.effectivePolicy
    expect(policy.model).toBe('opus')
    expect(policy.effort).toBe('high')
  })

  it('drops a value the provider does not offer and says so in the transcript', async () => {
    const result = await execute({ model: 'gpt-9', reasoning: 'high' })
    expect(result?.status).toBe('ok')
    expect(driver.configSets).toEqual([['reasoning', 'high']])

    const snapshot = await runtime.store.snapshot(result!.agentSessionId!, 0)
    const warnings = snapshot.events.flatMap((record) =>
      record.event.type === 'diagnostic' && record.event.level === 'warning' ? [record.event.message] : [])
    expect(warnings.join('\n')).toContain('model = gpt-9')
  })

  it('leaves the session alone when the step asks for nothing', async () => {
    const result = await execute()
    expect(result?.status).toBe('ok')
    expect(driver.configSets).toEqual([])
  })
})
