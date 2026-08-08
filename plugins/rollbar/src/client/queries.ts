// Rollbar's TanStack Query definitions. They live with the plugin that owns the routes and the keys
// (../shared/api.ts) rather than in client-core, so adding a provider does not mean editing core.
//
// Moved verbatim from @acorn/client-core/queries.ts — same keys, same staleTime, same refetch policy.
import { readJson } from '@acorn/plugin-api/client'
import {
  rollbarItemKey,
  rollbarItemMetadataKey,
  rollbarItemMetadataRoute,
  rollbarItemRoute,
  rollbarItemsKey,
  rollbarItemsForConnectionsRoute,
  rollbarOccurrenceKey,
  rollbarOccurrenceRoute,
  rollbarOccurrencesKey,
  rollbarOccurrencesRoute,
  type RollbarItemDetail,
  type RollbarItemMetadata,
  type RollbarItemsResponse,
  type RollbarOccurrenceDetail,
  type RollbarOccurrencesResponse,
} from '../shared/api'

type QueryContext = { signal?: AbortSignal }

// Active Rollbar items for the projects mapped to the routed workspace. The server serves each
// connection's mirror (2-min TTL); the selection is part of the persisted client cache identity.
export const rollbarItemsOptions = (integrationIds: readonly string[], enabled: boolean) => ({
  queryKey: rollbarItemsKey(integrationIds),
  enabled: enabled && integrationIds.length > 0,
  staleTime: 30 * 1000,
  refetchOnMount: 'always' as const,
  queryFn: async ({ signal }: QueryContext): Promise<RollbarItemsResponse> =>
    readJson<RollbarItemsResponse>(rollbarItemsForConnectionsRoute(integrationIds), { signal }),
})

// One item's normalized detail (header/facts + latest occurrence). Mirrors linearIssueOptions:
// staleTime 0 + refetchOnMount 'always' so opening the panel re-reads; `refresh` forces past the TTL.
export const rollbarItemOptions = (integrationId: string, identifier: string, enabled: boolean, refresh = false) => ({
  queryKey: rollbarItemKey(integrationId, identifier),
  enabled,
  staleTime: 0,
  refetchOnMount: 'always' as const,
  queryFn: async ({ signal }: QueryContext): Promise<RollbarItemDetail> =>
    readJson<RollbarItemDetail>(rollbarItemRoute(integrationId, identifier, refresh), { signal }),
})

export const rollbarItemMetadataOptions = (integrationId: string, identifier: string, enabled: boolean, refresh = false) => ({
  queryKey: rollbarItemMetadataKey(integrationId, identifier),
  enabled,
  staleTime: 30 * 1000,
  queryFn: async ({ signal }: QueryContext): Promise<RollbarItemMetadata> =>
    readJson<RollbarItemMetadata>(rollbarItemMetadataRoute(integrationId, identifier, refresh), { signal }),
})

export const rollbarOccurrencesOptions = (integrationId: string, identifier: string, enabled: boolean, refresh = false) => ({
  queryKey: rollbarOccurrencesKey(integrationId, identifier),
  enabled,
  staleTime: 30 * 1000,
  queryFn: async ({ signal }: QueryContext): Promise<RollbarOccurrencesResponse> =>
    readJson<RollbarOccurrencesResponse>(rollbarOccurrencesRoute(integrationId, identifier, refresh), { signal }),
})

export const rollbarOccurrenceOptions = (
  integrationId: string,
  identifier: string,
  occurrenceId: string,
  enabled: boolean,
  refresh = false,
) => ({
  queryKey: rollbarOccurrenceKey(integrationId, identifier, occurrenceId),
  enabled,
  staleTime: 5 * 60 * 1000,
  queryFn: async ({ signal }: QueryContext): Promise<RollbarOccurrenceDetail> =>
    readJson<RollbarOccurrenceDetail>(rollbarOccurrenceRoute(integrationId, identifier, occurrenceId, refresh), { signal }),
})
