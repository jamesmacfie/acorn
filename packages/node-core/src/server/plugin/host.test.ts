import { afterAll, describe, expect, it, vi } from 'vitest'
import { createCoreServices, SecretService } from '../../main/core'
import { makeTestDb } from '../routes/testDb'
import { CapabilityRegistry, capabilityId } from './capabilities'
import { initPlugins } from './host'
import type { NodePlugin } from './types'

const noop = (): void => {}

describe('capability registry', () => {
  const greet = capabilityId<(name: string) => string>('test.greet')

  it('resolves a provided capability and stays optional when absent', () => {
    const registry = new CapabilityRegistry()
    expect(registry.get(greet)).toBeUndefined()
    registry.provide(greet, (name) => `hi ${name}`)
    // The phantom type is what makes this call site type-safe without core knowing the signature.
    expect(registry.get(greet)?.('acorn')).toBe('hi acorn')
    expect(() => registry.require(greet)).not.toThrow()
  })

  it('refuses a second provider, because the winner would depend on plugin init order', () => {
    const registry = new CapabilityRegistry()
    registry.provide(greet, () => 'first')
    expect(() => registry.provide(greet, () => 'second')).toThrow(/already provided/)
  })

  it('throws only for require(), so a disabled plugin degrades instead of crashing', () => {
    const registry = new CapabilityRegistry()
    expect(registry.get(greet)).toBeUndefined()
    expect(() => registry.require(greet)).toThrow(/Required capability/)
  })

  it('disposal removes the impl so the id can be re-provided', () => {
    const registry = new CapabilityRegistry()
    const handle = registry.provide(greet, () => 'first')
    handle.dispose()
    handle.dispose() // idempotent
    expect(registry.get(greet)).toBeUndefined()
    expect(() => registry.provide(greet, () => 'second')).not.toThrow()
  })
})

describe('plugin host', () => {
  // One real database for the whole block: CoreServices.tasks needs a handle, and these cases never
  // touch it — they exercise ordering, disabling and failure propagation.
  let shared: ReturnType<typeof makeTestDb> | null = null
  const coreDb = () => (shared ??= makeTestDb()).db
  afterAll(() => shared?.cleanup())

  const plugin = (name: string, opts: Partial<NodePlugin> = {}): NodePlugin => ({
    name,
    init: () => {},
    ...opts,
  })

  // A fresh graph per call, mirroring how startServiceRuntime owns one per boot.
  const host = (plugins: readonly NodePlugin[], disabled?: readonly string[]) =>
    initPlugins(plugins, {
      capabilities: new CapabilityRegistry(),
      core: createCoreServices({ secrets: new SecretService('a'.repeat(64)), db: coreDb() }),
      disabled,
    })

  it('initializes plugins in declaration order and binds each context to its own name', async () => {
    const order: string[] = []
    const names: string[] = []
    const result = await host([
      plugin('alpha', { init: (ctx) => void (order.push('alpha'), names.push(ctx.name)) }),
      plugin('beta', { init: (ctx) => void (order.push('beta'), names.push(ctx.name)) }),
    ])
    expect(order).toEqual(['alpha', 'beta'])
    expect(names).toEqual(['alpha', 'beta'])
    expect(result).toMatchObject({ enabled: ['alpha', 'beta'], skipped: [] })
  })

  it('hands every plugin the SAME graph, so one can consume what another provided', async () => {
    const greet = capabilityId<() => string>('probe.greet')
    let resolved: string | undefined
    await host([
      plugin('provider', { init: (ctx) => void ctx.capabilities.provide(greet, () => 'from provider') }),
      plugin('consumer', { init: (ctx) => void (resolved = ctx.capabilities.get(greet)?.()) }),
    ])
    expect(resolved).toBe('from provider')
  })

  it('awaits async init, so a plugin can finish a migration before the listener binds', async () => {
    const done: string[] = []
    await host([
      plugin('slow', {
        init: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5))
          done.push('slow')
        },
      }),
      plugin('fast', { init: () => void done.push('fast') }),
    ])
    expect(done).toEqual(['slow', 'fast'])
  })

  it('skips a disabled plugin but ignores the flag for a required one', async () => {
    const started: string[] = []
    const result = await host(
      [
        plugin('github', { required: true, init: () => void started.push('github') }),
        plugin('docker', { init: () => void started.push('docker') }),
      ],
      ['github', 'docker'],
    )
    expect(started).toEqual(['github'])
    expect(result).toMatchObject({ enabled: ['github'], skipped: ['docker'] })
  })

  it('disposes started plugins newest-first, and one failure does not stop the rest', async () => {
    const order: string[] = []
    const warn = vi.spyOn(console, 'warn').mockImplementation(noop)
    const result = await host([
      plugin('first', { dispose: () => void order.push('first') }),
      plugin('bad', {
        dispose: () => {
          throw new Error('close failed')
        },
      }),
      plugin('last', { dispose: () => void order.push('last') }),
    ])
    await result.dispose()
    // Reverse order, because a later plugin may depend on an earlier one's resources; and 'first' still
    // gets disposed despite 'bad' throwing, because teardown must not leave a WAL-mode database open.
    expect(order).toEqual(['last', 'first'])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('rejects a duplicate plugin name before running any init', async () => {
    const started: string[] = []
    await expect(
      host([plugin('dup', { init: () => void started.push('a') }), plugin('dup', { init: () => void started.push('b') })]),
    ).rejects.toThrow(/Duplicate node plugin/)
    expect(started).toEqual([])
  })

  it('propagates an init failure instead of booting a half-wired node', async () => {
    const started: string[] = []
    await expect(
      host([
        plugin('bad', {
          init: () => {
            throw new Error('nope')
          },
        }),
        plugin('after', { init: () => void started.push('after') }),
      ]),
    ).rejects.toThrow('nope')
    expect(started).toEqual([])
  })
})
