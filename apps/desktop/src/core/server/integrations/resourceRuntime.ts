import type { ProviderErrorCode } from '../../shared/integrations'
import { eq } from 'drizzle-orm'
import type { AppDatabase } from '../db'
import { schema } from '../db'
import { decryptSecret } from '../session'
import { serveThenRevalidate, type RouteFailure, type RouteResult } from '../sync/engine'
import { getConnection } from './connections'
import { providerRequestScheduler } from './budgetRuntime'
import { integrationProviderRegistry } from './registry'
import type { MirroredResourceContribution, ProviderResourceContext } from './types'

const failure = (error: ProviderErrorCode, status: RouteFailure['status']): RouteResult<never> => ({
  ok: false,
  failure: { error, status },
})

export async function runProviderResource<TInput, TOutput>(args: {
  db: AppDatabase
  userId: string
  encryptionKey: string
  providerId: string
  connectionId: string
  resourceId: string
  input: TInput
  force?: boolean
}): Promise<RouteResult<TOutput>> {
  const provider = integrationProviderRegistry.require(args.providerId)
  const resource = provider.resources.find((candidate) => candidate.id === args.resourceId) as
    | MirroredResourceContribution<TInput, TOutput>
    | undefined
  if (!resource) return failure('provider_bad_config', 502)

  const connection = await getConnection(args.db, args.userId, args.connectionId)
  if (!connection || connection.provider !== args.providerId) return failure('provider_not_connected', 403)

  const context = (): ProviderResourceContext => ({
    db: args.db,
    userId: args.userId,
    connection,
    now: Date.now(),
    limits: {
      maxPages: provider.budgets.maxPages,
      maxCachedItemBytes: provider.budgets.maxCachedItemBytes,
    },
  })
  const read = () => resource.read(context(), args.input)

  // Reauth/disable keeps provider-owned cache readable but must not trigger outbound work.
  if (connection.status === 'needs-auth' || connection.status === 'disabled') {
    const cached = await read()
    if (cached) return { ok: true, value: cached.data }
    return connection.status === 'needs-auth'
      ? failure('provider_needs_auth', 401)
      : failure('provider_not_connected', 403)
  }

  const fallback = args.force ? await read() : null
  const result = await serveThenRevalidate({
    resource: resource.key(connection.id, args.input),
    userId: args.userId,
    ttlMs: resource.ttlMs,
    backoffMs: provider.budgets.backoffFloorMs,
    force: args.force,
    read,
    refresh: async () => {
      const secret = await decryptSecret(connection.authRef, args.encryptionKey)
      if (!secret) {
        await args.db
          .update(schema.integrations)
          .set({ status: 'needs-auth', lastError: 'provider_secret_unreadable', updatedAt: Date.now() })
          .where(eq(schema.integrations.id, connection.id))
        return { ok: false, failure: { error: 'provider_secret_unreadable', status: 401 } }
      }
      return providerRequestScheduler.run(provider.id, connection.id, provider.budgets, () =>
        resource.refresh({ ...context(), secret }, args.input),
      )
    },
  })
  return !result.ok && fallback ? { ok: true, value: fallback.data } : result
}
