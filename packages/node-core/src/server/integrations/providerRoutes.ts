import { Hono } from 'hono'
import type { AppEnv } from '../middleware/auth'
import { requireProviderAccess } from '../middleware/requireUser'
import { integrationProviderRegistry } from './registry'
import { PLUGIN_NAMESPACE } from '../routeRegistry'
import { servePluginFetch } from '../plugin/fetchRoute'

// One core projection for every provider-owned HTTP router, mounted at PLUGIN_NAMESPACE under each
// provider's own id (docs/integrations.md § Connection lifecycle; docs/api-reference.md § HTTP
// conventions). Built lazily at createApp() time, after the provider activation list
// (app/server/providers.ts) has populated the registry, so core itself never imports plugin
// activation code.
export function buildIntegrationProviderRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  for (const contribution of integrationProviderRegistry.routes()) {
    // Every provider router spends a stored credential, so a task-scoped internal caller must not
    // reach any of them (docs/integrations.md § Connection lifecycle). Gating the projection covers
    // a newly registered provider automatically. `requireProviderAccess` accepts device or
    // 'service' scope, so the node's own loopback mirror refreshes still work.
    const relativeMount = `/${contribution.providerId}${contribution.prefix}`
    const guarded = new Hono<AppEnv>().use('*', requireProviderAccess)
    if (contribution.router) {
      guarded.route('/', contribution.router)
    } else {
      const pluginId = integrationProviderRegistry.ownerOf(contribution.providerId) ?? contribution.providerId
      const serve = (c: Parameters<typeof servePluginFetch>[0]) => servePluginFetch(c, {
        pluginId,
        mount: `${PLUGIN_NAMESPACE}${relativeMount}`,
        fetch: contribution.fetch,
      })
      guarded.all('/', serve)
      guarded.all('/*', serve)
    }
    app.route(relativeMount, guarded)
  }
  return app
}
