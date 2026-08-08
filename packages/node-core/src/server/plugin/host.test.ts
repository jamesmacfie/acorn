import { afterAll, describe, expect, it, vi } from 'vitest'
import { memoryIdentityStore } from '../../main/activeIdentity'
import { createCoreServices, SecretService } from '../../main/core'
import { makeTestDb } from '../../testkit/db'
import { CapabilityRegistry, capabilityId } from './capabilities'
import { Hono } from 'hono'
import { z } from 'zod'
import { agentToolContributions } from '../agentTools/registry'
import type { AppEnv } from '../middleware/auth'
import { pluginRouteContributions } from '../routeRegistry'
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
      core: createCoreServices({ secrets: new SecretService('a'.repeat(64)), db: coreDb(), activeIdentity: memoryIdentityStore() }),
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

  it('disposes the plugins that DID initialize when a later init throws', async () => {
    // The caller cannot do this itself: it only gets the dispose closure from a resolved result, so
    // before this the composition root's catch released the data-root lock with every already-opened
    // WAL-mode SQLite handle still open, plus live intervals and provider children.
    const disposed: string[] = []
    await expect(
      host([
        plugin('first', { dispose: () => void disposed.push('first') }),
        plugin('second', { dispose: () => void disposed.push('second') }),
        plugin('bad', {
          init: () => {
            throw new Error('nope')
          },
        }),
        plugin('never', { dispose: () => void disposed.push('never') }),
      ]),
    ).rejects.toThrow('nope')
    // Reverse order, and the plugin that never initialized is not disposed.
    expect(disposed).toEqual(['second', 'first'])
  })

  it('runs every ready() only after every init, so cross-plugin reads do not depend on list order', async () => {
    // The hazard this closes: a plugin whose init reads a slot another plugin fills in its own init
    // works only by alphabetical luck. Reordering the list by domain would silently break it.
    const order: string[] = []
    await host([
      plugin('early', {
        init: () => void order.push('init:early'),
        ready: () => void order.push('ready:early'),
      }),
      plugin('late', { init: () => void order.push('init:late') }),
    ])
    expect(order).toEqual(['init:early', 'init:late', 'ready:early'])
  })

  it('disposes started plugins when a ready() throws, exactly as an init failure does', async () => {
    const disposed: string[] = []
    await expect(
      host([
        plugin('first', { dispose: () => void disposed.push('first') }),
        plugin('bad', {
          ready: () => {
            throw new Error('not ready')
          },
        }),
      ]),
    ).rejects.toThrow('not ready')
    expect(disposed).toEqual(['first'])
  })

  it('clears a plugin contributions even when it is DISABLED on this boot', async () => {
    // The clear has to happen before the disabled check. Otherwise a plugin disabled on the second boot
    // of one process keeps the FIRST boot's routes and tools — served through a handle its own dispose
    // already closed. That is the exact trap the disable flag exists to avoid.
    const router = new Hono<AppEnv>()
    const tool = { name: 'probe_tool', title: 'Probe', risk: 'read', input: z.object({}), handler: async () => null } as never
    const contribute = plugin('docker', {
      init: (ctx) => {
        ctx.routes.register(router)
        ctx.tools.register(tool)
      },
    })
    await host([contribute])
    expect(pluginRouteContributions().some((c) => c.plugin === 'docker')).toBe(true)
    expect(agentToolContributions().some((c) => c.name === 'probe_tool')).toBe(true)

    await host([contribute], ['docker'])
    expect(pluginRouteContributions().some((c) => c.plugin === 'docker')).toBe(false)
    expect(agentToolContributions().some((c) => c.name === 'probe_tool')).toBe(false)
  })
})
