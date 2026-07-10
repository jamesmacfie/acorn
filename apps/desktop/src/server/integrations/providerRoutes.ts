import { Hono } from 'hono'
import type { AppEnv } from '../middleware/auth'
import './providers'
import { integrationProviderRegistry } from './registry'

// One core projection for every provider-owned HTTP router. Adding a provider changes only its
// module and the provider activation list; the server composition root never names provider ids.
export const integrationProviderRoutes = new Hono<AppEnv>()

for (const contribution of integrationProviderRegistry.routes()) {
  integrationProviderRoutes.route(contribution.prefix, contribution.router)
}
