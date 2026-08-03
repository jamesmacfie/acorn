import { Hono } from 'hono'
import type { AppEnv } from '../middleware/auth'
import { requireProviderAccess } from '../middleware/requireUser'
import { integrationProviderRegistry } from './registry'

// One core projection for every provider-owned HTTP router. Adding a provider changes only its
// module and the provider activation list (app/server/providers.ts); the server composition root
// never names provider ids. Built lazily at createApp() time so the registry is already populated
// by the composition root — core never imports the plugin/app activation that registers providers.
//
// The returned app is mounted at PLUGIN_NAMESPACE, and each router lands under its own provider id:
// an integration provider IS a plugin (docs/vNext/protocol.md § HTTP conventions), so `linear`'s
// routes answer at /v2/p/linear/*.
export function buildIntegrationProviderRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  for (const contribution of integrationProviderRegistry.routes()) {
    // Every provider router spends a stored credential (linear's GraphQL key, rollbar's token), so a
    // task-scoped internal credential — the one an agent holds — must not reach any of them. Gating the
    // projection rather than each plugin means a newly registered provider is covered on the day it is
    // added, and it cannot be forgotten in a plugin that only later starts using its connection.
    //
    // An adversarial review confirmed the hole: a task-scoped token reached /v2/p/linear/* and spent the
    // owner's Linear key. requireProviderAccess is device ∪ 'service' scope, so the node's own loopback
    // mirror refreshes still work.
    const guarded = new Hono<AppEnv>().use('*', requireProviderAccess).route('/', contribution.router)
    app.route(`/${contribution.providerId}${contribution.prefix}`, guarded)
  }
  return app
}
