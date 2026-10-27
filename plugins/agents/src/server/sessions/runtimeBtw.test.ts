import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestNodeContext, type TestNodeContext } from '@acorn/plugin-api/testkit'
import type { AgentConfigOption } from '../../contract/wire.ts'
import { AgentDriverRegistry } from '../drivers/registry'
import { FakeAgentDriver } from '../drivers/fake'
import { managedAgentsBridge } from '../routes/managedBridge'
import { ManagedAgentRuntime } from './runtime'
import { ManagedAgentEngine, type AgentRuntimeOptions } from './runtimeEngine'

const modeOption: AgentConfigOption = {
  id: 'mode',
  label: 'Mode',
  category: 'mode',
  currentValue: 'default',
  values: [
    { value: 'default', label: 'Default' },
    { value: 'plan', label: 'Plan' },
  ],
}

describe('a side question beside a running session', () => {
  let ctx: TestNodeContext
  let runtime: ManagedAgentRuntime
  let driver: FakeAgentDriver

  beforeEach(() => {
    ctx = makeTestNodeContext({ plugin: { name: 'agents' } })
    vi.spyOn(ctx.core.tasks, 'requireRoot').mockResolvedValue(ctx.dataDir)
    vi.spyOn(ctx.core.tasks, 'workspaceId').mockResolvedValue('workspace')
    driver = new FakeAgentDriver({ holdTurns: true })
    const registry = new AgentDriverRegistry()
    registry.registerNative('fake', () => driver)
    const options: AgentRuntimeOptions = {
      db: ctx.storage.open(),
      dataDir: ctx.dataDir,
      core: ctx.core,
      registry,
      internalEnv: () => ({}),
      secrets: ctx.env.SECRETS,
      currentUserId: () => null,
    }
    runtime = new ManagedAgentRuntime(options, new ManagedAgentEngine(options))
  })
  afterEach(async () => {
    driver.finishTurns()
    await runtime.stop()
    ctx.cleanup()
    vi.restoreAllMocks()
  })

  // A source whose first turn is running and held open, with a second message queued behind it.
  const running = async () => {
    const source = await runtime.store.createSession(
      {
        taskId: randomUUID(),
        providerId: 'fake',
        profileId: 'fake',
        kind: 'interactive',
        title: 'Migrate the billing tables',
        config: { configOptions: [modeOption], requestedConfigOptions: { mode: 'default' } },
      },
      await driver.probe(),
    )
    const enqueue = (text: string) =>
      runtime.enqueueTurn(source.id, {
        input: [{ type: 'text', text }],
        source: 'interactive',
        effectivePolicy: {},
        idempotencyKey: randomUUID(),
      })
    const first = await enqueue('Run the long migration')
    await vi.waitFor(async () => expect((await runtime.store.turn(first.id))?.status).toBe('active'))
    await vi.waitFor(async () =>
      expect((await runtime.store.snapshot(source.id)).events.some((record) => record.turnId === first.id)).toBe(true),
    )
    const queued = await enqueue('Then update the docs')
    return { source, first, queued }
  }

  it('starts mid-turn from a copy of the transcript and leaves the source alone', async () => {
    const { source, first, queued } = await running()
    const before = await runtime.store.snapshot(source.id)

    const side = await runtime.btw(source.id, { mode: 'plan' })

    expect(side).toMatchObject({
      taskId: source.taskId,
      providerId: 'fake',
      kind: 'interactive',
      title: 'Side question: Migrate the billing tables',
      parentSessionId: source.id,
      origin: { kind: 'btw', sourceSessionId: source.id },
    })
    // The origin survives a fresh read of the row.
    expect((await runtime.store.requireSession(side.id)).origin).toEqual({ kind: 'btw', sourceSessionId: source.id })
    const copy = side.config.pendingForkContext as { label: string; content: string }
    expect(copy.label).toBe('History copied from Migrate the billing tables')
    expect(copy.content).toContain('Run the long migration')
    expect(copy.content).toContain(`Fake response for ${first.id}`)
    expect(side.config).toMatchObject({ forkKind: 'acorn-context-copy', forkSourceSessionId: source.id })

    // The source's turn is still running, its queue still holds the next message, and nothing new was
    // written to its transcript.
    expect((await runtime.store.turn(first.id))?.status).toBe('active')
    expect((await runtime.store.turn(queued.id))?.status).toBe('queued')
    expect((await runtime.store.requireSession(source.id)).queuedTurns).toBe(1)
    expect((await runtime.store.snapshot(source.id)).events).toEqual(before.events)

    // The caller's options replace the source's and are applied once the harness is ready.
    expect(side.config.requestedConfigOptions).toEqual({ mode: 'plan' })
    await vi.waitFor(async () => {
      const options = (await runtime.store.requireSession(side.id)).config.configOptions as AgentConfigOption[]
      expect(options.find((option) => option.id === 'mode')?.currentValue).toBe('plan')
    })
  })

  it("doesn't carry the source's requested options when the caller sends none", async () => {
    const { source } = await running()
    const side = await runtime.btw(source.id)
    expect(side.config.requestedConfigOptions).toBeUndefined()
  })

  it('answers 404 for an unknown source', async () => {
    await expect(managedAgentsBridge(runtime).btw(randomUUID())).rejects.toMatchObject({ status: 404 })
  })
})
