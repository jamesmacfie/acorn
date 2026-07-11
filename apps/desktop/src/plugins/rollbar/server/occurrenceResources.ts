import { and, eq } from 'drizzle-orm'
import type {
  RollbarItemMetadata,
  RollbarOccurrenceDetail,
  RollbarOccurrencesResponse,
} from '../../../core/shared/api'
import { schema } from '../../../core/server/db'
import { isRecord, parseJson } from '../../../core/server/integrations/codec'
import type {
  MirroredResourceContribution,
  ProviderResourceContext,
  ProviderResourceRefreshContext,
} from '../../../core/server/integrations/types'
import type { RouteFailure } from '../../../core/server/sync/engine'
import {
  instancePath,
  itemByCounterPath,
  itemInstancesPath,
  rollbarData,
  rollbarFetch,
  type RollbarApiInstance,
  type RollbarApiInstancesPage,
  type RollbarApiItem,
} from './'
import { normalizeItemMetadata, normalizeOccurrence, normalizeSummary, occurrenceSummary } from './normalize'

const OCCURRENCE_PAGE_SIZE = 50
const CHILD_CACHE_SCHEMA_VERSION = 2
type ChildResource = 'occurrence-list' | 'occurrence'

export const ROLLBAR_OCCURRENCES_RESOURCE = 'rollbar.item-occurrences'
export const ROLLBAR_OCCURRENCE_RESOURCE = 'rollbar.occurrence'
export type RollbarOccurrencesInput = { identifier: string }
export type RollbarOccurrenceInput = { identifier: string; occurrenceId: string }

type Dependencies = {
  cachedItemId(context: ProviderResourceContext, identifier: string): Promise<string | null>
  persistMetadata(context: ProviderResourceRefreshContext, metadata: RollbarItemMetadata): Promise<void>
  failFor(response: Response): RouteFailure | null
}

const resourceKey = (
  connectionId: string,
  issueIdentifier: string,
  resource: ChildResource,
  identifier: string,
) => `provider:rollbar:${connectionId}:${resource}:${issueIdentifier}:${identifier}`

const resourceRow = (
  context: Pick<ProviderResourceContext, 'db' | 'userId' | 'connection'>,
  issueIdentifier: string,
  resource: ChildResource,
  identifier: string,
) => context.db
  .select()
  .from(schema.issueResources)
  .where(and(
    eq(schema.issueResources.userId, context.userId),
    eq(schema.issueResources.integrationId, context.connection.id),
    eq(schema.issueResources.issueIdentifier, issueIdentifier),
    eq(schema.issueResources.resource, resource),
    eq(schema.issueResources.identifier, identifier),
  ))

async function writeResource(
  context: ProviderResourceRefreshContext,
  issueIdentifier: string,
  resource: ChildResource,
  identifier: string,
  value: unknown,
): Promise<boolean> {
  // Version the storage envelope independently from the public contract. v1 normalized the wrong
  // upstream property (`occurrence` instead of `data`); rejecting its bare rows forces an immediate
  // refresh instead of serving `unknown` diagnostics until the TTL expires.
  const data = JSON.stringify({ schemaVersion: CHILD_CACHE_SCHEMA_VERSION, value })
  if (Buffer.byteLength(data, 'utf8') > context.limits.maxCachedItemBytes) return false
  await context.db
    .insert(schema.issueResources)
    .values({
      userId: context.userId,
      integrationId: context.connection.id,
      provider: 'rollbar',
      issueIdentifier,
      resource,
      identifier,
      data,
      fetchedAt: context.now,
    })
    .onConflictDoUpdate({
      target: [
        schema.issueResources.userId,
        schema.issueResources.integrationId,
        schema.issueResources.issueIdentifier,
        schema.issueResources.resource,
        schema.issueResources.identifier,
      ],
      set: { data, fetchedAt: context.now },
    })
  return true
}

const isOccurrence = (value: unknown): value is RollbarOccurrenceDetail =>
  isRecord(value) && typeof value.id === 'string' && (typeof value.url === 'string' || value.url === null) &&
  Array.isArray(value.frames) && typeof value.truncated === 'boolean'

const isOccurrences = (value: unknown): value is RollbarOccurrencesResponse =>
  isRecord(value) && Array.isArray(value.occurrences) && typeof value.capped === 'boolean' &&
  value.occurrences.every((occurrence) => isRecord(occurrence) && typeof occurrence.id === 'string' &&
    (typeof occurrence.url === 'string' || occurrence.url === null))

const readVersioned = (raw: string): unknown => {
  const envelope = parseJson(raw)
  return isRecord(envelope) && envelope.schemaVersion === CHILD_CACHE_SCHEMA_VERSION ? envelope.value : null
}

export function createRollbarOccurrenceResources(dependencies: Dependencies) {
  const occurrences: MirroredResourceContribution<RollbarOccurrencesInput, RollbarOccurrencesResponse> = {
    id: ROLLBAR_OCCURRENCES_RESOURCE,
    ttlMs: 2 * 60_000,
    merge: 'replace',
    key: (connectionId, input) => resourceKey(connectionId, input.identifier, 'occurrence-list', 'list'),
    async read(context, input) {
      const [row] = await resourceRow(context, input.identifier, 'occurrence-list', 'list')
      if (!row) return null
      const value = readVersioned(row.data)
      return isOccurrences(value) ? { data: value, fetchedAt: row.fetchedAt } : null
    },
    async refresh(context, input) {
      try {
        let itemId = await dependencies.cachedItemId(context, input.identifier)
        if (!itemId) {
          const itemRes = await rollbarFetch(context.secret, itemByCounterPath(input.identifier))
          const failure = dependencies.failFor(itemRes)
          if (failure) return { ok: false, failure }
          const item = await rollbarData<RollbarApiItem>(itemRes)
          const summary = normalizeSummary(context.connection.id, context.connection.label, item)
          await dependencies.persistMetadata(context, normalizeItemMetadata(summary, item))
          itemId = summary.itemId
        }
        const response = await rollbarFetch(context.secret, itemInstancesPath(itemId, OCCURRENCE_PAGE_SIZE))
        const failure = dependencies.failFor(response)
        if (failure) return { ok: false, failure }
        const instances = (await rollbarData<RollbarApiInstancesPage>(response)).instances ?? []
        const value: RollbarOccurrencesResponse = {
          occurrences: instances.map(normalizeOccurrence).map(occurrenceSummary).filter((item) => item.id !== ''),
          capped: instances.length >= OCCURRENCE_PAGE_SIZE,
        }
        return await writeResource(context, input.identifier, 'occurrence-list', 'list', value)
          ? { ok: true }
          : { ok: false, failure: { error: 'provider_response_too_large', status: 502 } }
      } catch {
        return { ok: false, failure: { error: 'provider_unavailable', status: 502 } }
      }
    },
  }

  const occurrence: MirroredResourceContribution<RollbarOccurrenceInput, RollbarOccurrenceDetail> = {
    id: ROLLBAR_OCCURRENCE_RESOURCE,
    ttlMs: 10 * 60_000,
    merge: 'replace',
    key: (connectionId, input) => resourceKey(connectionId, input.identifier, 'occurrence', input.occurrenceId),
    async read(context, input) {
      const [row] = await resourceRow(context, input.identifier, 'occurrence', input.occurrenceId)
      if (!row) return null
      const value = readVersioned(row.data)
      return isOccurrence(value) ? { data: value, fetchedAt: row.fetchedAt } : null
    },
    async refresh(context, input) {
      try {
        const response = await rollbarFetch(context.secret, instancePath(input.occurrenceId))
        const failure = dependencies.failFor(response)
        if (failure) return { ok: false, failure }
        const value = normalizeOccurrence(await rollbarData<RollbarApiInstance>(response))
        if (!value.id) value.id = input.occurrenceId
        return await writeResource(context, input.identifier, 'occurrence', input.occurrenceId, value)
          ? { ok: true }
          : { ok: false, failure: { error: 'provider_response_too_large', status: 502 } }
      } catch {
        return { ok: false, failure: { error: 'provider_unavailable', status: 502 } }
      }
    },
  }

  return { occurrences, occurrence }
}
