import type { ProviderErrorCode } from '@acorn/protocol/integrations.ts'
import { eq } from 'drizzle-orm'
import type { Context } from 'hono'
import type { AppDatabase } from '../db'
import { getDb, schema } from '../db'
import type { AppEnv } from '../middleware/auth'
import { ownerId } from '../middleware/requireUser'
import { SecretUnavailableError, type SecretService } from '../../main/core/secrets'
import { serveThenRevalidate, type RouteFailure, type RouteResult } from '../sync/engine'
import { getConnection } from './connections'
import { createExternalItemStore } from './itemStore'
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
  secrets: SecretService
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

  // Built once per call and scoped to this owner. The provider sees only its six operations against
  // core's external-item tables (integrations/itemStore.ts), never core's database handle.
  const items = createExternalItemStore(args.db, args.userId)
  const context = (): ProviderResourceContext => ({
    items,
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
      try {
        // The provider call runs INSIDE the secret scope, which is the point: a provider that echoes
        // the credential back in an error body gets it scrubbed here, before this failure is logged
        // or surfaced (main/core/secrets.ts).
        return await args.secrets.use(connection.authRef, `${connection.provider}: read ${resource.id}`, (secret) =>
          providerRequestScheduler.run(provider.id, connection.id, provider.budgets, () =>
            resource.refresh({ ...context(), secret }, args.input),
          ),
        )
      } catch (error) {
        if (!(error instanceof SecretUnavailableError)) throw error
        await args.db
          .update(schema.integrations)
          .set({ status: 'needs-auth', lastError: 'provider_secret_unreadable', updatedAt: Date.now() })
          .where(eq(schema.integrations.id, connection.id))
        return { ok: false, failure: { error: 'provider_secret_unreadable', status: 401 } }
      }
    },
  })
  return !result.ok && fallback ? { ok: true, value: fallback.data } : result
}

// The request-context form, for a provider plugin's routes. Same function; core keeps the database
// handle, the owner id and the secret service instead of making eight call sites in linear and rollbar
// assemble them by hand from `getDb(c.env)` / `ownerId(c)` / `c.env.SECRETS`. That assembly is what put
// both plugins on the schema ratchet, and getting the owner id wrong at any one of those sites would
// have read another owner's cached items.
export const providerResource = <TInput, TOutput>(
  c: Context<AppEnv>,
  args: { providerId: string; connectionId: string; resourceId: string; input: TInput; force?: boolean },
): Promise<RouteResult<TOutput>> =>
  runProviderResource<TInput, TOutput>({ db: getDb(c.env), userId: ownerId(c), secrets: c.env.SECRETS, ...args })
