import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestNodeContext, schema, type TestNodeContext } from '@acorn/plugin-api/testkit'
import type { PluginTelemetry, TelemetryRecord } from '@acorn/plugin-api/node'
import { AgentDriverRegistry } from '../drivers/registry'
import { FakeAgentDriver } from '../drivers/fake'
import { ManagedAgentRuntime } from './runtime'

// Starting a provider and running a turn, as spans this plugin raises through `ctx.telemetry`
// (docs/managed-agents.md § What a session reports).

/** The spans this plugin raised, from the testkit's recorder rather than a stand-in for
 *  `ctx.telemetry`: these are the records a sink would receive, built by the real verbs
 *  (docs/plugin-authoring.md § In tests). A span appears once it has ended, and the attributes it
 *  ended with are merged into the ones it opened with. */
const spanNamed = (ctx: TestNodeContext, name: string): Extract<TelemetryRecord, { kind: 'span' }> | undefined =>
  ctx.recorded.find((record): record is Extract<TelemetryRecord, { kind: 'span' }> => record.kind === 'span' && record.name === name)

async function seedTask(ctx: TestNodeContext): Promise<string> {
  const at = Date.now()
  const taskId = randomUUID()
  const workspaceId = randomUUID()
  await ctx.db.insert(schema.workspaces).values({ id: workspaceId, name: 'Test workspace', createdAt: at, updatedAt: at })
  await ctx.db.insert(schema.projects).values({
    id: 'project-telemetry', name: 'telemetry', path: ctx.dataDir, workspaceId, sort: 0, hidden: false,
    vcs: 'git', defaultBranch: 'main', remoteUrl: null, githubOwner: 'acorn', githubName: 'telemetry',
    githubRepoId: null, createdAt: at, updatedAt: at,
  })
  await ctx.db.insert(schema.tasks).values({
    id: taskId, title: 'Telemetry test', origin: 'local', projectId: 'project-telemetry', branch: 'test',
    worktreePath: ctx.dataDir, status: 'active', createdAt: at, updatedAt: at,
  })
  return taskId
}

describe('what a session reports', () => {
  let ctx: TestNodeContext
  let runtime: ManagedAgentRuntime | null

  const build = (registry: AgentDriverRegistry, telemetry?: PluginTelemetry): ManagedAgentRuntime =>
    new ManagedAgentRuntime({
      db: ctx.storage.open(),
      dataDir: ctx.dataDir,
      core: ctx.core,
      internalEnv: () => ({}),
      secrets: ctx.core.secrets,
      currentUserId: () => null,
      registry,
      ...(telemetry ? { telemetry } : {}),
    })

  beforeEach(() => {
    ctx = makeTestNodeContext({ plugin: { name: 'agents' } })
    runtime = null
  })

  afterEach(async () => {
    await runtime?.stop()
    ctx.cleanup()
  })

  it('raises one span for the provider start and one for the turn', async () => {
    const taskId = await seedTask(ctx)
    const registry = new AgentDriverRegistry()
    registry.registerNative('fake', () => new FakeAgentDriver())
    runtime = build(registry, ctx.telemetry)

    const session = await runtime.createSession({ taskId, providerId: 'fake', profileId: 'fake', kind: 'interactive', config: {} })
    await runtime.enqueueTurn(session.id, {
      input: [{ type: 'text', text: 'Go.' }],
      source: 'interactive',
      effectivePolicy: { providerDefault: true },
      idempotencyKey: randomUUID(),
    })
    await runtime.wait(session.id, 0, 'turn_completed', 2_000)

    // The session span covers spawning the provider, not the session's whole life: a session
    // outlives the process, and a span nobody can close is not a measurement.
    const start = spanNamed(ctx, 'agent.session')!
    expect(start.attrs).toMatchObject({ seam: 'agent.session', 'session.id': session.id, provider: 'fake', reconnect: false, owner: 'agents' })
    expect(start.status).toBe('ok')

    const turn = spanNamed(ctx, 'agent.turn')!
    expect(turn.attrs).toMatchObject({ seam: 'agent.turn', 'session.id': session.id, provider: 'fake', source: 'interactive', outcome: 'completed' })
    expect(turn.status).toBe('ok')
  })

  it('marks a provider that will not start as an error', async () => {
    const taskId = await seedTask(ctx)
    const registry = new AgentDriverRegistry()
    registry.registerNative('fake', () => ({
      providerId: 'fake',
      profileId: 'fake',
      probe: async () => new FakeAgentDriver().probe(),
      start: async () => {
        throw new Error('the provider is not installed')
      },
    }))
    runtime = build(registry, ctx.telemetry)

    const accepted = await runtime.acceptSession({ taskId, providerId: 'fake', profileId: 'fake', kind: 'interactive', config: {} })
    await runtime.wait(accepted.id, 0, 'stopped', 2_000)
    expect(spanNamed(ctx, 'agent.session')?.status).toBe('error')
  })

  it('runs with no telemetry, because a test builds an engine with no host around it', async () => {
    const taskId = await seedTask(ctx)
    const registry = new AgentDriverRegistry()
    registry.registerNative('fake', () => new FakeAgentDriver())
    runtime = build(registry)
    const session = await runtime.createSession({ taskId, providerId: 'fake', profileId: 'fake', kind: 'interactive', config: {} })
    await runtime.enqueueTurn(session.id, {
      input: [{ type: 'text', text: 'Go.' }],
      source: 'interactive',
      effectivePolicy: { providerDefault: true },
      idempotencyKey: randomUUID(),
    })
    expect((await runtime.wait(session.id, 0, 'turn_completed', 2_000)).session.runtimeState).toBe('ready')
  })
})
