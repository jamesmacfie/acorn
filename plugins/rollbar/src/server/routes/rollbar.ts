import { Hono } from 'hono'
import type {
  RollbarItemDetail,
  RollbarItemMetadata,
  RollbarItemsResponse,
  RollbarItemSummary,
  RollbarOccurrenceDetail,
  RollbarOccurrencesResponse,
} from '@acorn/protocol/api.ts'
import { ownedConnections } from '@acorn/node-core/server/integrations/connections.ts'
import { providerResource } from '@acorn/node-core/server/integrations/resourceRuntime.ts'
import {
  ROLLBAR_ITEMS_RESOURCE,
  type RollbarListResult,
  type RollbarResourceInput,
} from '../provider'
import {
  ROLLBAR_OCCURRENCES_RESOURCE,
  ROLLBAR_OCCURRENCE_RESOURCE,
  type RollbarOccurrenceInput,
  type RollbarOccurrencesInput,
} from '../occurrenceResources'
import { composeItemDetail } from '../normalize'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import { respondError } from '@acorn/node-core/server/respond.ts'

const PROVIDER = 'rollbar'
const RESOURCE = ROLLBAR_ITEMS_RESOURCE

const connectionIdFrom = (c: { req: { query(name: string): string | undefined } }) => c.req.query('integration')

// Provider-owned HTTP surface. Core mounts this router through the integration-provider registry;
// reads execute the descriptor's mirrored-resource callbacks through the Phase-2 sync runtime.
//
// Every read below goes through `providerResource`, the request-context form: core resolves the owner
// off the principal and keeps the database handle and secret service, so this plugin holds neither. The
// (db, userId, secrets) triple each of these five call sites used to assemble by hand is gone with it —
// and with it the chance of one of them assembling it wrongly and reading another owner's cache.
export const rollbar = new Hono<AppEnv>()
  .get('/items', async (c) => {
    const available = await ownedConnections(c, PROVIDER)
    const requested = new Set((c.req.query('integrations') ?? '').split(',').map((id) => id.trim()).filter(Boolean))
    const connections = requested.size ? available.filter((connection) => requested.has(connection.id)) : available
    if (!connections.length) return respondError(c, 403, 'provider_not_connected')

    const items: RollbarItemSummary[] = []
    const failures: RollbarItemsResponse['failures'] = []
    const cappedIntegrationIds: string[] = []
    // Partial success is honest: one connection failing must not erase another's items.
    for (const connection of connections) {
      const result = await providerResource<RollbarResourceInput, RollbarListResult>(c, {
        providerId: PROVIDER,
        connectionId: connection.id,
        resourceId: RESOURCE,
        input: { kind: 'list' },
      })
      if (result.ok) {
        items.push(...result.value.items)
        if (result.value.capped) cappedIntegrationIds.push(connection.id)
      } else failures.push({ integrationId: connection.id, code: result.failure.error })
    }
    // Only a total wash (no connection succeeded) is a hard error.
    if (!items.length && failures.length && failures.length === connections.length) {
      return respondError(c, 502, failures[0].code)
    }
    items.sort((a, b) => (b.lastOccurrenceAt ?? 0) - (a.lastOccurrenceAt ?? 0))
    return c.json({ items, failures, cappedIntegrationIds } satisfies RollbarItemsResponse)
  })
  .get('/items/:identifier/detail', async (c) => {
    const connectionId = connectionIdFrom(c)
    if (!connectionId) return respondError(c, 400, 'bad_request')
    const result = await providerResource<RollbarResourceInput, RollbarItemMetadata>(c, {
      providerId: PROVIDER, connectionId, resourceId: RESOURCE,
      input: { kind: 'detail', identifier: c.req.param('identifier') },
      force: c.req.query('refresh') === 'true',
    })
    return result.ok ? c.json(result.value) : respondError(c, result.failure.status, result.failure.error, result.failure.detail)
  })
  .get('/items/:identifier/occurrences', async (c) => {
    const connectionId = connectionIdFrom(c)
    if (!connectionId) return respondError(c, 400, 'bad_request')
    const result = await providerResource<RollbarOccurrencesInput, RollbarOccurrencesResponse>(c, {
      providerId: PROVIDER, connectionId, resourceId: ROLLBAR_OCCURRENCES_RESOURCE,
      input: { identifier: c.req.param('identifier') },
      force: c.req.query('refresh') === 'true',
    })
    return result.ok ? c.json(result.value) : respondError(c, result.failure.status, result.failure.error, result.failure.detail)
  })
  .get('/items/:identifier/occurrences/:occurrenceId', async (c) => {
    const connectionId = connectionIdFrom(c)
    if (!connectionId) return respondError(c, 400, 'bad_request')
    const result = await providerResource<RollbarOccurrenceInput, RollbarOccurrenceDetail>(c, {
      providerId: PROVIDER, connectionId, resourceId: ROLLBAR_OCCURRENCE_RESOURCE,
      input: { identifier: c.req.param('identifier'), occurrenceId: c.req.param('occurrenceId') },
      force: c.req.query('refresh') === 'true',
    })
    return result.ok ? c.json(result.value) : respondError(c, result.failure.status, result.failure.error, result.failure.detail)
  })
  .get('/items/:identifier', async (c) => {
    const connectionId = connectionIdFrom(c)
    if (!connectionId) return respondError(c, 400, 'bad_request')
    const force = c.req.query('refresh') === 'true'
    const metadata = await providerResource<RollbarResourceInput, RollbarItemMetadata>(c, {
      providerId: PROVIDER,
      connectionId,
      resourceId: RESOURCE,
      input: { kind: 'detail', identifier: c.req.param('identifier') },
      force,
    })
    if (!metadata.ok) return respondError(c, metadata.failure.status, metadata.failure.error, metadata.failure.detail)

    // Compatibility composite for older internal clients: child-resource failures remain soft, as
    // they did when latest occurrence was bundled into the item request.
    let latestOccurrence: RollbarOccurrenceDetail | null = null
    const occurrences = await providerResource<RollbarOccurrencesInput, RollbarOccurrencesResponse>(c, {
      providerId: PROVIDER, connectionId, resourceId: ROLLBAR_OCCURRENCES_RESOURCE,
      input: { identifier: c.req.param('identifier') }, force,
    })
    const latest = occurrences.ok ? occurrences.value.occurrences[0] : undefined
    if (latest) {
      const detail = await providerResource<RollbarOccurrenceInput, RollbarOccurrenceDetail>(c, {
        providerId: PROVIDER, connectionId, resourceId: ROLLBAR_OCCURRENCE_RESOURCE,
        input: { identifier: c.req.param('identifier'), occurrenceId: latest.id }, force,
      })
      if (detail.ok) latestOccurrence = detail.value
    }
    return c.json(composeItemDetail(metadata.value, latestOccurrence) satisfies RollbarItemDetail)
  })
