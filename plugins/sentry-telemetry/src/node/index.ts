// Activation. Register the connection that holds the DSN, then subscribe to the stream.
//
// That is the whole sink contract: a function passed to `ctx.core.telemetry.onBatch`
// (docs/telemetry/plugins-and-sinks.md § Writing a sink). Everything else in this package is what happens to a batch
// after it arrives.
//
// Inert until two things are true at once. The owner has telemetry on, so the collector builds
// records and calls this sink at all, and a DSN exists, so a batch has somewhere to go. Either
// alone sends nothing, and neither is on by default.
//
// The DSN comes from a Sentry connection in Settings, then from `ACORN_SENTRY_DSN` in the
// environment that started the node, then from the acorn team's DSN when the build carries one and
// the owner turned on **Share with the acorn team**. The connection wins, so a person can point at
// their own project without unsetting anything
// (docs/integrations/sentry/the-acorn-teams-dsn.md § The resolution order).
import type { Disposable, NodePlugin, PluginFetchHandler } from '@acorn/plugin-api/node'
import { createExporter, type Exporter, type SentryTarget } from '../server/exporter'
import { describeDsn, parseDsn, type SentryDsn } from '../server/dsn'
import { connectionConfig, createSentryTelemetryProvider } from '../server/provider'
import {
  DEFAULT_SETTINGS,
  parseSettings,
  PROVIDER_ID,
  SDK_NAME,
  SDK_VERSION,
  SETTINGS_KEY,
  SHARE_KEY,
  TEAM_SETTINGS,
} from '../shared/settings'

// The acorn team's DSN. apps/node/scripts/build-plugin.mjs writes it in from
// `ACORN_SENTRY_RELEASE_DSN`, which only the tag build sets, so every other build carries an empty
// string, and source run from a checkout has no constant at all.
declare const __ACORN_SENTRY_RELEASE_DSN__: string | undefined

const SDK = { name: SDK_NAME, version: SDK_VERSION }
/** `sentry_client` in the auth header, and the user agent. Sentry's own convention is
 *  `<name>/<version>`. */
const CLIENT = `${SDK_NAME}/${SDK_VERSION}`

/** 32 lowercase hex characters with no dashes, which is what Sentry means by a uuid4. */
const newId = (): string => globalThis.crypto.randomUUID().replaceAll('-', '')

const ENV_DSN = 'ACORN_SENTRY_DSN'

export const sentryTelemetryPlugin = (): NodePlugin => {
  let exporter: Exporter | null = null
  let subscription: Disposable | null = null
  return {
    name: PROVIDER_ID,
    init: (ctx) => {
      ctx.providers.connection(createSentryTelemetryProvider({ client: CLIENT, sdk: SDK }))

      // A worker's environment is fixed when it starts, so this is read once.
      const raw = process.env[ENV_DSN]?.trim()
      const environmentDsn: SentryDsn | null = raw ? parseDsn(raw) : null
      // The value is a credential, so the warning names the variable and nothing else.
      if (raw && !environmentDsn) ctx.log.warn(`${ENV_DSN} is not a Sentry DSN, so nothing is sent to it`)
      const teamDsn = typeof __ACORN_SENTRY_RELEASE_DSN__ === 'string' ? parseDsn(__ACORN_SENTRY_RELEASE_DSN__) : null
      // The release names the node's version, which only a batch carries. Every batch reaches the
      // exporter through `onBatch` below before a target is asked for.
      let nodeVersion = ''

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
          const found = await ctx.providers.withConnection<SentryTarget | null>(
            userId,
            PROVIDER_ID,
            async (connection, secret) => {
              const dsn = parseDsn(secret)
              // A stored DSN that no longer parses. Nothing to post it to, and nothing this side can
              // fix, so the export stops until the owner reconnects. Null, not undefined, so a
              // broken connection still wins over the environment.
              if (!dsn) return null
              const config = connectionConfig(connection.config)
              return {
                dsn,
                ...(config.environment ? { environment: config.environment } : {}),
                ...(config.release ? { release: config.release } : {}),
              }
            },
          )
          if (found !== undefined) return found
          // A value that doesn't parse still wins over the team's DSN, as a broken connection does.
          if (raw) {
            return environmentDsn
              ? { dsn: environmentDsn, environment: 'development', release: `acorn@${nodeVersion}` }
              : null
          }
          if (!teamDsn || (await ctx.core.prefs.read(userId, SHARE_KEY)) !== 'true') return null
          return {
            dsn: teamDsn,
            environment: 'production',
            release: `acorn@${nodeVersion}`,
            settings: TEAM_SETTINGS,
            officialOnly: true,
          }
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
      subscription = ctx.core.telemetry.onBatch((batch) => {
        nodeVersion = batch.version
        exporter?.accept(batch)
      })

      // What the settings page says about where records go. A connection is drawn in Services, so
      // `environment` answers only for the environment's DSN, and only while no connection
      // overrides it. `shareable` says the team's DSN is the one **Share with the acorn team** would
      // turn on, so the page shows that switch.
      const source: PluginFetchHandler = async (request, context) => {
        if (new URL(request.url, 'http://node').pathname !== '/source' || request.method !== 'GET') {
          return new Response(null, { status: 404 })
        }
        const connected = (await context.providers.connections(PROVIDER_ID)).length > 0
        return Response.json({
          environment: environmentDsn && !connected ? describeDsn(environmentDsn) : null,
          shareable: teamDsn !== null && !raw && !connected,
        })
      }
      ctx.routes.fetch(source, { prefix: '', note: '/source: where records go when no connection decides' })
    },
    dispose: () => {
      subscription?.dispose()
      exporter?.dispose()
    },
  }
}
