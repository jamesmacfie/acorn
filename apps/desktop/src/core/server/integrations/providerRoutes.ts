import { Hono } from 'hono'
import type { AppEnv } from '../middleware/auth'
import { integrationProviderRegistry } from './registry'

// One core projection for every provider-owned HTTP router. Adding a provider changes only its
// module and the provider activation list (app/server/providers.ts); the server composition root
// never names provider ids. Built lazily at createApp() time so the registry is already populated
// by the composition root — core never imports the plugin/app activation that registers providers.
export function buildIntegrationProviderRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  for (const contribution of integrationProviderRegistry.routes()) {
    app.route(contribution.prefix, contribution.router)
  }
  return app
}
