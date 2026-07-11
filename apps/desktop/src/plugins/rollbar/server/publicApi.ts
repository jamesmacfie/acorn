import { z } from 'zod'
import type { AppDatabase } from '../../../core/server/db'
import { listProviderConnections } from '../../../core/server/integrations/connections'
import { runProviderResource } from '../../../core/server/integrations/resourceRuntime'
import { PublicApiError, type ErrorCode } from '../../../core/shared/publicApi/errors'
import { PageSchema } from '../../../core/shared/publicApi/primitives'
import { RollbarItemDetailSchema, RollbarItemQuerySchema, RollbarItemsQuerySchema, RollbarItemSummarySchema } from '../../../core/shared/publicApi/rollbar'
import { defineEndpoint, type PluginApiContribution } from '../../../core/server/publicApi/defineEndpoint'
import type {
  RollbarItemDetail,
  RollbarItemMetadata,
  RollbarItemSummary,
  RollbarOccurrenceDetail,
  RollbarOccurrencesResponse,
} from '../../../core/shared/api'
import {
  ROLLBAR_ITEMS_RESOURCE,
  type RollbarListResult,
  type RollbarResourceInput,
} from './provider'
import {
  ROLLBAR_OCCURRENCES_RESOURCE,
  ROLLBAR_OCCURRENCE_RESOURCE,
  type RollbarOccurrenceInput,
  type RollbarOccurrencesInput,
} from './occurrenceResources'
import { composeItemDetail } from './normalize'

// Rollbar provider public API (docs/public-api.md). Base /plugins/rollbar. Reads go through the
// shared provider-resource runtime (credential decrypt + mirror + budgets), so the public and
// internal surfaces share one implementation.

const PLUGIN = 'rollbar'
const PROVIDER = 'rollbar'
const RESOURCE = ROLLBAR_ITEMS_RESOURCE

function providerFailure(status: number, error: string): PublicApiError {
  const byStatus: Record<number, ErrorCode> = { 401: 'upstream_reauthentication_required', 403: 'operation_forbidden', 404: 'not_found', 429: 'upstream_rate_limited', 502: 'provider_unavailable' }
  return new PublicApiError(byStatus[status] ?? 'provider_unavailable', error)
}

export function buildRollbarPublicApi(db: AppDatabase, encKey: string): PluginApiContribution {
  const listOne = (userId: string, connectionId: string) =>
    runProviderResource<RollbarResourceInput, RollbarListResult>({ db, userId, encryptionKey: encKey, providerId: PROVIDER, connectionId, resourceId: RESOURCE, input: { kind: 'list' } })

  return {
    pluginId: PLUGIN,
    endpoints: [
      defineEndpoint({
        operationId: 'rollbar.items.list',
        pluginId: PLUGIN,
        method: 'GET',
        path: '/items',
        scope: 'read',
        risk: 'read',
        summary: 'List Rollbar items',
        query: RollbarItemsQuerySchema,
        response: PageSchema(RollbarItemSummarySchema),
        handler: async (ctx, { query }) => {
          const connections = query.connectionId
            ? [{ id: query.connectionId }]
            : await listProviderConnections(db, ctx.actor.principalId, PROVIDER)
          if (!connections.length) throw new PublicApiError('provider_unavailable', 'No Rollbar connection')
          const items: RollbarItemSummary[] = []
          let firstFailure: PublicApiError | null = null
          let hadSuccess = false
          for (const conn of connections) {
            const res = await listOne(ctx.actor.principalId, conn.id)
            if (res.ok) {
              hadSuccess = true
              items.push(...res.value.items)
            } else firstFailure ??= providerFailure(res.failure.status, res.failure.error)
          }
          if (!hadSuccess && firstFailure) throw firstFailure
          items.sort((a, b) => (b.lastOccurrenceAt ?? 0) - (a.lastOccurrenceAt ?? 0))
          const filtered = query.status ? items.filter((i) => i.status === query.status) : items
          return { items: filtered.slice(0, query.limit), nextCursor: null }
        },
      }),
      defineEndpoint({
        operationId: 'rollbar.items.get',
        pluginId: PLUGIN,
        method: 'GET',
        path: '/items/:identifier',
        scope: 'read',
        risk: 'read',
        summary: 'Get a Rollbar item',
        params: z.strictObject({ identifier: z.string().min(1).max(256) }),
        query: RollbarItemQuerySchema,
        response: RollbarItemDetailSchema,
        handler: async (ctx, { params, query }) => {
          const metadata = await runProviderResource<RollbarResourceInput, RollbarItemMetadata>({
            db,
            userId: ctx.actor.principalId,
            encryptionKey: encKey,
            providerId: PROVIDER,
            connectionId: query.connectionId,
            resourceId: RESOURCE,
            input: { kind: 'detail', identifier: params.identifier },
            force: query.refresh === 'true', // honor the documented refresh flag (previously parsed, ignored)
          })
          if (!metadata.ok) throw providerFailure(metadata.failure.status, metadata.failure.error)

          let latestOccurrence: RollbarOccurrenceDetail | null = null
          const occurrences = await runProviderResource<RollbarOccurrencesInput, RollbarOccurrencesResponse>({
            db, userId: ctx.actor.principalId, encryptionKey: encKey, providerId: PROVIDER,
            connectionId: query.connectionId, resourceId: ROLLBAR_OCCURRENCES_RESOURCE,
            input: { identifier: params.identifier }, force: query.refresh === 'true',
          })
          const latest = occurrences.ok ? occurrences.value.occurrences[0] : undefined
          if (latest) {
            const occurrence = await runProviderResource<RollbarOccurrenceInput, RollbarOccurrenceDetail>({
              db, userId: ctx.actor.principalId, encryptionKey: encKey, providerId: PROVIDER,
              connectionId: query.connectionId, resourceId: ROLLBAR_OCCURRENCE_RESOURCE,
              input: { identifier: params.identifier, occurrenceId: latest.id }, force: query.refresh === 'true',
            })
            if (occurrence.ok) latestOccurrence = occurrence.value
          }
          return composeItemDetail(metadata.value, latestOccurrence) satisfies RollbarItemDetail
        },
      }),
    ],
  }
}
