import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { memoryIdentityStore } from '../activeIdentity'
import { wsBroadcast } from '../transport/wsHub'
import { createCoreServices, SecretService } from '../core'
import { openPluginDb, type PluginDatabase } from '../plugins/storage'
import { makeTestDb } from '../../testkit/db'
import { CapabilityRegistry, capabilityId } from './capabilities'
import { Hono } from 'hono'
import { z } from 'zod'
import { agentToolContributions } from '../agentTools/registry'
import type { AppEnv } from '../middleware/auth'
import { pluginRouteContributions } from '../routeRegistry'
import { AGENTS_HARNESS_REGISTRY, type ManifestHarness } from './harnesses'
import { clearRegistrations, initPlugins, type LoadedPluginBinding } from './host'
import type { NodePermissions } from '../plugins/manifest'
import type { CompiledNodePluginContext, NodePlugin } from './types'
import { defaultBudgets, externalIdsFor, publicProvider } from '../integrations/providerShared'
import { integrationProviderRegistry } from '../integrations/registry'

const noop = (): void => {}

const provider = (id: string) => publicProvider({
  id,
  label: 'Test tracker',
  glyph: 'T',
  kind: 'issue-tracker',
  connection: {
    authKind: 'api-key' as const,
    fields: [],
    connectable: true,
    disconnectable: true,
    async validate() { return 'secret' },
    normalize(_credentials, secret) {
      return { secret, label: 'Test tracker', account: null, scopes: [], config: {}, capabilities: {} }
    },
    async test() { return { ok: true as const } },
  },
  externalIds: externalIdsFor(id),
  capabilities: {},
  resources: [],
  budgets: defaultBudgets,
  memory: { linkedItems: false, mutations: [], triggers: [], summarize: 'none' as const, acceptedWrites: false },
})

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
  // touch it. They exercise ordering, disabling and failure propagation.
  let shared: ReturnType<typeof makeTestDb> | null = null
  const coreDb = () => (shared ??= makeTestDb()).db
  afterAll(() => shared?.cleanup())

  const plugin = (name: string, opts: Partial<NodePlugin> = {}): NodePlugin => ({
    name,
    init: () => {},
    ...opts,
  })

  // A fresh graph per call, mirroring how startServiceRuntime owns one per boot. `dataDir: ''` works
  // because no plugin in this block declares `migrationsModule`, so nothing here opens a database.
  const host = (plugins: readonly NodePlugin[], disabled?: readonly string[]) =>
    initPlugins(plugins, {
      capabilities: new CapabilityRegistry(),
      core: createCoreServices({ secrets: new SecretService('a'.repeat(64)), db: coreDb(), activeIdentity: memoryIdentityStore() }),
      dataDir: '',
      disabled,
    })

  // Starts, not finishes: the pass is kicked off in declaration order, and a plugin that awaits inside
  // its init finishes whenever it finishes. The order-independence block at the bottom of this file is
  // the property that matters.
  it('starts plugins in declaration order and binds each context to its own name', async () => {
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

  it('awaits every async init before it resolves, without one plugin waiting for another', async () => {
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
    // The whole pass is still awaited, so a plugin's migration is finished before the listener binds.
    // What is gone is the queueing: 'fast' does not sit behind 'slow', which is why completion order is
    // not declaration order and must not be depended on.
    expect(done).toEqual(['fast', 'slow'])
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
    // Reverse order, because a later plugin may depend on an earlier one's resources. 'first' still gets
    // disposed despite 'bad' throwing, because teardown must not leave a WAL-mode database open.
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
    const result = host([
      plugin('bad', {
        init: () => {
          throw new Error('nope')
        },
      }),
      plugin('after', { init: () => void started.push('after') }),
    ])
    await expect(result).rejects.toThrow('nope')
    // 'after' ran, where the serial loop never reached it: the whole pass is in flight before any
    // failure is read. What matters is unchanged — the boot fails rather than serving a node one of
    // whose plugins never initialized — and the test below is the one that proves the neighbours are
    // torn down again.
    expect(started).toEqual(['after'])
  })

  it('disposes the plugins that DID initialize when a later init throws', async () => {
    // The caller cannot do this itself: it only gets the dispose closure from a resolved result. Without
    // it, the composition root's catch releases the data-root lock while WAL-mode SQLite handles, live
    // intervals and provider children are still open.
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
        plugin('last', { dispose: () => void disposed.push('last') }),
      ]),
    ).rejects.toThrow('nope')
    // Reverse declaration order, and every plugin whose init resolved is in the list — which is all of
    // them now, because they all ran. Declaration order is what the dispose sequence reverses, not
    // completion order: a later plugin may depend on an earlier one's resources.
    expect(disposed).toEqual(['last', 'second', 'first'])
  })

  // The compiled tier's half of ctx.storage. See docs/data-layer.md § Migrations. All the host needs is
  // the module the chain sits beside.
  it("opens, reuses and closes a built-in's database from its declared chain", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'acorn-builtin-storage-'))
    try {
      // A chain with an empty journal: this tests the lifecycle, not anyone's schema. It sits where the
      // plugin's own does, beside the module that declared it, found by the ancestor walk.
      mkdirSync(join(dir, 'migrations/meta'), { recursive: true })
      writeFileSync(join(dir, 'migrations/meta/_journal.json'), JSON.stringify({ version: '7', dialect: 'sqlite', entries: [] }))
      let opened: PluginDatabase | null = null
      let again: PluginDatabase | null = null
      let liveInDispose = false
      const result = await initPlugins(
        [plugin('widgets', {
          migrationsModule: pathToFileURL(join(dir, 'src/node/index.ts')).href,
          init: (ctx) => {
            opened = ctx.storage.open()
            again = ctx.storage.open()
          },
          // agents flushes transcripts, workflows aborts steps and database drains pools through this
          // handle on the way out, so it has to still be open here. The host closes it after this returns.
          dispose: () => {
            opened!.$client.prepare('select 1').get()
            liveInDispose = true
          },
        })],
        {
          capabilities: new CapabilityRegistry(),
          core: createCoreServices({ secrets: new SecretService('a'.repeat(64)), db: coreDb(), activeIdentity: memoryIdentityStore() }),
          dataDir: dir,
        },
      )
      // Bound to the plugin id, under the one plugins directory: the same file and filename the plugin
      // opens for itself, so adopting the seam moves nobody's rows.
      expect(existsSync(join(dir, 'plugins/widgets.sqlite'))).toBe(true)
      // One handle per boot however many times a plugin asks. Two openPluginDb calls would otherwise mean
      // two connections on one file, with nothing closing the second.
      expect(again).toBe(opened)
      await result.dispose()
      expect(liveInDispose).toBe(true)
      // Closed by the host rather than by the plugin: node:sqlite refuses a second close, so this
      // throwing is the proof the WAL file was drained inside the `plugins` drain step.
      expect(() => opened!.close()).toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // The twin of the case above, and the one whose absence let a bug through: the context dropped the
  // host's memoizing wrapper for this tier (server/pluginHost/context.ts), so the `opened` map never saw a
  // loaded handle, closing was a no-op, and a WAL handle outlived the data-root lock release.
  it("opens, reuses and closes a LOADED plugin's database from the manifest chain", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'acorn-loaded-storage-'))
    try {
      mkdirSync(join(dir, 'migrations/meta'), { recursive: true })
      writeFileSync(join(dir, 'migrations/meta/_journal.json'), JSON.stringify({ version: '7', dialect: 'sqlite', entries: [] }))
      let opened: PluginDatabase | null = null
      let again: PluginDatabase | null = null
      let liveInDispose = false
      const result = await initPlugins(
        [plugin('ntfy', {
          init: (ctx) => {
            opened = ctx.storage.open()
            again = ctx.storage.open()
          },
          dispose: () => {
            opened!.$client.prepare('select 1').get()
            liveInDispose = true
          },
        })],
        {
          capabilities: new CapabilityRegistry(),
          core: createCoreServices({ secrets: new SecretService('a'.repeat(64)), db: coreDb(), activeIdentity: memoryIdentityStore() }),
          dataDir: dir,
          // The binding as the loader builds it, with the chain already resolved from the manifest. That
          // is why this tier never consults the plugin object's own `migrationsModule`.
          loaded: new Map([['ntfy', {
            permissions: { core: [], capabilities: [], secrets: false, exec: false, net: [] },
            storage: { open: () => openPluginDb(dir, 'ntfy', { migrationsFolder: join(dir, 'migrations') }) },
          }]]),
        },
      )
      expect(existsSync(join(dir, 'plugins/ntfy.sqlite'))).toBe(true)
      // The binding's `open` is unmemoized above and returns a fresh connection every call, so this
      // passing is the host's wrapper doing its job, not the binding's.
      expect(again).toBe(opened)
      await result.dispose()
      expect(liveInDispose).toBe(true)
      expect(() => opened!.close()).toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
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
    // of one process keeps the first boot's routes and tools, served through a handle its own dispose
    // already closed.
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

  it('reports a roster state alongside what the owner asked for', async () => {
    const result = await host([plugin('github'), plugin('terminal', { required: true }), plugin('docker')], ['docker', 'terminal'])
    expect(result.roster).toEqual([
      { name: 'github', required: false, disabled: false, state: 'active' },
      // Required, so the disable flag is ignored in both fields.
      { name: 'terminal', required: true, disabled: false, state: 'active' },
      { name: 'docker', required: false, disabled: true, state: 'disabled' },
    ])
  })
})

// The other half of the two-tier rule. A built-in throwing is a broken build and fails the boot, as
// the cases above show. A plugin loaded from disk is third-party code, so its failure is contained:
// contributions roll back, the failure is reported, and the node keeps starting.
describe('loaded plugins', () => {
  let shared: ReturnType<typeof makeTestDb> | null = null
  const coreDb = () => (shared ??= makeTestDb()).db
  afterAll(() => shared?.cleanup())

  const plugin = (name: string, opts: Partial<NodePlugin> = {}): NodePlugin => ({ name, init: () => {}, ...opts })

  // Membership in `loaded` is the only thing that separates the two tiers: same plugin object,
  // different treatment.
  const host = (
    plugins: readonly NodePlugin[],
    loaded: Record<string, Partial<NodePermissions>>,
    events: Record<string, readonly string[]> = {},
  ) =>
    initPlugins(plugins, {
      capabilities: new CapabilityRegistry(),
      core: createCoreServices({ secrets: new SecretService('a'.repeat(64)), db: coreDb(), activeIdentity: memoryIdentityStore() }),
      dataDir: '',
      loaded: new Map(
        Object.entries(loaded).map(([name, node]) => [
          name,
          {
            permissions: { core: [], capabilities: [], secrets: false, exec: false, net: [], ...node },
            // The manifest's `permissions.events`, a sibling of the `node` block rather than part of it.
            events: events[name] ?? [],
            storage: { open: () => { throw new Error('test storage is not configured') } },
          },
        ]),
      ),
    })

  // Typed as the compiled shape because that is what `NodePlugin.init` declares, and the point of these
  // assertions is that a loaded plugin's object does not have the members the type promises a built-in.
  const ctxOf = async (permissions: Partial<NodePermissions>): Promise<CompiledNodePluginContext> => {
    let captured!: CompiledNodePluginContext
    await host([plugin('ntfy', { init: (ctx) => void (captured = ctx) })], { ntfy: permissions })
    return captured
  }

  it('contains an init failure: rolled back, reported, boot continues', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(noop)
    const router = new Hono<AppEnv>()
    let disposed = false
    const result = await host(
      [
        plugin('ntfy', {
          init: (ctx) => {
            ctx.routes.fetch(() => new Response('ok'))
            void router
            throw new Error('boom')
          },
          dispose: () => void (disposed = true),
        }),
        plugin('after', {}),
      ],
      { ntfy: {}, after: {} },
    )
    expect(result.failed).toEqual([{ name: 'ntfy', error: 'boom', at: expect.any(Number), stage: 'init' }])
    expect(result.enabled).toEqual(['after'])
    // The rollback is the load-bearing part: three routes registered before the throw must not stay
    // mounted, serving from a plugin that never finished starting.
    expect(pluginRouteContributions().some((c) => c.plugin === 'ntfy')).toBe(false)
    expect(disposed).toBe(true)
    // The message travels with the row. Stopping at this process's stderr shows it to nobody in a
    // packaged app.
    expect(result.roster.find((entry) => entry.name === 'ntfy'))
      .toMatchObject({ state: 'failed', failedAt: expect.any(Number), reason: 'boom', stage: 'init' })
    error.mockRestore()
  })

  it('contains a ready failure the same way, and does not dispose it twice', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(noop)
    let disposals = 0
    const result = await host(
      [plugin('ntfy', { ready: () => { throw new Error('late') }, dispose: () => void (disposals += 1) })],
      { ntfy: {} },
    )
    expect(result.failed[0]).toMatchObject({ name: 'ntfy', error: 'late', stage: 'ready' })
    expect(result.roster[0]).toMatchObject({ state: 'failed', reason: 'late', stage: 'ready' })
    expect(result.enabled).toEqual([])
    await result.dispose()
    expect(disposals).toBe(1)
    error.mockRestore()
  })

  it('withholds the WS surface and the Hono route seam regardless of manifest', async () => {
    // Permanently first-party: PTY stream ownership and WS channel prefixes cannot survive a
    // message-passing boundary, and a Hono instance cannot cross a process one.
    const ctx = await ctxOf({ core: ['fs', 'git', 'tasks'], capabilities: ['x'], secrets: true, exec: true })
    expect(ctx.events.channel).toBeUndefined()
    expect(ctx.events.streams).toBeUndefined()
    expect(ctx.routes.register).toBeUndefined()
    expect(typeof ctx.routes.fetch).toBe('function')
    // Everything else it did ask for is present.
    expect(ctx.events.status).toBeTypeOf('function')
    expect(ctx.core.git).toBeDefined()
  })

  it('delivers a granted core event to a loaded plugin, and stops on unload', async () => {
    // The receive side of ctx.events (docs/plugins.md § Hearing another plugin). It fires whether or
    // not a client is attached, which is the property that makes it useful on a node nobody is sitting
    // at.
    const heard: string[] = []
    await host(
      [plugin('ntfy', { init: (ctx) => void ctx.events.on('plugins:changed', (frame) => heard.push(frame.channel)) })],
      { ntfy: {} },
      { ntfy: ['plugins:changed'] },
    )
    wsBroadcast({ channel: 'plugins:changed' })
    wsBroadcast({ channel: 'term:status' })
    expect(heard).toEqual(['plugins:changed'])
    // Unload takes the subscription with it, on the same path a route registration goes out on.
    clearRegistrations('ntfy')
    wsBroadcast({ channel: 'plugins:changed' })
    expect(heard).toEqual(['plugins:changed'])
  })

  it('refuses an ungranted event, and one this node does not publish', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(noop)
    const ungranted = await host(
      [plugin('ntfy', { init: (ctx) => void ctx.events.on('plugins:changed', noop) })],
      { ntfy: {} },
    )
    expect(ungranted.roster[0]).toMatchObject({ state: 'failed', reason: expect.stringContaining('permissions.events') })

    const unknown = await host(
      // Cast: the point of the check is a manifest naming something outside the catalogue, which the
      // type would otherwise refuse first.
      [plugin('ntfy', { init: (ctx) => void ctx.events.on('nobody:changed' as 'plugins:changed', noop) })],
      { ntfy: {} },
      { ntfy: ['nobody:changed'] },
    )
    expect(unknown.roster[0]).toMatchObject({ state: 'failed', reason: expect.stringContaining('not a core event') })
    error.mockRestore()
  })

  it('lets one plugin hear another\'s declared verb, and only a declared one', async () => {
    // The cross-plugin grant (docs/plugins.md § Hearing another plugin). The producer is a built-in with an
    // `emits` field; the consumer is loaded, so the manifest grant applies too.
    const heard: string[] = []
    const gh = plugin('gh', { emits: [{ verb: 'checks-changed', description: 'checks flipped' }] })
    await host(
      [gh, plugin('wf', { init: (ctx) => void ctx.events.on('plugin:gh:checks-changed', (frame) => heard.push(frame.channel)) })],
      { wf: {} },
      { wf: ['plugin:gh:checks-changed'] },
    )
    wsBroadcast({ channel: 'plugin:gh:checks-changed', pullNumber: 7 })
    wsBroadcast({ channel: 'plugin:gh:pr-synced' })
    expect(heard).toEqual(['plugin:gh:checks-changed'])

    // A running producer that did not declare the verb has said no.
    const error = vi.spyOn(console, 'error').mockImplementation(noop)
    const undeclared = await host(
      [gh, plugin('wf', { init: (ctx) => void ctx.events.on('plugin:gh:pr-synced', noop) })],
      { wf: {} },
      { wf: ['plugin:gh:pr-synced'] },
    )
    expect(undeclared.roster[1]).toMatchObject({ state: 'failed', reason: expect.stringContaining('does not declare') })
    error.mockRestore()

    // An absent producer delivers nothing and errors nothing.
    const absent = await host(
      [plugin('wf', { init: (ctx) => void ctx.events.on('plugin:nobody:anything', noop) })],
      { wf: {} },
      { wf: ['plugin:nobody:anything'] },
    )
    expect(absent.roster[0]).toMatchObject({ state: 'active' })
  })

  it('shapes core and capabilities from the manifest', async () => {
    const ctx = await ctxOf({ core: ['git'] })
    expect(ctx.core.git).toBeDefined()
    expect(ctx.core.fs).toBeUndefined()
    expect(ctx.core.secrets).toBeUndefined()
    expect(ctx.core.proc).toBeUndefined()
    expect(ctx.capabilities.get(capabilityId('anything'))).toBeUndefined()
  })

  it('hands a loaded plugin the host-bound storage seam', async () => {
    const ctx = await ctxOf({})
    expect(() => ctx.storage.open()).toThrow('test storage is not configured')
  })

  it("ignores a loaded bundle's own migrationsModule, so the manifest chain always wins", async () => {
    // A loaded plugin's object comes out of a bundle the owner installed. Honouring its declaration
    // would let a package point the migrator at any directory it can name.
    let captured!: CompiledNodePluginContext
    await host(
      [plugin('ntfy', { migrationsModule: 'file:///tmp/not-my-chain/index.ts', init: (ctx) => void (captured = ctx) })],
      { ntfy: {} },
    )
    expect(() => captured.storage.open()).toThrow('test storage is not configured')
  })

  it('leaves a built-in with the full context', async () => {
    let captured!: CompiledNodePluginContext
    const core = createCoreServices({ secrets: new SecretService('a'.repeat(64)), db: coreDb(), activeIdentity: memoryIdentityStore() })
    await initPlugins([plugin('terminal', { init: (ctx) => void (captured = ctx) })], {
      capabilities: new CapabilityRegistry(),
      core,
      dataDir: '',
    })
    expect(captured.routes.register).toBeTypeOf('function')
    expect(captured.events.streams).toBeTypeOf('function')
    expect(captured.core.secrets).toBeDefined()
    expect(captured.core.proc).toBeDefined()
    expect(captured.core.prefs).toBe(core.prefs)
    // No `migrationsModule`, so no storage: a plugin that owns no tables gets the same immediate
    // "not a function" as one reaching for routes.register it never had.
    expect(captured.storage).toBeUndefined()
  })

  it('mounts a fetch-shaped route under the plugin namespace', async () => {
    await host([plugin('ntfy', { init: (ctx) => ctx.routes.fetch(() => new Response('ok'), { prefix: '/send' }) })], { ntfy: {} })
    const contribution = pluginRouteContributions().find((c) => c.plugin === 'ntfy')
    expect(contribution).toMatchObject({ plugin: 'ntfy', prefix: '/send' })
    expect(contribution?.router).toBeUndefined()
    expect(contribution?.fetch).toBeTypeOf('function')
  })

  it('contains a loaded plugin that passes a Hono router through the provider side door', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(noop)
    const result = await host([
      plugin('tracker', {
        init: (ctx) => ctx.providers.integration(provider('tracker-provider'), new Hono<AppEnv>()),
      }),
      plugin('after'),
    ], { tracker: {}, after: {} })

    expect(result.failed[0]).toMatchObject({
      name: 'tracker',
      error: "Plugin 'tracker' passed a Hono router to providers.integration; loaded plugins must pass a fetch handler.",
    })
    expect(result.enabled).toEqual(['after'])
    expect(integrationProviderRegistry.get('tracker-provider')).toBeUndefined()
    expect(integrationProviderRegistry.routes().some((route) => route.providerId === 'tracker-provider')).toBe(false)
    error.mockRestore()
  })

  it('accepts a fetch-shaped provider route from a loaded plugin', async () => {
    await host([
      plugin('tracker', {
        init: (ctx) => ctx.providers.integration(provider('tracker-fetch-provider'), () => new Response('ok')),
      }),
    ], { tracker: {} })

    const route = integrationProviderRegistry.routes().find((entry) => entry.providerId === 'tracker-fetch-provider')
    expect(route?.router).toBeUndefined()
    expect(route?.fetch).toBeTypeOf('function')
  })
})

describe('delivering a manifest-declared harness', () => {
  let shared: ReturnType<typeof makeTestDb> | null = null
  const coreDb = () => (shared ??= makeTestDb()).db
  afterAll(() => shared?.cleanup())

  const plugin = (name: string, opts: Partial<NodePlugin> = {}): NodePlugin => ({ name, init: () => {}, ...opts })

  // Two plugins per boot: the consumer publishes the capability from its own init, and the
  // contributor's manifest harnesses are registered after every init has run, so neither plugin's
  // position in the roster decides whether the harness arrives.
  const boot = async (
    harnesses: readonly unknown[],
    dir: string,
  ): Promise<{ registered: ManifestHarness[]; dispose: () => Promise<void> }> => {
    const registered: ManifestHarness[] = []
    const result = await initPlugins([
      plugin('agents', {
        init: (ctx) => void ctx.capabilities.provide(AGENTS_HARNESS_REGISTRY, {
          register: (harness) => {
            registered.push(harness)
            return { dispose: () => void registered.splice(registered.indexOf(harness), 1) }
          },
        }),
      }),
      plugin('opencode'),
    ], {
      capabilities: new CapabilityRegistry(),
      core: createCoreServices({ secrets: new SecretService('a'.repeat(64)), db: coreDb(), activeIdentity: memoryIdentityStore() }),
      dataDir: '',
      loaded: new Map([['opencode', {
        permissions: { core: [], capabilities: [], secrets: false, exec: false, net: [] },
        storage: { open: () => { throw new Error('test storage is not configured') } },
        harnesses: harnesses as never,
        dir,
      }]]),
    })
    return { registered, dispose: () => result.dispose() }
  }

  it('mints the id from the contributing plugin and hands the descriptor over verbatim', async () => {
    const { registered, dispose } = await boot([{
      id: 'opencode',
      label: 'OpenCode',
      spawn: { command: 'opencode', args: ['acp'] },
      envPassthrough: ['OPENCODE_*'],
      quirks: { manualCompaction: true, sessionPersistence: false },
      terminal: { command: 'opencode', backendPreference: 'tmux', launchArgs: [] },
    }], '')

    expect(registered).toHaveLength(1)
    // `<pluginId>:<harnessId>`, minted here and nowhere else. It is persisted onto every session row,
    // so a manifest must not be able to choose it.
    expect(registered[0]).toMatchObject({
      id: 'opencode:opencode',
      pluginId: 'opencode',
      label: 'OpenCode',
      spawn: { command: 'opencode', args: ['acp'] },
    })
    // No probes declared, so no probes handed over: absent, not a stub that answers nothing.
    expect(registered[0].probeUsage).toBeUndefined()
    expect(registered[0].probeAuth).toBeUndefined()

    // Released when the plugin's registrations roll back, which a re-init and a contained failure both
    // do. The plugin's own dispose does not, because the harness lives in the consumer's registry.
    clearRegistrations('opencode')
    expect(registered).toEqual([])
    await dispose()
  })

  it('resolves an adapter entry inside the package and drops one that escapes it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'acorn-harness-'))
    try {
      const warn = vi.spyOn(console, 'warn').mockImplementation(noop)
      const { registered, dispose } = await boot([
        {
          id: 'inside',
          label: 'Inside',
          spawn: { entry: 'dist/adapter.js', args: [], requires: { command: 'node', env: 'NODE_BIN' } },
          envPassthrough: [],
          quirks: { manualCompaction: false, sessionPersistence: false },
        },
        // The schema already refuses `..` and a leading slash. This covers a path that escapes only
        // once it is resolved.
        {
          id: 'outside',
          label: 'Outside',
          spawn: { entry: 'dist/../../escape.js', args: [] },
          envPassthrough: [],
          quirks: { manualCompaction: false, sessionPersistence: false },
        },
      ], dir)

      expect(registered.map((harness) => harness.id)).toEqual(['opencode:inside'])
      expect(registered[0].spawn).toEqual({
        entry: join(dir, 'dist/adapter.js'),
        args: [],
        requires: { command: 'node', env: 'NODE_BIN' },
      })
      expect(warn).toHaveBeenCalled()
      warn.mockRestore()
      await dispose()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('delivers nothing when no plugin owns agent sessions', async () => {
    // The same silent nothing every unmatched contribution gets. A throw here would turn "agents
    // disabled" into "this node does not boot".
    const result = await initPlugins([plugin('opencode')], {
      capabilities: new CapabilityRegistry(),
      core: createCoreServices({ secrets: new SecretService('a'.repeat(64)), db: coreDb(), activeIdentity: memoryIdentityStore() }),
      dataDir: '',
      loaded: new Map([['opencode', {
        permissions: { core: [], capabilities: [], secrets: false, exec: false, net: [] },
        storage: { open: () => { throw new Error('test storage is not configured') } },
        harnesses: [{
          id: 'opencode',
          label: 'OpenCode',
          spawn: { command: 'opencode', args: [] },
          envPassthrough: [],
          quirks: { manualCompaction: false, sessionPersistence: false },
        }] as never,
      }]]),
    })
    expect(result.enabled).toEqual(['opencode'])
    await result.dispose()
  })
})

// The property the concurrent init pass rests on, and the reason the file's header says declaration
// order is not a contract: nothing a plugin does in its init may depend on where the roster put it.
// Proved by booting one roster three ways and comparing everything it registered.
describe('order independence', () => {
  let shared: ReturnType<typeof makeTestDb> | null = null
  const coreDb = () => (shared ??= makeTestDb()).db
  afterAll(() => shared?.cleanup())

  const greet = capabilityId<() => string>('probe.orderGreet')
  const harnessDescriptor = {
    id: 'opencode',
    label: 'OpenCode',
    spawn: { command: 'opencode', args: [] },
    envPassthrough: [],
    quirks: { manualCompaction: false, sessionPersistence: false },
  }

  type Registered = {
    enabled: string[]
    harnesses: string[]
    routes: string[]
    tools: string[]
    greeting: string | undefined
  }

  const bootIn = async (order: readonly number[]): Promise<Registered> => {
    const harnesses: ManifestHarness[] = []
    let greeting: string | undefined
    const roster: NodePlugin[] = [
      // Stands in for the agents plugin: the harness registry appears inside an init, and a loaded
      // plugin's manifest harnesses have to find it there.
      {
        name: 'agents',
        init: (ctx) => void ctx.capabilities.provide(AGENTS_HARNESS_REGISTRY, {
          register: (harness) => {
            harnesses.push(harness)
            return { dispose: () => void harnesses.splice(harnesses.indexOf(harness), 1) }
          },
        }),
      },
      {
        name: 'github',
        init: (ctx) => {
          ctx.routes.register(new Hono<AppEnv>())
          ctx.tools.register({ name: 'probe_order', title: 'Probe', risk: 'read', input: z.object({}), handler: async () => null } as never)
        },
      },
      { name: 'terminal', init: (ctx) => void ctx.capabilities.provide(greet, () => 'from terminal') },
      // The cross-plugin read, in `ready` because that is the pass that exists for it.
      { name: 'memory', init: () => {}, ready: (ctx) => void (greeting = ctx.capabilities.get(greet)?.()) },
      { name: 'opencode', init: () => {} },
    ]
    const result = await initPlugins(
      order.map((index) => roster[index]),
      {
        capabilities: new CapabilityRegistry(),
        core: createCoreServices({ secrets: new SecretService('a'.repeat(64)), db: coreDb(), activeIdentity: memoryIdentityStore() }),
        dataDir: '',
        loaded: new Map([['opencode', {
          permissions: { core: [], capabilities: [], secrets: false, exec: false, net: [] },
          storage: { open: () => { throw new Error('test storage is not configured') } },
          harnesses: [harnessDescriptor] as never,
          dir: '',
        }]]),
      },
    )
    const registered: Registered = {
      // Sorted, because `enabled` follows whatever order it was handed and the question here is which
      // plugins ran, not in what sequence.
      enabled: [...result.enabled].sort(),
      harnesses: harnesses.map((harness) => harness.id).sort(),
      routes: pluginRouteContributions().map((entry) => entry.plugin).sort(),
      tools: agentToolContributions().map((entry) => entry.name).sort(),
      greeting,
    }
    await result.dispose()
    return registered
  }

  it('registers the same things whichever order the roster is in', async () => {
    const declared = await bootIn([0, 1, 2, 3, 4])
    const reversed = await bootIn([4, 3, 2, 1, 0])
    const shuffled = await bootIn([3, 0, 4, 2, 1])
    expect(reversed).toEqual(declared)
    expect(shuffled).toEqual(declared)
    // And not vacuously equal. The harness is the strict case: it is the one manifest contribution that
    // lands in another plugin's registry, so it is present only because agents' registry was found.
    expect(declared.harnesses).toEqual(['opencode:opencode'])
    expect(declared.greeting).toBe('from terminal')
    expect(declared.tools).toEqual(['probe_order'])
  })

  it('records a rejecting plugin as failed while its neighbours reach ready', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(noop)
    const ready: string[] = []
    const loaded = (name: string): [string, LoadedPluginBinding] => [name, {
      permissions: { core: [], capabilities: [], secrets: false, exec: false, net: [] },
      storage: { open: () => { throw new Error('test storage is not configured') } },
    }]
    const result = await initPlugins(
      [
        { name: 'before', init: () => {}, ready: () => void ready.push('before') },
        {
          name: 'broken',
          init: async () => {
            await new Promise((resolve) => setTimeout(resolve, 2))
            throw new Error('init went wrong')
          },
          ready: () => void ready.push('broken'),
        },
        { name: 'after', init: () => {}, ready: () => void ready.push('after') },
      ],
      {
        capabilities: new CapabilityRegistry(),
        core: createCoreServices({ secrets: new SecretService('a'.repeat(64)), db: coreDb(), activeIdentity: memoryIdentityStore() }),
        dataDir: '',
        loaded: new Map([loaded('before'), loaded('broken'), loaded('after')]),
      },
    )
    expect(result.failed).toEqual([expect.objectContaining({ name: 'broken', stage: 'init', error: 'init went wrong' })])
    expect([...result.enabled].sort()).toEqual(['after', 'before'])
    // The ready pass runs only for the plugins whose init resolved, so the broken one is not in it and
    // both of its neighbours are.
    expect(ready.sort()).toEqual(['after', 'before'])
    expect(result.roster.find((entry) => entry.name === 'broken')?.state).toBe('failed')
    await result.dispose()
    error.mockRestore()
  })
})
