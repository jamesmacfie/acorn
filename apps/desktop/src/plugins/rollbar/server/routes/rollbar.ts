import { Hono } from 'hono'
import type {
  RollbarItemDetail,
  RollbarItemMetadata,
  RollbarItemsResponse,
  RollbarItemSummary,
  RollbarOccurrenceDetail,
  RollbarOccurrencesResponse,
} from '../../../../core/shared/api'
import { getDb } from '../../../../core/server/db'
import { listProviderConnections } from '../../../../core/server/integrations/connections'
import { runProviderResource } from '../../../../core/server/integrations/resourceRuntime'
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
import type { AppEnv } from '../../../../core/server/middleware/auth'
import { getUser } from '../../../../core/server/middleware/requireUser'
import { respondError } from '../../../../core/server/respond'

const PROVIDER = 'rollbar'
const RESOURCE = ROLLBAR_ITEMS_RESOURCE

const connectionIdFrom = (c: { req: { query(name: string): string | undefined } }) => c.req.query('integration')

// Provider-owned HTTP surface. Core mounts this router through the integration-provider registry;
// reads execute the descriptor's mirrored-resource callbacks through the Phase-2 sync runtime.
export const rollbar = new Hono<AppEnv>()
  .get('/items', async (c) => {
    const user = getUser(c)
    const db = getDb(c.env)
    const available = await listProviderConnections(db, user.login, PROVIDER)
    const requested = new Set((c.req.query('integrations') ?? '').split(',').map((id) => id.trim()).filter(Boolean))
    const connections = requested.size ? available.filter((connection) => requested.has(connection.id)) : available
    if (!connections.length) return respondError(c, 403, 'provider_not_connected')

    const items: RollbarItemSummary[] = []
    const failures: RollbarItemsResponse['failures'] = []
    const cappedIntegrationIds: string[] = []
    // Partial success is honest: one connection failing must not erase another's items.
    for (const connection of connections) {
      const result = await runProviderResource<RollbarResourceInput, RollbarListResult>({
        db,
        userId: user.login,
        encryptionKey: c.env.SESSION_ENC_KEY,
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
    const user = getUser(c)
    const result = await runProviderResource<RollbarResourceInput, RollbarItemMetadata>({
      db: getDb(c.env), userId: user.login, encryptionKey: c.env.SESSION_ENC_KEY,
      providerId: PROVIDER, connectionId, resourceId: RESOURCE,
      input: { kind: 'detail', identifier: c.req.param('identifier') },
      force: c.req.query('refresh') === 'true',
    })
    return result.ok ? c.json(result.value) : respondError(c, result.failure.status, result.failure.error, result.failure.detail)
  })
  .get('/items/:identifier/occurrences', async (c) => {
    const connectionId = connectionIdFrom(c)
    if (!connectionId) return respondError(c, 400, 'bad_request')
    const user = getUser(c)
    const result = await runProviderResource<RollbarOccurrencesInput, RollbarOccurrencesResponse>({
      db: getDb(c.env), userId: user.login, encryptionKey: c.env.SESSION_ENC_KEY,
      providerId: PROVIDER, connectionId, resourceId: ROLLBAR_OCCURRENCES_RESOURCE,
      input: { identifier: c.req.param('identifier') },
      force: c.req.query('refresh') === 'true',
    })
    return result.ok ? c.json(result.value) : respondError(c, result.failure.status, result.failure.error, result.failure.detail)
  })
  .get('/items/:identifier/occurrences/:occurrenceId', async (c) => {
    const connectionId = connectionIdFrom(c)
    if (!connectionId) return respondError(c, 400, 'bad_request')
    const user = getUser(c)
    const result = await runProviderResource<RollbarOccurrenceInput, RollbarOccurrenceDetail>({
      db: getDb(c.env), userId: user.login, encryptionKey: c.env.SESSION_ENC_KEY,
      providerId: PROVIDER, connectionId, resourceId: ROLLBAR_OCCURRENCE_RESOURCE,
      input: { identifier: c.req.param('identifier'), occurrenceId: c.req.param('occurrenceId') },
      force: c.req.query('refresh') === 'true',
    })
    return result.ok ? c.json(result.value) : respondError(c, result.failure.status, result.failure.error, result.failure.detail)
  })
  .get('/items/:identifier', async (c) => {
    const connectionId = connectionIdFrom(c)
    if (!connectionId) return respondError(c, 400, 'bad_request')
    const user = getUser(c)
    const force = c.req.query('refresh') === 'true'
    const metadata = await runProviderResource<RollbarResourceInput, RollbarItemMetadata>({
      db: getDb(c.env),
      userId: user.login,
      encryptionKey: c.env.SESSION_ENC_KEY,
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
    const occurrences = await runProviderResource<RollbarOccurrencesInput, RollbarOccurrencesResponse>({
      db: getDb(c.env), userId: user.login, encryptionKey: c.env.SESSION_ENC_KEY,
      providerId: PROVIDER, connectionId, resourceId: ROLLBAR_OCCURRENCES_RESOURCE,
      input: { identifier: c.req.param('identifier') }, force,
    })
    const latest = occurrences.ok ? occurrences.value.occurrences[0] : undefined
    if (latest) {
      const detail = await runProviderResource<RollbarOccurrenceInput, RollbarOccurrenceDetail>({
        db: getDb(c.env), userId: user.login, encryptionKey: c.env.SESSION_ENC_KEY,
        providerId: PROVIDER, connectionId, resourceId: ROLLBAR_OCCURRENCE_RESOURCE,
        input: { identifier: c.req.param('identifier'), occurrenceId: latest.id }, force,
      })
      if (detail.ok) latestOccurrence = detail.value
    }
    return c.json(composeItemDetail(metadata.value, latestOccurrence) satisfies RollbarItemDetail)
  })
