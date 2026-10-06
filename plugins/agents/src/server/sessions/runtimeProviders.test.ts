import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestNodeContext, type TestNodeContext } from '@acorn/plugin-api/testkit'
import type { AgentProviderDescriptor } from '../../contract/wire.ts'
import { AgentDriverRegistry } from '../drivers/registry'
import { FakeAgentDriver } from '../drivers/fake'
import { ManagedAgentRuntime } from './runtime'

// The providers answer is served from memory and probed again behind the caller once it is old
// (runtimeEngine.ts § providers). A probe starts CLI binaries, which is why the pane must not wait on one.

/** A fake whose probes are counted and answered by hand, so a case can hold one open. */
class CountedDriver extends FakeAgentDriver {
  readonly pending: ((descriptor: AgentProviderDescriptor) => void)[] = []
  installed = true

  override async probe(): Promise<AgentProviderDescriptor> {
    const descriptor = { ...(await super.probe()), installed: this.installed }
    return new Promise((resolve) => this.pending.push(() => resolve(descriptor)))
  }

  /** Answer every probe waiting so far. */
  answer(): void {
    for (const resolve of this.pending.splice(0)) resolve(undefined as never)
  }
}

describe('the providers answer', () => {
  let ctx: TestNodeContext
  let runtime: ManagedAgentRuntime
  let driver: CountedDriver
  let registry: AgentDriverRegistry

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    ctx = makeTestNodeContext({ plugin: { name: 'agents' } })
    driver = new CountedDriver()
    registry = new AgentDriverRegistry()
    registry.registerNative('fake', () => driver)
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
    ctx.cleanup()
    vi.useRealTimers()
  })

  /** One read, answered, for a case that needs a cached answer to start from. */
  const warm = async (): Promise<AgentProviderDescriptor[]> => {
    const read = runtime.providers()
    await vi.waitFor(() => expect(driver.pending).toHaveLength(1))
    driver.answer()
    return read
  }

  it('waits for the first probe and shares it between callers', async () => {
    const first = runtime.providers()
    const second = runtime.providers()
    await vi.waitFor(() => expect(driver.pending).toHaveLength(1))
    driver.answer()
    expect(await first).toBe(await second)
    expect(driver.pending).toHaveLength(0)
  })

  it('answers a second call inside the window without probing', async () => {
    const answered = await warm()
    vi.advanceTimersByTime(10_000)
    expect(await runtime.providers()).toBe(answered)
    expect(driver.pending).toHaveLength(0)
  })

  it('exposes newly advertised model and effort choices without repeating the cached availability probe', async () => {
    const descriptors = await warm()
    const olderOptions = [{ id: 'model', label: 'Model', category: 'model' as const, currentValue: 'old', values: [] }]
    const latestOptions = [
      { id: 'model', label: 'Model', category: 'model' as const, currentValue: 'new', values: [{ value: 'new', label: 'New' }] },
      { id: 'reasoning', label: 'Effort', category: 'reasoning' as const, currentValue: 'high', values: [{ value: 'high', label: 'High' }] },
    ]
    const makeSession = (configOptions: typeof latestOptions) => runtime.store.createSession({
      taskId: 'task-options', providerId: 'fake', profileId: 'fake', kind: 'interactive', config: { configOptions },
    }, descriptors[0]!)
    const older = await makeSession(olderOptions)
    const latest = await makeSession(latestOptions)
    const connecting = await makeSession([])
    vi.spyOn(runtime.store, 'listSessions').mockResolvedValue({ sessions: [connecting, latest, older], delegations: [], nextCursor: null })

    expect((await runtime.providers())[0]?.configOptions).toEqual(latestOptions)
    expect(driver.pending).toHaveLength(0)
    expect(descriptors[0]?.configOptions).toEqual([])
  })

  it('answers a stale call with the old answer while one probe refreshes it', async () => {
    const old = await warm()
    driver.installed = false
    vi.advanceTimersByTime(60_000)
    // Served at once, although the only probe that could answer is still open.
    expect(await runtime.providers()).toBe(old)
    expect(await runtime.providers()).toBe(old)
    await vi.waitFor(() => expect(driver.pending).toHaveLength(1))
    driver.answer()
    await vi.waitFor(async () => expect((await runtime.providers())[0]?.installed).toBe(false))
    expect(driver.pending).toHaveLength(0)
  })

  it('blocks on a fresh probe when forced', async () => {
    await warm()
    driver.installed = false
    let settled = false
    const forced = runtime.providers(true).then((answer) => { settled = true; return answer })
    await vi.waitFor(() => expect(driver.pending).toHaveLength(1))
    expect(settled).toBe(false)
    driver.answer()
    expect((await forced)[0]?.installed).toBe(false)
  })

  it('probes again at once when a harness is added or removed', async () => {
    await warm()
    const release = registry.registerNative('second', () => new FakeAgentDriver())
    const read = runtime.providers()
    await vi.waitFor(() => expect(driver.pending).toHaveLength(1))
    driver.answer()
    expect(await read).toHaveLength(2)
    release()
  })

  it('invalidates same-ID replacement and does not join or cache its superseded wave', async () => {
    const old = runtime.providers()
    await vi.waitFor(() => expect(driver.pending).toHaveLength(1))
    registry.clear()
    const replacement = new CountedDriver()
    replacement.installed = false
    registry.registerNative('fake', () => replacement)
    const fresh = runtime.providers()
    await vi.waitFor(() => expect(replacement.pending).toHaveLength(1))
    replacement.answer()
    const descriptors = await fresh
    expect(descriptors[0]?.installed).toBe(false)
    driver.answer()
    expect((await old)[0]?.installed).toBe(true)
    expect(await runtime.providers()).toBe(descriptors)
  })

  it('only caches the latest forced wave when both start in the same millisecond', async () => {
    const timestamp = Date.now()
    const old = runtime.providers(true)
    await vi.waitFor(() => expect(driver.pending).toHaveLength(1))
    driver.installed = false
    vi.setSystemTime(timestamp)
    const fresh = runtime.providers(true)
    await vi.waitFor(() => expect(driver.pending).toHaveLength(2))
    const first = driver.pending.shift()!, second = driver.pending.shift()!
    second(undefined as never)
    const descriptors = await fresh
    first(undefined as never)
    expect((await old)[0]?.installed).toBe(true)
    expect(await runtime.providers()).toBe(descriptors)
    expect(descriptors[0]?.installed).toBe(false)
  })

  it('does not restore discovery after shutdown with a probe still pending', async () => {
    const pending = runtime.providers()
    await vi.waitFor(() => expect(driver.pending).toHaveLength(1))
    await runtime.stop()
    driver.answer()
    await pending
    await expect(runtime.providers()).rejects.toThrow('shutting down')
  })

  it('returns provider diagnostics after a rejected probe and permits a forced retry', async () => {
    vi.spyOn(driver, 'probe').mockRejectedValueOnce(new Error('Synthetic probe failure'))
    expect((await runtime.providers())[0]).toMatchObject({ installed: false, authenticated: null,
      diagnostics: ['Synthetic probe failure'] })
    const retry = runtime.providers(true)
    await vi.waitFor(() => expect(driver.pending).toHaveLength(1))
    driver.answer()
    expect((await retry)[0]?.installed).toBe(true)
  })

  it('checks again before refusing a provider the served answer calls unavailable', async () => {
    driver.installed = false
    await warm()
    driver.installed = true
    const found = runtime.usableProvider((provider) => provider.id === 'fake')
    await vi.waitFor(() => expect(driver.pending).toHaveLength(1))
    driver.answer()
    expect((await found)?.installed).toBe(true)
  })
})
