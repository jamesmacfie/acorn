import { describe, expect, it } from 'vitest'
import { schema } from '../server/db'
import { makeTestNodeContext, makeTestRequestContext } from './pluginContext'

// The testkit's own suite: what it asserts is that a test context and the boot context are the
// same object, so these expectations break when server/plugin/context.ts changes. A plugin's
// forged literal never could.
const plugin = { name: 'testkit-probe' }

describe('makeTestNodeContext', () => {
  it('gives a built-in the full context, storage included', () => {
    const ctx = makeTestNodeContext({ plugin })
    try {
      expect(ctx.name).toBe('testkit-probe')
      // The live Hono seam and the two singly-owned event slots: built-ins only.
      expect(ctx.routes.register).toBeTypeOf('function')
      expect(ctx.events.channel).toBeTypeOf('function')
      expect(ctx.events.streams).toBeTypeOf('function')
      // Unscoped core, all facets present.
      expect(ctx.core.secrets).toBeDefined()
      expect(ctx.core.proc).toBeDefined()
      // Both tiers get the seam now: a built-in that declares `migrationsModule` opens its database
      // through the host too.
      expect(ctx.storage.open).toBeTypeOf('function')
    } finally {
      ctx.cleanup()
    }
  })

  it('shapes a loaded plugin from its manifest permissions', () => {
    const ctx = makeTestNodeContext({ plugin, permissions: { core: ['projects:read'] } })
    try {
      expect(ctx.routes.register).toBeUndefined()
      expect(ctx.routes.fetch).toBeTypeOf('function')
      expect(ctx.events.channel).toBeUndefined()
      expect(ctx.events.streams).toBeUndefined()
      // Granted, and gated by omission: `secrets: false` and no `exec` mean those facets are absent
      // rather than throwing (main/pluginPermissions.ts).
      expect(ctx.core.projects.byId).toBeTypeOf('function')
      expect(ctx.core.secrets).toBeUndefined()
      expect(ctx.core.proc).toBeUndefined()
      expect(ctx.storage.open).toBeTypeOf('function')
    } finally {
      ctx.cleanup()
    }
  })

  it('says which knob is missing when there is no migration chain to find', () => {
    // 'testkit-probe' is not a plugin in this checkout, so the id-based default finds nothing. That
    // is also what a plugin developed outside this repo hits, and the message has to name the way out.
    const ctx = makeTestNodeContext({ plugin, permissions: {} })
    try {
      expect(() => ctx.storage.open()).toThrow(/plugins\/testkit-probe\/migrations/)
      expect(() => ctx.storage.open()).toThrow(/Pass \{ migrations \}/)
    } finally {
      ctx.cleanup()
    }
  })

  it('resolves a workspace plugin\'s chain from its id alone', () => {
    // The default that replaced twenty `migrationsDir()` call sites: a real chain, really migrated, with
    // the test naming nothing but the plugin id.
    const ctx = makeTestNodeContext({ plugin: { name: 'memory' } })
    try {
      const db = ctx.storage.open()
      expect(db.batch).toBeTypeOf('function')
      // Same handle on a second call, as in production.
      expect(ctx.storage.open()).toBe(db)
    } finally {
      ctx.cleanup()
    }
  })

  it('hands back a migrated core database and bindings a route test can use', async () => {
    const ctx = makeTestNodeContext({ plugin })
    try {
      // Migrated, not merely open: core's own tables answer a query.
      expect(await ctx.db.select().from(schema.workspaces)).toEqual([])
      expect(ctx.env.DB).toBe(ctx.db)
      expect(ctx.env.SECRETS).toBeDefined()
    } finally {
      ctx.cleanup()
    }
  })
})

describe('makeTestRequestContext', () => {
  it('builds the host request context and refuses a provider the plugin does not own', async () => {
    const context = await makeTestRequestContext({ plugin: 'testkit-probe' })
    expect(context.userId).toBe('owner-1')
    expect(context.principal).toMatchObject({ kind: 'device', deviceId: 'device-1' })
    // The real ownership check, from the real registry: this plugin registered no provider, so it may
    // not spend one's credential. A hand-built literal could not fail this.
    await expect(context.providers.connections('someone-elses-provider')).rejects.toThrow()
  })

  it('takes canned provider answers without giving up the rest of the runtime', async () => {
    const context = await makeTestRequestContext({
      plugin: 'testkit-probe',
      providers: { connections: async () => [] },
    })
    expect(await context.providers.connections('anything')).toEqual([])
    await expect(context.providers.withConnections('anything', async () => undefined)).rejects.toThrow()
  })
})
