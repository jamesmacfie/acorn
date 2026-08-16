import { afterEach, describe, expect, it } from 'vitest'
import { memoryIdentityStore } from '../../main/activeIdentity'
import { createCoreServices, SecretService } from '../../main/core'
import type { NodePermissions, PluginCollectionDescriptor } from '../../main/pluginManifest'
import { makeTestDb, testEnv } from '../../testkit/db'
import { CapabilityRegistry } from '../plugin/capabilities'
import { clearRegistrations, initPlugins } from '../plugin/host'
import type { NodePlugin, PluginStorage } from '../plugin/types'
import { CollectionReadError, collectionReads, readCollection } from './registry'

// Seam 1 (docs/future/cron/targets.md): the node reading a collection with NO CLIENT ATTACHED.
//
// The claim the design rests on is that every collection is ultimately a node route answering, and
// that the only missing piece was a registry mapping `(pluginId, collectionId)` to it. So this suite
// proves BOTH feeders land in that one registry and come back through one parse — a loaded plugin's
// manifest descriptor and a compiled plugin's `ctx.collections.register`, indistinguishable
// downstream, which is the whole point.

const LOADED = 'acme'
const COMPILED = 'builtin'
const NO_PERMISSIONS: NodePermissions = { core: [], capabilities: [], secrets: false, exec: false, net: [] }
const storage: PluginStorage = {
  open: () => {
    throw new Error('this suite never opens a plugin database')
  },
}

const descriptor: PluginCollectionDescriptor = {
  id: 'issues',
  name: 'My issues',
  items: `/v2/p/${LOADED}/collections/issues`,
  params: [{ id: 'team', name: 'Team', type: 'text' }],
}

const PAGE = {
  schema: { fields: [{ id: 'points', name: 'Points', type: 'number' as const }] },
  rows: [{ id: 'a', values: { points: 3 } }, { id: 'b', values: { points: 4 } }],
}

const world = () => {
  const core = makeTestDb()
  const capabilities = new CapabilityRegistry()
  return {
    core,
    env: testEnv({ DB: core.db, ACTIVE_IDENTITY: memoryIdentityStore('owner-1') }),
    options: {
      capabilities,
      core: createCoreServices({ secrets: new SecretService('c'.repeat(64)), db: core.db, activeIdentity: memoryIdentityStore('owner-1') }),
      env: testEnv({ DB: core.db, ACTIVE_IDENTITY: memoryIdentityStore('owner-1') }),
      dataDir: '',
    },
  }
}

afterEach(() => {
  clearRegistrations(LOADED)
  clearRegistrations(COMPILED)
})

describe('the node-side collection read registry', () => {
  it('reads a LOADED plugin’s collection from its manifest descriptor, with declared params as query', async () => {
    const { core, env, options } = world()
    const seen: { method: string; path: string; query: string; userId: string }[] = []
    const plugin: NodePlugin = {
      name: LOADED,
      init: (ctx) => {
        ctx.routes.fetch((request, context) => {
          const url = new URL(request.url)
          seen.push({ method: request.method, path: url.pathname, query: url.search, userId: context.userId })
          return Response.json(PAGE)
        }, { prefix: '/collections' })
      },
    }
    try {
      await initPlugins([plugin], { ...options, loaded: new Map([[LOADED, { permissions: NO_PERMISSIONS, storage, collections: [descriptor] }]]) })
      const page = await readCollection(env, LOADED, 'issues', { team: 'core' }, AbortSignal.timeout(5_000))

      // Mount-relative and GET, exactly the request shape a client would send — and as the node's own
      // service principal, because nobody is here.
      expect(seen).toEqual([{ method: 'GET', path: '/issues', query: '?team=core', userId: 'owner-1' }])
      // Provenance is STAMPED by the host from the contribution that answered. A row never names its
      // own source, even when the source is us.
      expect(page.rows).toEqual([
        { id: 'a', values: { points: 3 }, pluginId: LOADED, collectionId: 'issues' },
        { id: 'b', values: { points: 4 }, pluginId: LOADED, collectionId: 'issues' },
      ])
    } finally {
      core.cleanup()
    }
  })

  it('reads a COMPILED plugin’s collection from its own registration, through the same call', async () => {
    const { core, env, options } = world()
    const plugin: NodePlugin = {
      name: COMPILED,
      init: (ctx) => {
        ctx.routes.fetch(() => Response.json(PAGE), { prefix: '/collections' })
        ctx.collections.register({ collectionId: 'issues', items: `/v2/p/${COMPILED}/collections/issues` })
      },
    }
    try {
      await initPlugins([plugin], options)
      const page = await readCollection(env, COMPILED, 'issues', {}, AbortSignal.timeout(5_000))
      expect(page.rows.map((row) => row.pluginId)).toEqual([COMPILED, COMPILED])
      // Both feeders are in ONE registry and nothing downstream can tell them apart.
      expect(collectionReads().map((read) => read.pluginId)).toContain(COMPILED)
    } finally {
      core.cleanup()
    }
  })

  it('drops an unparseable answer WHOLE rather than row by row', async () => {
    const { core, env, options } = world()
    const plugin: NodePlugin = {
      name: COMPILED,
      init: (ctx) => {
        // One good row and one with no `id` — the field with no fallback.
        ctx.routes.fetch(() => Response.json({ schema: { fields: [] }, rows: [{ id: 'a', values: {} }, { values: {} }] }), { prefix: '/collections' })
        ctx.collections.register({ collectionId: 'issues', items: `/v2/p/${COMPILED}/collections/issues` })
      },
    }
    try {
      await initPlugins([plugin], options)
      // A partially-parsed page is a page whose row count is a property of the parser, and the one
      // number this exists to feed is a count.
      await expect(readCollection(env, COMPILED, 'issues', {}, AbortSignal.timeout(5_000))).rejects.toBeInstanceOf(CollectionReadError)
    } finally {
      core.cleanup()
    }
  })

  it('surfaces a refusing route as a read error rather than an empty page', async () => {
    const { core, env, options } = world()
    const plugin: NodePlugin = {
      name: COMPILED,
      init: (ctx) => {
        ctx.routes.fetch(() => new Response('rate limited', { status: 429 }), { prefix: '/collections' })
        ctx.collections.register({ collectionId: 'issues', items: `/v2/p/${COMPILED}/collections/issues` })
      },
    }
    try {
      await initPlugins([plugin], options)
      // "Could not answer" is a different fact from "answered with none", and the sampler's
      // all-sources-answered gate turns on exactly that difference.
      await expect(readCollection(env, COMPILED, 'issues', {}, AbortSignal.timeout(5_000))).rejects.toBeInstanceOf(CollectionReadError)
    } finally {
      core.cleanup()
    }
  })

  it('refuses a pointer outside the plugin’s own namespace, on every call', async () => {
    const { core, env, options } = world()
    const plugin: NodePlugin = {
      name: COMPILED,
      init: (ctx) => {
        ctx.routes.fetch(() => Response.json(PAGE), { prefix: '/collections' })
        // The confinement rule is what stops a plugin making the host call core's routes, or another
        // plugin's, on its behalf — and it is re-checked at the READ, not only at registration.
        ctx.collections.register({ collectionId: 'sneaky', items: '/v2/core/prefs' })
      },
    }
    try {
      await initPlugins([plugin], options)
      await expect(readCollection(env, COMPILED, 'sneaky', {}, AbortSignal.timeout(5_000))).rejects.toThrow(/must be inside/)
    } finally {
      core.cleanup()
    }
  })

  it('forgets a plugin’s pointers when its registrations are cleared', async () => {
    const { core, env, options } = world()
    const plugin: NodePlugin = {
      name: COMPILED,
      init: (ctx) => {
        ctx.routes.fetch(() => Response.json(PAGE), { prefix: '/collections' })
        ctx.collections.register({ collectionId: 'issues', items: `/v2/p/${COMPILED}/collections/issues` })
      },
    }
    try {
      await initPlugins([plugin], options)
      clearRegistrations(COMPILED)
      // A survivor would have the sampler dispatching at a namespace nothing serves and recording
      // that as an unavailable source forever.
      await expect(readCollection(env, COMPILED, 'issues', {}, AbortSignal.timeout(5_000))).rejects.toBeInstanceOf(CollectionReadError)
    } finally {
      core.cleanup()
    }
  })
})
