import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestNodeContext, type AppEnv, type TestNodeContext } from '@acorn/plugin-api/testkit'
import type { AgentSessionSnapshot } from '../../contract/wire'
import { FakeAgentDriver } from '../drivers/fake'
import { AgentDriverRegistry } from '../drivers/registry'
import { ManagedAgentRuntime } from '../sessions/runtime'
import { managedAgents, setManagedAgentsBridge } from './managed'
import { managedAgentsBridge } from './managedBridge'

describe('the session routes while the startup cleanup runs', () => {
  let ctx: TestNodeContext
  let runtime: ManagedAgentRuntime
  let app: Hono<AppEnv>
  let sessionId: string

  beforeEach(async () => {
    ctx = makeTestNodeContext({ plugin: { name: 'agents' } })
    runtime = new ManagedAgentRuntime({
      db: ctx.storage.open(),
      dataDir: ctx.dataDir,
      core: ctx.core,
      internalEnv: () => ({}),
      secrets: ctx.env.SECRETS,
      currentUserId: () => null,
      registry: new AgentDriverRegistry(),
    })
    app = new Hono<AppEnv>()
    app.use('*', async (c, next) => {
      c.set('principal', { kind: 'device', userId: 'owner' } as never)
      await next()
    })
    app.route('/api', managedAgents)
    // A session the last process left mid-turn, so the cleanup has one to stop.
    const session = await runtime.store.createSession(
      { taskId: randomUUID(), providerId: 'fake', profileId: 'fake', kind: 'interactive', config: {} },
      await new FakeAgentDriver().probe(),
    )
    const { turn } = await runtime.store.enqueueTurn(session.id, {
      input: [{ type: 'text', text: 'Keep going' }],
      source: 'interactive',
      effectivePolicy: {},
      idempotencyKey: randomUUID(),
    })
    await runtime.store.startTurn(turn.id)
    sessionId = session.id
  })
  afterEach(async () => {
    setManagedAgentsBridge(null)
    await runtime.stop()
    ctx.cleanup()
    vi.restoreAllMocks()
  })

  it('answers a read between steps and holds a write until the cleanup ends', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    vi.spyOn(runtime.attachments, 'collectGarbage').mockImplementation(async () => {
      await held
      return 0
    })
    const steps: string[] = []
    const reconciled = runtime.reconcile((step) => steps.push(step))
    setManagedAgentsBridge(managedAgentsBridge(runtime, undefined, reconciled))
    await vi.waitFor(() => expect(steps).toContain('followups'))

    const read = await app.request(`/api/sessions/${sessionId}`)
    expect(read.status).toBe(200)
    expect(((await read.json()) as AgentSessionSnapshot).session.runtimeState).toBe('stopped')

    let answered = false
    const write = Promise.resolve(
      app.request(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Renamed' }),
      }),
    ).then((response) => ((answered = true), response))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(answered).toBe(false)
    expect((await runtime.store.requireSession(sessionId)).title).not.toBe('Renamed')

    release()
    await reconciled
    expect((await write).status).toBe(200)
    expect((await runtime.store.requireSession(sessionId)).title).toBe('Renamed')
  })

  it('gives the event loop a turn after each step', async () => {
    const order: string[] = []
    await runtime.reconcile((step) => {
      order.push(step)
      setImmediate(() => order.push(`after ${step}`))
    })
    for (const step of ['unsettled', 'subagents', 'steering', 'commands', 'background', 'followups']) {
      expect(order[order.indexOf(step) + 1]).toBe(`after ${step}`)
    }
  })
})
