import { fileURLToPath } from 'node:url'
import type { PluginFetchHandler } from '@acorn/plugin-api/node'
import {
  makeTestNodeContext,
  makeTestRequestContext,
  seedProviderConnection,
  validatePluginConfig,
} from '@acorn/plugin-api/testkit'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sentryTelemetryPlugin } from './index'
import { PROVIDER_ID, SETTINGS_KEY, SHARE_KEY } from '../shared/settings'

// The whole path, through the real host: a plugin context built by the same code the node builds
// one with, a real connection row, the real collector, and a fake `fetch` at the far end
// (docs/plugins/plugin-api.md § The plugin API).
const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const OWNER = 'owner-1'
const DSN = 'https://abc123@o42.ingest.us.sentry.io/1234567'
const ENV_DSN = 'https://def456@o7.ingest.de.sentry.io/7654321'
const TEAM_DSN = 'https://fed789@o9.ingest.us.sentry.io/9999999'
const TEAM_URL = 'https://o9.ingest.us.sentry.io/api/9999999/envelope/'

// The grant this suite runs under is the one the manifest declares, so dropping `telemetry`,
// `prefs` or `identity` from acorn-plugin.config.mjs fails here rather than at the next boot.
const declaredPermissions = async () => {
  const config = await validatePluginConfig(PACKAGE_ROOT)
  if (!config.ok) throw new Error(config.reason)
  return config.manifest.permissions.node
}

const posted = () =>
  (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((call) =>
    String((call[1] as RequestInit).body),
  )

const itemTypes = () => posted().map((body) => JSON.parse(body.split('\n')[1]).type as string)

const postedUrls = () =>
  (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((call) => String(call[0]))

/** The payload of the first `event` item posted, which is how an error record reaches Sentry. */
const postedError = () => {
  const body = posted().find((envelope) => JSON.parse(envelope.split('\n')[1]).type === 'event')
  return body ? JSON.parse(body.split('\n')[2]) : undefined
}

const throwAndRecord = (ctx: Awaited<ReturnType<typeof world>>['ctx']) => {
  try {
    throw new TypeError('a test failure')
  } catch (error) {
    const thrown = error as Error
    ctx.telemetry.error({ name: thrown.name, message: thrown.message, stack: thrown.stack, handled: true })
  }
}

async function world(options: { connected?: boolean; environment?: string; team?: string } = {}) {
  // Always stated, so a developer's own `ACORN_SENTRY_DSN` never leaks into a test.
  vi.stubEnv('ACORN_SENTRY_DSN', options.environment)
  // What build-plugin.mjs writes in for the tag build. Source has no constant at all.
  if (options.team !== undefined) vi.stubGlobal('__ACORN_SENTRY_RELEASE_DSN__', options.team)
  const ctx = makeTestNodeContext({
    plugin: sentryTelemetryPlugin(),
    permissions: await declaredPermissions(),
    userId: OWNER,
  })
  if (options.connected !== false) {
    await seedProviderConnection(ctx.db, PROVIDER_ID, OWNER, DSN, ctx.encryptionKey, 'api-key')
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 200 })),
  )
  let source: PluginFetchHandler | undefined
  const registerRoute = ctx.routes.fetch
  vi.spyOn(ctx.routes, 'fetch').mockImplementation((handler, routeOptions) => {
    source = handler
    registerRoute(handler, routeOptions)
  })
  const plugin = sentryTelemetryPlugin()
  await plugin.init(ctx)
  const readSource = async () => {
    const context = await makeTestRequestContext({ plugin: PROVIDER_ID, env: ctx.env })
    return (await source!(new Request('http://node/source'), context)).json()
  }
  return { ctx, plugin, readSource }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('the sentry-telemetry plugin', () => {
  it('registers one connection provider and no Hono routes', async () => {
    const { ctx, plugin } = await world()
    try {
      // A loaded plugin gets no live Hono seam. Its one route is a fetch handler for the settings
      // page.
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
      // including this plugin's (docs/plugin-authoring/testing.md § In tests).
      expect(ctx.recorded.length).toBeGreaterThan(0)

      await vi.waitFor(() => expect(itemTypes()).toContain('log'))
      await vi.waitFor(() => expect(itemTypes()).toContain('trace_metric'))

      const [url, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        RequestInit,
      ]
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

  describe('with ACORN_SENTRY_DSN set', () => {
    it('sends a thrown error to that project, tagged development', async () => {
      const { ctx, plugin } = await world({ connected: false, environment: ENV_DSN })
      try {
        throwAndRecord(ctx)
        expect(ctx.recorded.length).toBeGreaterThan(0)

        await vi.waitFor(() => expect(postedError()).toBeDefined())
        expect(postedUrls()).toContain('https://o7.ingest.de.sentry.io/api/7654321/envelope/')
        expect(postedError()).toMatchObject({ environment: 'development', release: expect.stringMatching(/^acorn@.+/) })
      } finally {
        await plugin.dispose?.()
        ctx.cleanup()
      }
    })

    it('sends nothing while collection is off', async () => {
      const { ctx, plugin } = await world({ connected: false, environment: ENV_DSN })
      try {
        vi.spyOn(ctx.core.telemetry, 'enabled').mockReturnValue(false)
        throwAndRecord(ctx)
        expect(ctx.recorded.length).toBeGreaterThan(0)
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(globalThis.fetch).not.toHaveBeenCalled()
      } finally {
        await plugin.dispose?.()
        ctx.cleanup()
      }
    })

    it('lets a Settings connection win', async () => {
      const { ctx, plugin, readSource } = await world({ environment: ENV_DSN })
      try {
        throwAndRecord(ctx)
        expect(ctx.recorded.length).toBeGreaterThan(0)

        await vi.waitFor(() => expect(postedError()).toBeDefined())
        expect(new Set(postedUrls())).toEqual(new Set(['https://o42.ingest.us.sentry.io/api/1234567/envelope/']))
        expect(postedError()?.environment).toBeUndefined()
        // The page has nothing to say about the environment while the connection overrides it.
        expect(await readSource()).toEqual({ environment: null, shareable: false })
      } finally {
        await plugin.dispose?.()
        ctx.cleanup()
      }
    })

    it('tells the settings page where records go, without the key', async () => {
      const { ctx, plugin, readSource } = await world({ connected: false, environment: ENV_DSN })
      try {
        expect(await readSource()).toEqual({ environment: 'o7.ingest.de.sentry.io/7654321', shareable: false })
      } finally {
        await plugin.dispose?.()
        ctx.cleanup()
      }
    })

    it('warns once about a value that is not a DSN, never quoting it, and sends nothing', async () => {
      const { ctx, plugin, readSource } = await world({ connected: false, environment: 'not-a-dsn-secret' })
      try {
        throwAndRecord(ctx)
        const warnings = ctx.recorded.filter((record) => record.kind === 'log' && record.level === 'warn')
        const about = warnings.filter((record) => record.kind === 'log' && record.body.includes('ACORN_SENTRY_DSN'))
        expect(about).toHaveLength(1)
        expect(JSON.stringify(ctx.recorded)).not.toContain('not-a-dsn-secret')
        expect(await readSource()).toEqual({ environment: null, shareable: false })
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(globalThis.fetch).not.toHaveBeenCalled()
      } finally {
        await plugin.dispose?.()
        ctx.cleanup()
      }
    })
  })

  describe("with the acorn team's DSN built in", () => {
    const share = (ctx: Awaited<ReturnType<typeof world>>['ctx'], on: boolean) =>
      ctx.core.prefs.write(OWNER, SHARE_KEY, JSON.stringify(on))

    it('sends a thrown error to the team, tagged production, under the fixed policy', async () => {
      const { ctx, plugin, readSource } = await world({ connected: false, team: TEAM_DSN })
      try {
        expect(await readSource()).toEqual({ environment: null, shareable: true })
        await share(ctx, true)
        ctx.log.warn('a line the fixed policy never sends')
        throwAndRecord(ctx)
        expect(ctx.recorded.length).toBeGreaterThan(0)

        await vi.waitFor(() => expect(postedError()).toBeDefined())
        expect(new Set(postedUrls())).toEqual(new Set([TEAM_URL]))
        expect(postedError()).toMatchObject({ environment: 'production', release: expect.stringMatching(/^acorn@.+/) })
        expect(itemTypes()).not.toContain('log')
      } finally {
        await plugin.dispose?.()
        ctx.cleanup()
      }
    })

    it('sends nothing until the owner shares', async () => {
      const { ctx, plugin } = await world({ connected: false, team: TEAM_DSN })
      try {
        throwAndRecord(ctx)
        expect(ctx.recorded.length).toBeGreaterThan(0)
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(globalThis.fetch).not.toHaveBeenCalled()
      } finally {
        await plugin.dispose?.()
        ctx.cleanup()
      }
    })

    it('sends nothing while collection is off, even when shared', async () => {
      const { ctx, plugin } = await world({ connected: false, team: TEAM_DSN })
      try {
        await share(ctx, true)
        vi.spyOn(ctx.core.telemetry, 'enabled').mockReturnValue(false)
        throwAndRecord(ctx)
        expect(ctx.recorded.length).toBeGreaterThan(0)
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(globalThis.fetch).not.toHaveBeenCalled()
      } finally {
        await plugin.dispose?.()
        ctx.cleanup()
      }
    })

    it('lets ACORN_SENTRY_DSN win, and hides the switch', async () => {
      const { ctx, plugin, readSource } = await world({ connected: false, environment: ENV_DSN, team: TEAM_DSN })
      try {
        await share(ctx, true)
        expect(await readSource()).toEqual({ environment: 'o7.ingest.de.sentry.io/7654321', shareable: false })
        throwAndRecord(ctx)
        expect(ctx.recorded.length).toBeGreaterThan(0)
        await vi.waitFor(() => expect(postedError()).toBeDefined())
        expect(postedUrls()).not.toContain(TEAM_URL)
      } finally {
        await plugin.dispose?.()
        ctx.cleanup()
      }
    })

    it('lets a Settings connection win, and hides the switch', async () => {
      const { ctx, plugin, readSource } = await world({ team: TEAM_DSN })
      try {
        await share(ctx, true)
        expect(await readSource()).toEqual({ environment: null, shareable: false })
        throwAndRecord(ctx)
        expect(ctx.recorded.length).toBeGreaterThan(0)
        await vi.waitFor(() => expect(postedError()).toBeDefined())
        expect(postedUrls()).not.toContain(TEAM_URL)
      } finally {
        await plugin.dispose?.()
        ctx.cleanup()
      }
    })

    it('offers no switch in a build with an empty DSN', async () => {
      const { ctx, plugin, readSource } = await world({ connected: false, team: '' })
      try {
        expect(await readSource()).toEqual({ environment: null, shareable: false })
      } finally {
        await plugin.dispose?.()
        ctx.cleanup()
      }
    })
  })

  it('with ACORN_SENTRY_DSN unset, tells the settings page nothing', async () => {
    const { ctx, plugin, readSource } = await world({ connected: false })
    try {
      expect(await readSource()).toEqual({ environment: null, shareable: false })
    } finally {
      await plugin.dispose?.()
      ctx.cleanup()
    }
  })
})
