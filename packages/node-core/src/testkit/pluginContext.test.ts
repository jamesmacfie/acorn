import { describe, expect, it } from 'vitest'
import type { TelemetryRecord } from '@acorn/protocol/telemetry.ts'
import { schema } from '../server/db'
import { flushTelemetry, onTelemetryBatch, resetTelemetryForTest, startTelemetry } from '../server/telemetry/collector'
import { makeTestNodeContext, makeTestRequestContext } from './pluginContext'

// The testkit's own suite: what it asserts is that a test context and the boot context are the
// same object, so these expectations break when server/pluginHost/context.ts changes. A plugin's
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

  it('binds telemetry and the logger to the plugin, on both tiers and with no grant', async () => {
    resetTelemetryForTest()
    const seen: TelemetryRecord[] = []
    startTelemetry({ node: 'node-1', version: '9', readPref: async () => '1' })
    onTelemetryBatch((batch) => seen.push(...batch.records))
    for (let index = 0; index < 5; index += 1) await Promise.resolve()

    const builtIn = makeTestNodeContext({ plugin })
    const loaded = makeTestNodeContext({ plugin, permissions: {} })
    try {
      for (const ctx of [builtIn, loaded]) {
        expect(ctx.telemetry.event).toBeTypeOf('function')
        expect(ctx.log.info).toBeTypeOf('function')
      }
      builtIn.telemetry.event('cache-miss')
      flushTelemetry()
      // The owner is closed over by the host, so a plugin cannot file under another's name.
      expect(seen.filter((record) => record.kind === 'event').map((record) => record.attrs.owner)).toEqual(['testkit-probe'])
    } finally {
      loaded.cleanup()
      builtIn.cleanup()
      resetTelemetryForTest()
    }
  })

  it('records what the plugin emitted, with no sink of the test\'s own', () => {
    // The recorder is the reason a plugin test does not stand up the collector by hand: three
    // suites used to (docs/plugin-authoring.md § In tests).
    const ctx = makeTestNodeContext({ plugin })
    try {
      ctx.telemetry.measure('reindex', () => 41 + 1)
      ctx.log.warn('upstream rate limited', { retryAfter: 30 })
      ctx.telemetry.startSpan('sweep').end('error')

      const spans = ctx.recorded.filter((record) => record.kind === 'span')
      expect(spans.map((span) => [span.name, span.status])).toEqual([['sweep', 'error']])
      const logs = ctx.recorded.filter((record) => record.kind === 'log')
      expect(logs[0]).toMatchObject({ level: 'warn', logger: 'testkit-probe', body: 'upstream rate limited' })
      expect(logs[0].attrs).toMatchObject({ owner: 'testkit-probe', retryAfter: 30 })
      // `measure` is a histogram and not a span, which is the model's rule for a hot seam: it
      // arrives folded, on the flush that reading `recorded` performs.
      const histogram = ctx.recorded.find((record) => record.kind === 'metric' && record.name === 'reindex')
      expect(histogram).toMatchObject({ type: 'histogram', attrs: { owner: 'testkit-probe' } })
    } finally {
      ctx.cleanup()
    }
  })

  it('stops recording once the context is cleaned up', () => {
    const ctx = makeTestNodeContext({ plugin })
    ctx.telemetry.event('before')
    const seen = [...ctx.recorded]
    ctx.cleanup()
    // The sink went with the rest of this plugin's registrations, so a stray emit afterwards
    // reaches nothing (server/pluginHost/host.ts § clearRegistrations).
    ctx.telemetry.event('after')
    expect(seen.map((record) => record.kind === 'event' && record.name)).toEqual(['before'])
    expect(ctx.recorded).toHaveLength(seen.length)
  })

  it('gives the telemetry read facet only to a plugin that asked for the token', () => {
    const without = makeTestNodeContext({ plugin, permissions: {} })
    const with_ = makeTestNodeContext({ plugin, permissions: { core: ['telemetry'] } })
    try {
      // Reading the stream is every owner's records, which is why it is a token where writing is not.
      expect(without.core.telemetry).toBeUndefined()
      expect(with_.core.telemetry.onBatch).toBeTypeOf('function')
    } finally {
      with_.cleanup()
      without.cleanup()
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
      // rather than throwing (server/plugins/permissions.ts).
      expect(ctx.core.projects.byId).toBeTypeOf('function')
      expect(ctx.core.secrets).toBeUndefined()
      expect(ctx.core.proc).toBeUndefined()
      expect(ctx.storage.open).toBeTypeOf('function')
    } finally {
      ctx.cleanup()
    }
  })

  it('confines a loaded plugin\'s broadcast to its own channel namespace', () => {
    // `send` used to be handed over raw, which let a loaded package post on `term:` or `workflow:` and
    // impersonate core's own streams. The confinement is also the definition of the namespace its frames
    // may subscribe to (client-core/host/plugins/pluginChannel.ts).
    const ctx = makeTestNodeContext({ plugin, permissions: {} })
    try {
      expect(() => ctx.events.send({ channel: 'plugin:testkit-probe:sample', cpu: 1 })).not.toThrow()
      expect(() => ctx.events.send({ channel: 'term:status' })).toThrow(/may only broadcast on plugin:testkit-probe:/)
      expect(() => ctx.events.send({ channel: 'plugin:someone-else:sample' })).toThrow(/may only broadcast on/)
      // A name that does not parse is refused too, rather than treated as this plugin's because it
      // starts with the right word.
      expect(() => ctx.events.send({ channel: 'plugin:testkit-probe' })).toThrow(/may only broadcast on/)
    } finally {
      ctx.cleanup()
    }
  })

  it('leaves a built-in\'s broadcast alone, because it owns real prefixes', () => {
    const ctx = makeTestNodeContext({ plugin })
    try {
      expect(() => ctx.events.send({ channel: 'term:status' })).not.toThrow()
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
