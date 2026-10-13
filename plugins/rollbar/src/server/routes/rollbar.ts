import { Hono, type Context } from 'hono'
import type {
  RollbarItemMetadata,
  RollbarItemsResponse,
  RollbarItemSummary,
  RollbarOccurrenceDetail,
  RollbarOccurrencesResponse,
} from '../../shared/api'
import {
  type AppEnv,
  type CoreServices,
  type PluginFetchHandler,
  type PluginProviderResourceRequest,
  portableCarrier,
  providerRequestScheduler,
  respondError,
  type RouteResult,
} from '@acorn/plugin-api/node'
import type { PluginRailSearchResult } from '@acorn/protocol/api.ts'
import { MAX_COMMAND_SEARCH_QUERY } from '@acorn/protocol/commands.ts'
import { itemsSearchPath, rollbarData, rollbarFetch, type RollbarApiItem } from '..'
import {
  ROLLBAR_ITEMS_RESOURCE,
  ROLLBAR_PER_PAGE,
  rollbarProvider,
  type RollbarListResult,
  type RollbarResourceInput,
} from '../provider'
import { normalizeSummary } from '../normalize'
import {
  ROLLBAR_OCCURRENCES_RESOURCE,
  ROLLBAR_OCCURRENCE_RESOURCE,
  type RollbarOccurrenceInput,
  type RollbarOccurrencesInput,
} from '../occurrenceResources'
import { rollbarRailItem } from '../../shared/rail'
import { rollbarSearchItems } from '../paletteSearch'
import { createBrowserHandoffHandler, projectsMappingConnection } from '../browserHandoff'

const PROVIDER = 'rollbar'
const RESOURCE = ROLLBAR_ITEMS_RESOURCE

// Rollbar ships loaded, so these routes run on one tier: the host gets `router.fetch`
// (createRollbarFetch below) and the identity-bound runtime rides in through `c.env`. The carrier
// itself is the host's (@acorn/plugin-api/node).
const { requestContext, portableFetch } = portableCarrier(PROVIDER)

const rollbarConnections = (c: Context<AppEnv>, providerId: string) =>
  requestContext(c).providers.connections(providerId)

const rollbarResource = <TInput, TOutput>(
  c: Context<AppEnv>,
  request: PluginProviderResourceRequest<TInput>,
): Promise<RouteResult<TOutput>> => requestContext(c).providers.resource<TInput, TOutput>(request)

const connectionIdFrom = (c: { req: { query(name: string): string | undefined } }) => c.req.query('integration')

type RollbarProjectScope = Pick<CoreServices['projects'], 'byId' | 'checkouts' | 'externalProjects'>

async function listItems(
  c: Context<AppEnv>,
  connections: Awaited<ReturnType<typeof rollbarConnections>>,
): Promise<RollbarItemsResponse> {
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
  items.sort((a, b) => (b.lastOccurrenceAt ?? 0) - (a.lastOccurrenceAt ?? 0))
  return { items, failures, cappedIntegrationIds }
}

const allFailed = (response: RollbarItemsResponse, connectionCount: number): boolean =>
  response.items.length === 0 && response.failures.length > 0 && response.failures.length === connectionCount

// Which connections the routed project follows. A Rollbar connection is one Rollbar project (see the
// token hint in provider.ts), so the mapping is the whole filter. A link may narrow itself to one
// project in the workspace, in which case only that project's rail keeps it.
//
// No project scope means no rows, not every row: falling back to all connections would show one
// workspace's errors in every other workspace. Linear's rail closes the same way.
//
// The project id is a parameter rather than read off the request, because two callers spell it
// differently and neither spelling is this function's business: the rail source asks with `?project=`
// and the palette's search with `?projectId=`, which is the name the command host derives and sends
// (`commandRouteScope` in client-core). Both are the host's word for the
// routed project; neither is anything a manifest or a response chose.
async function scopedConnections(c: Context<AppEnv>, projectId: string | undefined, projects?: RollbarProjectScope) {
  if (!projectId || !projects) return []
  const project = await projects.byId(projectId)
  if (!project) return []
  const rows = await projects.externalProjects(project.workspaceId)
  const mapped = new Set(
    rows.filter((row) => !row.projectId || row.projectId === projectId).map((row) => row.connectionId),
  )
  return (await rollbarConnections(c, PROVIDER)).filter((connection) => mapped.has(connection.id))
}

type SearchAnswer = { items: RollbarItemSummary[]; full: boolean } | { failed: true }

/**
 * Rollbar's own search over each mapped connection's active items, one page each. It reads past the
 * three mirrored pages the rail lists, and it writes nothing: a search answer is not a list refresh,
 * so it must not restamp the mirror's membership (../provider.ts).
 *
 * Rows go through the same normalizer as the mirror, so the same fields reach the client. `status` is
 * checked here as well as sent, because the reader's text is Rollbar's search language and could name
 * a status of its own.
 */
async function searchItems(c: Context<AppEnv>, connectionIds: Set<string>, query: string): Promise<SearchAnswer[]> {
  return requestContext(c).providers.withConnections(
    PROVIDER,
    async (connection, token): Promise<SearchAnswer | undefined> => {
      if (!connectionIds.has(connection.id)) return undefined
      try {
        const response = await providerRequestScheduler.run(PROVIDER, connection.id, rollbarProvider.budgets, () =>
          rollbarFetch(token, itemsSearchPath(query)),
        )
        const raw = (await rollbarData<{ items?: RollbarApiItem[] }>(response)).items ?? []
        return {
          items: raw
            .map((item) => normalizeSummary(connection.id, connection.label, item))
            .filter((item) => item.status === 'active'),
          full: raw.length >= ROLLBAR_PER_PAGE,
        }
      } catch {
        return { failed: true }
      }
    },
  )
}

const createRollbarRoutes = (projects?: RollbarProjectScope) =>
  new Hono<AppEnv>()
    // The browser extension's item handoff, declared in the manifest's `browserHandoffs`. Served here,
    // not from its own `ctx.routes.fetch` mount, because this provider router answers every path under
    // /v1/p/rollbar over HTTP, so a separate mount would never be reached.
    .post('/browser/item', (c) =>
      createBrowserHandoffHandler({
        projectsFor: async (connectionId) => (projects ? projectsMappingConnection(projects, connectionId) : []),
      })(c.req.raw, requestContext(c)),
    )
    .get('/items', async (c) => {
      const available = await rollbarConnections(c, PROVIDER)
      const requested = new Set(
        (c.req.query('integrations') ?? '')
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean),
      )
      const connections = requested.size ? available.filter((connection) => requested.has(connection.id)) : available
      if (!connections.length) return respondError(c, 403, 'provider_not_connected')

      const response = await listItems(c, connections)
      // Only a total wash (no connection succeeded) is a hard error.
      if (allFailed(response, connections.length)) {
        return respondError(c, 502, response.failures[0]!.code)
      }
      return c.json(response)
    })
    .get('/rail-items', async (c) => {
      const connections = await scopedConnections(c, c.req.query('project'), projects)
      if (!connections.length) return c.json({ items: [] })
      const response = await listItems(c, connections)
      if (allFailed(response, connections.length)) {
        return respondError(c, 502, response.failures[0]!.code)
      }
      return c.json({ items: response.items.map(rollbarRailItem) })
    })
    // The rail's Search field (docs/integrations/rollbar.md § Rail search). The same connections as the
    // rows above, asked through Rollbar's items search rather than the capped mirror. `incomplete` says
    // when a connection's page was full or it failed, since either way matches may be missing.
    .get('/rail-search', async (c) => {
      const connections = await scopedConnections(c, c.req.query('project'), projects)
      const query = (c.req.query('q') ?? '').trim().slice(0, MAX_COMMAND_SEARCH_QUERY)
      if (!connections.length || !query) return c.json({ items: [] } satisfies PluginRailSearchResult)
      const answers = await searchItems(c, new Set(connections.map((connection) => connection.id)), query)
      const answered = answers.flatMap((answer) => ('failed' in answer ? [] : [answer]))
      if (!answered.length) return respondError(c, 502, 'provider_unavailable')
      const items = answered.flatMap((answer) => answer.items)
      items.sort((a, b) => (b.lastOccurrenceAt ?? 0) - (a.lastOccurrenceAt ?? 0))
      return c.json({
        items: items.map(rollbarRailItem),
        incomplete: answered.length < connections.length || answered.some((answer) => answer.full),
      } satisfies PluginRailSearchResult)
    })
    // The `Find a Rollbar item` command's rows (docs/plugins/commands.md § Command kinds).
    //
    // The same three facts as the rail beside it — the routed project decides which connections, the
    // cached active-item listing decides which items, and one connection failing does not erase
    // another's — with the reader's word filtering what comes back. Everything it is asked comes from
    // the host: `projectId` is the project the palette session captured and `q` is the typed text, and
    // neither the manifest nor a previous answer can write either one.
    //
    // It spends no extra provider budget. `listItems` goes through the mirrored items resource, whose
    // two-minute TTL the rail is already refreshing (../provider.ts), so typing filters a cached list
    // rather than asking Rollbar per keystroke.
    //
    // What comes back is display facts and the id the project surface is addressed by. There is no
    // token, no account and no verb in it, and no field of it chooses where a pick lands: the manifest's
    // `onSelect` does that, and the host supplies the project it navigates within.
    .get('/palette/issues', async (c) => {
      const connections = await scopedConnections(c, c.req.query('projectId'), projects)
      if (!connections.length) return c.json({ items: [] })
      const response = await listItems(c, connections)
      if (allFailed(response, connections.length)) {
        return respondError(c, 502, response.failures[0]!.code)
      }
      return c.json({ items: rollbarSearchItems(response.items, c.req.query('q') ?? '') })
    })
    .get('/items/:identifier/detail', async (c) => {
      const connectionId = connectionIdFrom(c)
      if (!connectionId) return respondError(c, 400, 'bad_request')
      const result = await rollbarResource<RollbarResourceInput, RollbarItemMetadata>(c, {
        providerId: PROVIDER,
        connectionId,
        resourceId: RESOURCE,
        input: { kind: 'detail', identifier: c.req.param('identifier') },
        force: c.req.query('refresh') === 'true',
      })
      return result.ok
        ? c.json(result.value)
        : respondError(c, result.failure.status, result.failure.error, result.failure.detail)
    })
    .get('/items/:identifier/occurrences', async (c) => {
      const connectionId = connectionIdFrom(c)
      if (!connectionId) return respondError(c, 400, 'bad_request')
      const result = await rollbarResource<RollbarOccurrencesInput, RollbarOccurrencesResponse>(c, {
        providerId: PROVIDER,
        connectionId,
        resourceId: ROLLBAR_OCCURRENCES_RESOURCE,
        input: { identifier: c.req.param('identifier') },
        force: c.req.query('refresh') === 'true',
      })
      return result.ok
        ? c.json(result.value)
        : respondError(c, result.failure.status, result.failure.error, result.failure.detail)
    })
    .get('/items/:identifier/occurrences/:occurrenceId', async (c) => {
      const connectionId = connectionIdFrom(c)
      if (!connectionId) return respondError(c, 400, 'bad_request')
      const result = await rollbarResource<RollbarOccurrenceInput, RollbarOccurrenceDetail>(c, {
        providerId: PROVIDER,
        connectionId,
        resourceId: ROLLBAR_OCCURRENCE_RESOURCE,
        input: { identifier: c.req.param('identifier'), occurrenceId: c.req.param('occurrenceId') },
        force: c.req.query('refresh') === 'true',
      })
      return result.ok
        ? c.json(result.value)
        : respondError(c, result.failure.status, result.failure.error, result.failure.detail)
    })

// The Hono routes over the portable carrier, the only way in. Its request context supplies the
// identity-bound provider runtime without exposing host database or secret-service handles to the
// bundle. `projects` is optional for the suites that drive these routes without a project scope.
export const createRollbarFetch = (projects?: RollbarProjectScope): PluginFetchHandler =>
  portableFetch(createRollbarRoutes(projects))
