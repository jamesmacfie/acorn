import type { Context } from 'hono'
import type { Env } from '../bindings'
import { getDb } from '../db'
import { forEachConnection, getConnection, listProviderConnections } from '../integrations/connections'
import { connectionProviderRegistry } from '../integrations/connectionProviders/registry'
import { integrationProviderRegistry } from '../integrations/registry'
import { createExternalItemStore } from '../integrations/itemStore'
import { runProviderResource } from '../integrations/resourceRuntime'
import type { AppEnv, Principal } from '../middleware/auth'
import { principalMayUseProviderCredential } from '../middleware/requireUser'
import type { PluginProviderRuntime, PluginRequestContext } from './types'
import { invocationOwned } from '../plugins/rpcOwnership'

const assertProviderAccess = (principal: Principal): void => {
  if (!principalMayUseProviderCredential(principal)) {
    throw new Error('Plugin provider runtime requires an interactive device or service credential.')
  }
}

// Two ownership questions, because two registries answer them.
//
// A mirrored resource and the external-item store only exist on an *integration* provider, so those
// two ask the narrower registry. Reading a connection and spending its credential belong to the
// connection contribution, which every provider has, so those ask the wider one. Asking the narrow
// registry there would refuse a plugin the use of its own credential whenever it mirrors nothing:
// the model providers and the Sentry exporter are both in that position.
const assertOwnedProvider = (pluginId: string, providerId: string): void => {
  integrationProviderRegistry.assertOwnedBy(providerId, pluginId)
}

const assertOwnedCredential = (pluginId: string, providerId: string): void => {
  connectionProviderRegistry.assertOwnedBy(providerId, pluginId)
}

// The one construction site for fetch-handler request context. The methods close over host-owned
// services, but their inputs and results are plain data and their call shape can move to RPC without
// widening the plugin contract when loaded plugins move out of process.
//
// Env + Principal rather than a Hono Context, because a scheduled run has neither a request nor a
// route (server/pluginHost/scheduleRun.ts). The two arguments are exactly what the Hono form read off `c`,
// so the scheduled path gets the same runtime and the same ownership checks as an HTTP one, including
// the provider-credential gate, which a background run passes as the node's own 'service' principal.
export type PluginConnectionScope = { providerId?: string; connectionId?: string }
export function buildPluginRequestContext(env: Env, principal: Principal, pluginId: string, connectionScope?: PluginConnectionScope): PluginRequestContext {
  const assertConnectionScope = (providerId: string, connectionId?: string) => {
    if (connectionScope && (connectionScope.providerId !== providerId || (connectionId !== undefined && connectionScope.connectionId !== connectionId))) {
      throw new Error('Provider request is outside the selected source connection')
    }
  }
  const providers: PluginProviderRuntime = {
    resource: async (args) => {
      assertProviderAccess(principal)
      assertOwnedProvider(pluginId, args.providerId)
      assertConnectionScope(args.providerId, args.connectionId)
      return runProviderResource({
        db: getDb(env),
        userId: principal.userId,
        secrets: env.SECRETS,
        ...args,
      })
    },
    connections: async (providerId) => {
      assertProviderAccess(principal)
      assertOwnedCredential(pluginId, providerId)
      assertConnectionScope(providerId)
      if (connectionScope) {
        const connection = await getConnection(getDb(env), principal.userId, connectionScope.connectionId!)
        return connection && connection.provider === providerId ? [connection] : []
      }
      return listProviderConnections(getDb(env), principal.userId, providerId)
    },
    withConnections: async (providerId, visit) => {
      assertProviderAccess(principal)
      assertOwnedCredential(pluginId, providerId)
      assertConnectionScope(providerId)
      if (connectionScope) {
        const connection = await getConnection(getDb(env), principal.userId, connectionScope.connectionId!)
        if (!connection || connection.provider !== providerId || ['disabled', 'needs-auth'].includes(connection.status)) return []
        const value = await env.SECRETS.use(connection.encryptedCredentials, `${providerId}: source connection`, secret => visit(connection, secret))
        return value === undefined ? [] : [value]
      }
      return forEachConnection(getDb(env), principal.userId, providerId, env.SECRETS, visit)
    },
    items: (providerId) => {
      // Synchronous because the store itself does no work until a method is called, and both checks
      // are synchronous too: a plugin naming a provider it does not own should fail at the ask.
      // The store is then built for that provider, so the check at the ask is the truth about every
      // row the store can reach, not just about the argument.
      assertProviderAccess(principal)
      assertOwnedProvider(pluginId, providerId)
      if (connectionScope) throw new Error('Source callbacks use connection-scoped resources instead of the cross-connection item store')
      return createExternalItemStore(getDb(env), principal.userId, providerId)
    },
  }

  return invocationOwned({ userId: principal.userId, principal, providers })
}

export function pluginRequestContext(c: Context<AppEnv>, pluginId: string): PluginRequestContext {
  const principal = c.get('principal')
  if (!principal) throw new Error('Plugin request context requires an authenticated principal.')
  return buildPluginRequestContext(c.env, principal, pluginId)
}
