import type { Context } from 'hono'
import { getDb } from '../db'
import { forEachConnection, listProviderConnections } from '../integrations/connections'
import { integrationProviderRegistry } from '../integrations/registry'
import { runProviderResource } from '../integrations/resourceRuntime'
import type { AppEnv } from '../middleware/auth'
import { canUseProviderCredential } from '../middleware/requireUser'
import type { PluginProviderRuntime, PluginRequestContext } from './types'

const assertProviderAccess = (c: Context<AppEnv>): void => {
  if (!canUseProviderCredential(c)) {
    throw new Error('Plugin provider runtime requires an interactive device or service credential.')
  }
}

const assertOwnedProvider = (pluginId: string, providerId: string): void => {
  integrationProviderRegistry.assertOwnedBy(providerId, pluginId)
}

// The one construction site for fetch-handler request context. The methods close over host-owned
// services, but their inputs and results are plain data and their call shape can move to RPC without
// widening the plugin contract when loaded plugins move out of process.
export function pluginRequestContext(c: Context<AppEnv>, pluginId: string): PluginRequestContext {
  const principal = c.get('principal')
  if (!principal) throw new Error('Plugin request context requires an authenticated principal.')

  const providers: PluginProviderRuntime = {
    resource: async (args) => {
      assertProviderAccess(c)
      assertOwnedProvider(pluginId, args.providerId)
      return runProviderResource({
        db: getDb(c.env),
        userId: principal.userId,
        secrets: c.env.SECRETS,
        ...args,
      })
    },
    connections: async (providerId) => {
      assertProviderAccess(c)
      assertOwnedProvider(pluginId, providerId)
      return listProviderConnections(getDb(c.env), principal.userId, providerId)
    },
    withConnections: async (providerId, visit) => {
      assertProviderAccess(c)
      assertOwnedProvider(pluginId, providerId)
      return forEachConnection(getDb(c.env), principal.userId, providerId, c.env.SECRETS, visit)
    },
  }

  return { userId: principal.userId, principal, providers }
}
