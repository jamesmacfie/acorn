import type { Context } from 'hono'
import type { Env } from '../../main/bindings'
import { getDb } from '../db'
import { forEachConnection, listProviderConnections } from '../integrations/connections'
import { integrationProviderRegistry } from '../integrations/registry'
import { createExternalItemStore } from '../integrations/itemStore'
import { runProviderResource } from '../integrations/resourceRuntime'
import type { AppEnv, Principal } from '../middleware/auth'
import { principalMayUseProviderCredential } from '../middleware/requireUser'
import type { PluginProviderRuntime, PluginRequestContext } from './types'

const assertProviderAccess = (principal: Principal): void => {
  if (!principalMayUseProviderCredential(principal)) {
    throw new Error('Plugin provider runtime requires an interactive device or service credential.')
  }
}

const assertOwnedProvider = (pluginId: string, providerId: string): void => {
  integrationProviderRegistry.assertOwnedBy(providerId, pluginId)
}

// The one construction site for fetch-handler request context. The methods close over host-owned
// services, but their inputs and results are plain data and their call shape can move to RPC without
// widening the plugin contract when loaded plugins move out of process.
//
// Env + Principal rather than a Hono Context, because a SCHEDULED run has neither a request nor a
// route (server/plugin/scheduleRun.ts). The two arguments are exactly what the Hono form read off `c`,
// so the scheduled path gets the same runtime and the same ownership checks as an HTTP one — including
// the provider-credential gate, which a background run passes as the node's own 'service' principal.
export function buildPluginRequestContext(env: Env, principal: Principal, pluginId: string): PluginRequestContext {
  const providers: PluginProviderRuntime = {
    resource: async (args) => {
      assertProviderAccess(principal)
      assertOwnedProvider(pluginId, args.providerId)
      return runProviderResource({
        db: getDb(env),
        userId: principal.userId,
        secrets: env.SECRETS,
        ...args,
      })
    },
    connections: async (providerId) => {
      assertProviderAccess(principal)
      assertOwnedProvider(pluginId, providerId)
      return listProviderConnections(getDb(env), principal.userId, providerId)
    },
    withConnections: async (providerId, visit) => {
      assertProviderAccess(principal)
      assertOwnedProvider(pluginId, providerId)
      return forEachConnection(getDb(env), principal.userId, providerId, env.SECRETS, visit)
    },
    items: (providerId) => {
      // Synchronous because the store itself does no work until a method is called, and both checks
      // are synchronous too — a plugin naming a provider it does not own should fail at the ask.
      // The store is then built FOR that provider, so the check at the ask is the truth about every
      // row the store can reach, not just about the argument.
      assertProviderAccess(principal)
      assertOwnedProvider(pluginId, providerId)
      return createExternalItemStore(getDb(env), principal.userId, providerId)
    },
  }

  return { userId: principal.userId, principal, providers }
}

export function pluginRequestContext(c: Context<AppEnv>, pluginId: string): PluginRequestContext {
  const principal = c.get('principal')
  if (!principal) throw new Error('Plugin request context requires an authenticated principal.')
  return buildPluginRequestContext(c.env, principal, pluginId)
}
