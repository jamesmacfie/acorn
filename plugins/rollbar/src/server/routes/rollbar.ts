import { Hono, type Context } from 'hono'
import type {
  RollbarItemDetail,
  RollbarItemMetadata,
  RollbarItemsResponse,
  RollbarItemSummary,
  RollbarOccurrenceDetail,
  RollbarOccurrencesResponse,
} from '../../shared/api'
import {
  type AppEnv,
  ownedConnections as hostOwnedConnections,
  type PluginFetchHandler,
  type PluginProviderResourceRequest,
  type PluginRequestContext,
  providerResource as hostProviderResource,
  respondError,
  type RouteResult,
} from '@acorn/plugin-api/node'
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

const PROVIDER = 'rollbar'
const RESOURCE = ROLLBAR_ITEMS_RESOURCE
const PORTABLE_REQUEST_CONTEXT = Symbol('rollbar-plugin-request-context')

type PortableBindings = AppEnv['Bindings'] & {
  [PORTABLE_REQUEST_CONTEXT]?: PluginRequestContext
}

const portableContext = (c: Context<AppEnv>): PluginRequestContext | undefined =>
  (c.env as PortableBindings)[PORTABLE_REQUEST_CONTEXT]

const rollbarConnections = (c: Context<AppEnv>, providerId: string) => {
  const context = portableContext(c)
  return context ? context.providers.connections(providerId) : hostOwnedConnections(c, providerId)
}

const rollbarResource = <TInput, TOutput>(
  c: Context<AppEnv>,
  request: PluginProviderResourceRequest<TInput>,
): Promise<RouteResult<TOutput>> => {
  const context = portableContext(c)
  return context
    ? context.providers.resource<TInput, TOutput>(request)
    : hostProviderResource<TInput, TOutput>(c, request)
}

const connectionIdFrom = (c: { req: { query(name: string): string | undefined } }) => c.req.query('integration')

export const rollbar = new Hono<AppEnv>()
  .get('/items', async (c) => {
    const available = await rollbarConnections(c, PROVIDER)
    const requested = new Set((c.req.query('integrations') ?? '').split(',').map((id) => id.trim()).filter(Boolean))
    const connections = requested.size ? available.filter((connection) => requested.has(connection.id)) : available
    if (!connections.length) return respondError(c, 403, 'provider_not_connected')

    const items: RollbarItemSummary[] = []
    const failures: RollbarItemsResponse['failures'] = []
    const cappedIntegrationIds: string[] = []
    // Partial success is honest: one connection failing must not erase another's items.
    for (const connection of connections) {
      const result = await rollbarResource<RollbarResourceInput, RollbarListResult>(c, {
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
    const result = await rollbarResource<RollbarResourceInput, RollbarItemMetadata>(c, {
      providerId: PROVIDER, connectionId, resourceId: RESOURCE,
      input: { kind: 'detail', identifier: c.req.param('identifier') },
      force: c.req.query('refresh') === 'true',
    })
    return result.ok ? c.json(result.value) : respondError(c, result.failure.status, result.failure.error, result.failure.detail)
  })
  .get('/items/:identifier/occurrences', async (c) => {
    const connectionId = connectionIdFrom(c)
    if (!connectionId) return respondError(c, 400, 'bad_request')
    const result = await rollbarResource<RollbarOccurrencesInput, RollbarOccurrencesResponse>(c, {
      providerId: PROVIDER, connectionId, resourceId: ROLLBAR_OCCURRENCES_RESOURCE,
      input: { identifier: c.req.param('identifier') },
      force: c.req.query('refresh') === 'true',
    })
    return result.ok ? c.json(result.value) : respondError(c, result.failure.status, result.failure.error, result.failure.detail)
  })
  .get('/items/:identifier/occurrences/:occurrenceId', async (c) => {
    const connectionId = connectionIdFrom(c)
    if (!connectionId) return respondError(c, 400, 'bad_request')
    const result = await rollbarResource<RollbarOccurrenceInput, RollbarOccurrenceDetail>(c, {
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
    const metadata = await rollbarResource<RollbarResourceInput, RollbarItemMetadata>(c, {
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
    const occurrences = await rollbarResource<RollbarOccurrencesInput, RollbarOccurrencesResponse>(c, {
      providerId: PROVIDER, connectionId, resourceId: ROLLBAR_OCCURRENCES_RESOURCE,
      input: { identifier: c.req.param('identifier') }, force,
    })
    const latest = occurrences.ok ? occurrences.value.occurrences[0] : undefined
    if (latest) {
      const detail = await rollbarResource<RollbarOccurrenceInput, RollbarOccurrenceDetail>(c, {
        providerId: PROVIDER, connectionId, resourceId: ROLLBAR_OCCURRENCE_RESOURCE,
        input: { identifier: c.req.param('identifier'), occurrenceId: latest.id }, force,
      })
      if (detail.ok) latestOccurrence = detail.value
    }
    return c.json(composeItemDetail(metadata.value, latestOccurrence) satisfies RollbarItemDetail)
  })

// The same Hono routes run in both tiers through this fetch-shaped carrier. Its request context
// supplies the identity-bound provider runtime without exposing host database or secret-service
// handles to the bundle; the exported router remains useful to direct route tests.
export const rollbarFetch: PluginFetchHandler = (request, context) =>
  rollbar.fetch(request, { [PORTABLE_REQUEST_CONTEXT]: context } as PortableBindings)
