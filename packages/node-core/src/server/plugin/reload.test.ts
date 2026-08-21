// The reload path's acceptance list (docs/plugins.md § The dev loop § Reloading one plugin without a
// restart): candidate-then-commit, contained failure, a stale handle that throws, plus the fix that
// made all three pointless until it landed, which is that a reloaded plugin's routes have to serve
// the new handler.
//
// Everything here uses the real host, the real context builder and the real module-singleton registries,
// because the whole question is what those do when a second instance of one plugin arrives.
import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { memoryIdentityStore } from '../../main/activeIdentity'
import { createCoreServices, SecretService } from '../../main/core'
import type { NodePermissions } from '../../main/pluginManifest'
import { makeTestDb } from '../../testkit/db'
import { testGate } from '../../testkit/auth'
import type { Env } from '../../main/bindings'
import { agentToolContributions } from '../agentTools/registry'
import type { AppEnv } from '../middleware/auth'
import { PLUGIN_NAMESPACE, pluginRouteContributions } from '../routeRegistry'
import { CapabilityRegistry, capabilityId } from './capabilities'
import { dispatchPluginFetch } from './fetchRoute'
import { clearRegistrations, initPlugins, type PluginReloadRequest } from './host'
import type { NodePlugin, NodePluginContext, PluginStorage } from './types'

const PLUGIN = 'acme'

// A loaded plugin declares nothing by default, which is what `permissions: {}` means in a manifest.
const NO_PERMISSIONS: NodePermissions = { core: [], capabilities: [], secrets: false, exec: false, net: [] }
// Never opened by anything in this file: these cases are about registrations, and a real chain would drag
// a temp data root in for nothing. The reload × migration interaction has its own note in
// main/pluginStorage.ts, and it is a promise deliberately NOT made.
const storage: PluginStorage = {
  open: () => {
    throw new Error('this suite never opens a plugin database')
  },
}
const binding = { permissions: NO_PERMISSIONS, storage }

const shared = makeTestDb()
const hostOptions = () => ({
  capabilities: new CapabilityRegistry(),
  core: createCoreServices({ secrets: new SecretService('b'.repeat(64)), db: shared.db, activeIdentity: memoryIdentityStore() }),
  dataDir: '',
  loaded: new Map([[PLUGIN, binding]]),
})

// One loaded plugin that contributes the three things a reload has to move: a route (mounted through the
// portable carrier), an agent tool (a registry that rejects duplicates, which is what makes the candidate
// buffer necessary) and a captured context (so the test can prove the old one is revoked).
const acme = (body: string, extra?: Partial<NodePlugin>): { plugin: NodePlugin; context: () => NodePluginContext } => {
  let captured: NodePluginContext | null = null
  return {
    context: () => captured!,
    plugin: {
      name: PLUGIN,
      init: (ctx) => {
        captured = ctx
        ctx.routes.fetch(() => new Response(body))
        ctx.tools.register({
          name: `${PLUGIN}_probe`,
          description: body,
          input: z.object({}),
          scope: 'task',
          risk: 'read',
          handler: async () => ({}),
        })
      },
      ...extra,
    },
  }
}

const request = (path: string) =>
  new Hono<AppEnv>()
    .use('/v2/*', ...testGate({ kind: 'device', userId: 'owner-1', deviceId: 'device-1' }))
    .all(`${PLUGIN_NAMESPACE}/:plugin`, dispatchPluginFetch)
    .all(`${PLUGIN_NAMESPACE}/:plugin/*`, dispatchPluginFetch)
    .fetch(new Request(`http://acorn.test${path}`), {} as Env)

const toolDescriptions = () => agentToolContributions().filter((tool) => tool.name === `${PLUGIN}_probe`).map((tool) => tool.description)

afterEach(() => clearRegistrations(PLUGIN))

describe('plugin reload', () => {
  it('leaves the previous instance fully live when the candidate init throws', async () => {
    const first = acme('v1')
    const host = await initPlugins([first.plugin], hostOptions())

    const outcome = await host.reload(PLUGIN, {
      plugin: { name: PLUGIN, init: () => { throw new Error('the new bundle is broken') } },
      binding,
    })

    expect(outcome).toEqual({ ok: false, error: 'the new bundle is broken' })
    // Fully live means all three: the route still serves, the tool is still the old one and there is
    // exactly one of each. A candidate that had written through would have left duplicates.
    expect(await (await request(`/v2/p/${PLUGIN}`)).text()).toBe('v1')
    expect(toolDescriptions()).toEqual(['v1'])
    expect(pluginRouteContributions().filter((route) => route.plugin === PLUGIN)).toHaveLength(1)
    await host.dispose()
  })

  it('records the failure on the roster row so the owner can read it', async () => {
    const host = await initPlugins([acme('v1').plugin], hostOptions())
    await host.reload(PLUGIN, {
      plugin: { name: PLUGIN, init: () => { throw new Error('boom') } },
      binding,
    })
    expect(host.roster.find((entry) => entry.name === PLUGIN)).toMatchObject({
      state: 'failed',
      stage: 'init',
      reason: 'boom',
    })
    // And a later good reload clears it, or the row would stay red for a plugin that is running fine.
    await host.reload(PLUGIN, { plugin: acme('v2').plugin, binding })
    expect(host.roster.find((entry) => entry.name === PLUGIN)).toMatchObject({ state: 'active' })
    expect(host.roster.find((entry) => entry.name === PLUGIN)?.reason).toBeUndefined()
    await host.dispose()
  })

  it('swaps the registrations on success and revokes the previous context', async () => {
    const first = acme('v1')
    const host = await initPlugins([first.plugin], hostOptions())
    const stale = first.context()

    expect(await host.reload(PLUGIN, { plugin: acme('v2').plugin, binding })).toEqual({ ok: true })

    expect(toolDescriptions()).toEqual(['v2'])
    expect(pluginRouteContributions().filter((route) => route.plugin === PLUGIN)).toHaveLength(1)
    // The stale handle: a leaked reference must fail loudly rather than register into a plugin that is
    // no longer running. The message names the reason, because "not a function" would send an author
    // looking at their own code.
    expect(() => stale.tools.register({} as never)).toThrow(/replaced by a reload/)
    expect(() => stale.routes.fetch(() => new Response())).toThrow(/replaced by a reload/)
    await host.dispose()
  })

  it('serves the NEW handler, which is the whole reason the app dispatches instead of mounting', async () => {
    const host = await initPlugins([acme('v1').plugin], hostOptions())
    expect(await (await request(`/v2/p/${PLUGIN}`)).text()).toBe('v1')

    await host.reload(PLUGIN, { plugin: acme('v2').plugin, binding })

    expect(await (await request(`/v2/p/${PLUGIN}`)).text()).toBe('v2')
    expect(await (await request(`/v2/p/${PLUGIN}/anything`)).text()).toBe('v2')
    await host.dispose()
  })

  it('reaches a prefix that only exists after the reload', async () => {
    const host = await initPlugins([{
      name: PLUGIN,
      init: (ctx) => ctx.routes.fetch(() => new Response('early'), { prefix: '/early' }),
    }], hostOptions())
    // Nothing was mounted at this path when the app was built, so a boot-time mount table could never
    // answer it. The fall-through keeps that the app's own 404 rather than the dispatcher's.
    expect((await request(`/v2/p/${PLUGIN}/late`)).status).toBe(404)

    await host.reload(PLUGIN, {
      plugin: {
        name: PLUGIN,
        init: (ctx) => {
          ctx.routes.fetch(() => new Response('root'))
          ctx.routes.fetch(() => new Response('late'), { prefix: '/late' })
        },
      },
      binding,
    })

    // Longest prefix wins, so the specific handler answers its own path and the namespace owner keeps
    // everything else.
    expect(await (await request(`/v2/p/${PLUGIN}/late`)).text()).toBe('late')
    expect(await (await request(`/v2/p/${PLUGIN}/other`)).text()).toBe('root')
    await host.dispose()
  })

  it('never shadows a built-in router, which is mounted before it', async () => {
    // The regression this change could have caused. createApp mounts every built-in's Hono router first
    // and the dispatcher last, so a path a router already answers must never reach the dispatcher, and a
    // path under a built-in's namespace that nothing claims must still be the app's own 404.
    const host = await initPlugins([acme('loaded').plugin], hostOptions())
    const app = new Hono<AppEnv>()
      .use('/v2/*', ...testGate({ kind: 'device', userId: 'owner-1', deviceId: 'device-1' }))
      .route(`${PLUGIN_NAMESPACE}/${PLUGIN}`, new Hono<AppEnv>().get('/compiled', (c) => c.text('built-in')))
      .all(`${PLUGIN_NAMESPACE}/:plugin`, dispatchPluginFetch)
      .all(`${PLUGIN_NAMESPACE}/:plugin/*`, dispatchPluginFetch)
    const call = (path: string) => app.fetch(new Request(`http://acorn.test${path}`), {} as Env)

    expect(await (await call(`/v2/p/${PLUGIN}/compiled`)).text()).toBe('built-in')
    expect(await (await call(`/v2/p/${PLUGIN}/elsewhere`)).text()).toBe('loaded')
    expect((await call('/v2/p/nobody/at/all')).status).toBe(404)
    await host.dispose()
  })

  it('refuses a name this node did not load from disk', async () => {
    // No `loaded` entry: a built-in, which keeps restart-required semantics because there is no second
    // copy of it on disk to swap in.
    const host = await initPlugins([acme('v1').plugin], { ...hostOptions(), loaded: new Map() })
    const outcome = await host.reload(PLUGIN, { plugin: acme('v2').plugin, binding })
    expect(outcome).toEqual({ ok: false, error: expect.stringContaining('not a plugin this node loaded from disk') })
    expect(toolDescriptions()).toEqual(['v1'])
    await host.dispose()
  })

  it('lets a plugin whose init was contained at boot come back without a restart', async () => {
    const host = await initPlugins([{ name: PLUGIN, init: () => { throw new Error('broken at boot') } }], hostOptions())
    expect(host.roster.find((entry) => entry.name === PLUGIN)).toMatchObject({ state: 'failed' })

    expect(await host.reload(PLUGIN, { plugin: acme('fixed').plugin, binding })).toEqual({ ok: true })
    expect(await (await request(`/v2/p/${PLUGIN}`)).text()).toBe('fixed')
    expect(host.roster.find((entry) => entry.name === PLUGIN)).toMatchObject({ state: 'active' })
    await host.dispose()
  })

  it('re-provides a capability the previous instance held, which a live registry would refuse', async () => {
    // The case the candidate buffer exists for, in its sharpest form: CapabilityRegistry.provide throws
    // on a duplicate id, so a candidate init run straight at the live registry would fail on the
    // plugin's own capability every single time.
    const id = capabilityId<() => string>('acme.version')
    const versioned = (version: string): PluginReloadRequest => {
      // The plugin releases what it provided in its own dispose, because the host never holds the
      // handle: the same contract a contained failure at boot already relies on. A plugin that keeps
      // its capability through dispose fails the replay instead, which is the commit-window ceiling
      // written down in host.ts.
      let handle: { dispose(): void } | null = null
      return {
        binding,
        plugin: {
          name: PLUGIN,
          init: (ctx) => void (handle = ctx.capabilities.provide(id, () => version)),
          dispose: () => handle?.dispose(),
        },
      }
    }
    const options = hostOptions()
    const host = await initPlugins([versioned('v1').plugin], options)
    expect(options.capabilities.get(id)?.()).toBe('v1')

    expect(await host.reload(PLUGIN, versioned('v2'))).toEqual({ ok: true })
    expect(options.capabilities.get(id)?.()).toBe('v2')
    await host.dispose()
  })
})
