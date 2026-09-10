// Activation. Register the connection that holds the DSN, then subscribe to the stream.
//
// That is the whole sink contract: a function passed to `ctx.core.telemetry.onBatch`
// (docs/telemetry.md § Writing a sink). Everything else in this package is what happens to a batch
// after it arrives.
//
// Inert until two things are true at once. The owner has telemetry on, so the collector builds
// records and calls this sink at all, and a Sentry connection exists, so a batch has somewhere to
// go. Either alone sends nothing, and neither is on by default.
import type { Disposable, NodePlugin } from '@acorn/plugin-api/node'
import { createExporter, type Exporter } from '../server/exporter'
import { parseDsn } from '../server/dsn'
import { connectionConfig, createSentryTelemetryProvider } from '../server/provider'
import { DEFAULT_SETTINGS, parseSettings, PROVIDER_ID, SDK_NAME, SDK_VERSION, SETTINGS_KEY } from '../shared/settings'

const SDK = { name: SDK_NAME, version: SDK_VERSION }
/** `sentry_client` in the auth header, and the user agent. Sentry's own convention is
 *  `<name>/<version>`. */
const CLIENT = `${SDK_NAME}/${SDK_VERSION}`

/** 32 lowercase hex characters with no dashes, which is what Sentry means by a uuid4. */
const newId = (): string => globalThis.crypto.randomUUID().replaceAll('-', '')

export const sentryTelemetryPlugin = (): NodePlugin => {
  let exporter: Exporter | null = null
  let subscription: Disposable | null = null
  return {
    name: PROVIDER_ID,
    init: (ctx) => {
      ctx.providers.connection(createSentryTelemetryProvider({ client: CLIENT, sdk: SDK }))

      exporter = createExporter({
        fetch: (...args) => fetch(...args),
        now: () => Date.now(),
        newId,
        client: CLIENT,
        sdk: SDK,
        log: ctx.log,
        telemetry: ctx.telemetry,
        // Consent and the connection are checked again before every delivery attempt.
        target: async () => {
          const userId = ctx.core.identity.active()
          if (!userId || !ctx.core.telemetry.enabled()) return null
          const found = await ctx.providers.withConnection(userId, PROVIDER_ID, async (connection, secret) => {
            const dsn = parseDsn(secret)
            // A stored DSN that no longer parses. Nothing to post it to, and nothing this side can
            // fix, so the export stops until the owner reconnects.
            if (!dsn) return undefined
            const config = connectionConfig(connection.config)
            return {
              dsn,
              ...(config.environment ? { environment: config.environment } : {}),
              ...(config.release ? { release: config.release } : {}),
            }
          })
          return found ?? null
        },
        settings: async () => {
          const userId = ctx.core.identity.active()
          if (!userId) return DEFAULT_SETTINGS
          const raw = await ctx.core.prefs.read(userId, SETTINGS_KEY)
          if (!raw) return DEFAULT_SETTINGS
          try {
            return parseSettings(JSON.parse(raw))
          } catch {
            // The row is written by a sandboxed frame through `bridge.state`, so it is JSON in
            // practice and could be anything in principle.
            return DEFAULT_SETTINGS
          }
        },
      })

      // The host drops this itself on a reload, through `clearRegistrations`. The handle is kept
      // for `dispose`, which is the other way a plugin goes away: a shutdown, where nothing rolls
      // registrations back and a live sink would keep a stopped exporter reachable.
      subscription = ctx.core.telemetry.onBatch((batch) => exporter?.accept(batch))
    },
    dispose: () => {
      subscription?.dispose()
      exporter?.dispose()
    },
  }
}
