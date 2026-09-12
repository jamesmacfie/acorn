import { fileURLToPath } from 'node:url'
import { makeTestNodeContext, seedProviderConnection, validatePluginConfig } from '@acorn/plugin-api/testkit'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sentryTelemetryPlugin } from './index'
import { PROVIDER_ID, SETTINGS_KEY } from '../shared/settings'

// The whole path, through the real host: a plugin context built by the same code the node builds
// one with, a real connection row, the real collector, and a fake `fetch` at the far end
// (docs/plugins.md § The plugin API).
const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const OWNER = 'owner-1'
const DSN = 'https://abc123@o42.ingest.us.sentry.io/1234567'

// The grant this suite runs under is the one the manifest declares, so dropping `telemetry`,
// `prefs` or `identity` from acorn-plugin.config.mjs fails here rather than at the next boot.
const declaredPermissions = async () => {
  const config = await validatePluginConfig(PACKAGE_ROOT)
  if (!config.ok) throw new Error(config.reason)
  return config.manifest.permissions.node
}

const posted = () => (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
  .map((call) => String((call[1] as RequestInit).body))

const itemTypes = () => posted().map((body) => JSON.parse(body.split('\n')[1]).type as string)

async function world(options: { connected?: boolean } = {}) {
  const ctx = makeTestNodeContext({ plugin: sentryTelemetryPlugin(), permissions: await declaredPermissions(), userId: OWNER })
  if (options.connected !== false) {
    await seedProviderConnection(ctx.db, PROVIDER_ID, OWNER, DSN, ctx.encryptionKey, 'api-key')
  }
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })))
  const plugin = sentryTelemetryPlugin()
  await plugin.init(ctx)
  return { ctx, plugin }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the sentry-telemetry plugin', () => {
  it('registers one connection provider and no routes', async () => {
    const { ctx, plugin } = await world()
    try {
      // A loaded plugin gets no live Hono seam, and this one contributes no route either way: it
      // reads the stream and posts, and shows nothing of its own.
      expect(ctx.routes.register).toBeUndefined()
      expect(ctx.core.telemetry.onBatch).toBeTypeOf('function')
    } finally {
      await plugin.dispose?.()
      ctx.cleanup()
    }
  })

  it('turns what this node collects into envelopes', async () => {
    const { ctx, plugin } = await world()
    try {
      ctx.log.warn('upstream rate limited', { retryAfter: 30 })
      ctx.telemetry.event('cache.miss', { resource: 'issues' })
      ctx.telemetry.count('sync.fresh', 2)
      // Reading the recorder flushes the collector, which is what hands the batch to every sink
      // including this plugin's (docs/plugin-authoring.md § In tests).
      expect(ctx.recorded.length).toBeGreaterThan(0)

      await vi.waitFor(() => expect(itemTypes()).toContain('log'))
      await vi.waitFor(() => expect(itemTypes()).toContain('trace_metric'))

      const [url, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://o42.ingest.us.sentry.io/api/1234567/envelope/')
      expect(init.headers).toMatchObject({ 'content-type': 'application/x-sentry-envelope' })
      // The credential authenticates the post and appears nowhere in the payload it authenticates.
      const logEnvelope = posted().find((body) => JSON.parse(body.split('\n')[1]).type === 'log')!
      expect(logEnvelope).toContain('upstream rate limited')
      expect(logEnvelope.split('\n').slice(2).join('\n')).not.toContain('abc123')
    } finally {
      await plugin.dispose?.()
      ctx.cleanup()
    }
  })

  it('sends nothing while no DSN is connected', async () => {
    const { ctx, plugin } = await world({ connected: false })
    try {
      ctx.log.info('a line nobody asked to export')
      expect(ctx.recorded.length).toBeGreaterThan(0)
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(globalThis.fetch).not.toHaveBeenCalled()
    } finally {
      await plugin.dispose?.()
      ctx.cleanup()
    }
  })

  it('honours the kinds the owner switched off on the settings page', async () => {
    const { ctx, plugin } = await world()
    try {
      // The same row the settings frame writes through `bridge.state`, scoped by the host to
      // `plugin:sentry-telemetry:settings`.
      await ctx.core.prefs.write(OWNER, SETTINGS_KEY, JSON.stringify({ kinds: { log: false } }))
      ctx.log.warn('a line the owner turned off')
      ctx.telemetry.count('sync.fresh', 1)
      expect(ctx.recorded.length).toBeGreaterThan(0)

      await vi.waitFor(() => expect(itemTypes()).toContain('trace_metric'))
      expect(itemTypes()).not.toContain('log')
    } finally {
      await plugin.dispose?.()
      ctx.cleanup()
    }
  })

  it('stops posting after dispose', async () => {
    const { ctx, plugin } = await world()
    try {
      await plugin.dispose?.()
      ctx.log.info('after the plugin went away')
      expect(ctx.recorded.length).toBeGreaterThan(0)
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(globalThis.fetch).not.toHaveBeenCalled()
    } finally {
      ctx.cleanup()
    }
  })
})
