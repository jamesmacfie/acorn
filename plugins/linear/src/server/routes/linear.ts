import { Hono, type Context } from 'hono'
import {
  ASSIGNED_ISSUES_QUERY,
  ISSUE_ID_QUERY,
  ISSUES_QUERY,
  type LinearNode,
  type LinearProjectNode,
  PROJECTS_QUERY,
  PROJECT_ISSUES_QUERY,
  projectIssuesFilter,
  issuesFilter,
  linearData,
  linearError,
  linearFetch,
  type ViewerAssignedIssues,
} from '..'
import {
  type AppEnv,
  connectionHasCapability,
  type CoreServices,
  encodeCached,
  ownedConnections as hostOwnedConnections,
  ownedExternalItems as hostOwnedExternalItems,
  parseCached,
  type PluginFetchHandler,
  type PluginProviderResourceRequest,
  type PluginRequestContext,
  ProviderOperationError,
  providerRequestScheduler,
  providerResource as hostProviderResource,
  respondError,
  type RouteFailure,
  type RouteResult,
  type StoredConnection,
  withOwnedConnections as hostWithOwnedConnections,
} from '@acorn/plugin-api/node'
import {
  linearNodeToDetail,
  linearProvider,
  linearRef,
  linearSummaryOf,
  type LinearResourceInput,
} from '../provider'
import type {
  LinearIssueDetail,
  LinearIssuesRequest,
  LinearIssuesResponse,
  LinearProject,
  LinearProjectIssue,
  LinearProjectIssuesResponse,
  LinearProjectsResponse,
  LinearRailItemsResponse,
} from '../../shared/api'
import { linearRailItem } from '../../shared/rail'
import { sortLinearIssues } from '../../shared/triage'

// TTL centralized in server/sync/policy.ts. Linear's reads fan out across all connected
// integrations with partial results and per-item (`issues.fetchedAt`) freshness, so they do NOT use
// the serve-then-revalidate wrapper (docs/caching.md) — the engine owns single-resource flow,
// this owns multi-connection resolution.
const PROVIDER = 'linear'
const ISSUES_TTL_MS = linearProvider.resources.find((resource) => resource.id === 'linear.issues')!.ttlMs

// ── The two-tier carrier ──────────────────────────────────────────────────────────────────────────
//
// One set of Hono routes serving both tiers. Compiled in, the host mounts the router itself and the
// helpers below read the database, the owner and the secret service off `c.env`. Loaded from disk, a
// Hono instance cannot cross the contract, so the host gets `router.fetch` and the identity-bound
// runtime rides in through `c.env` behind a module-level symbol nothing outside this file can name.
//
// The pairs are not a compatibility shim to delete later: the request context deliberately exposes
// provider operations rather than handles, so a plugin that has BOTH tiers has to choose per call site.
const PORTABLE_REQUEST_CONTEXT = Symbol('linear-plugin-request-context')

type PortableBindings = AppEnv['Bindings'] & {
  [PORTABLE_REQUEST_CONTEXT]?: PluginRequestContext
}

const portableContext = (c: Context<AppEnv>): PluginRequestContext | undefined =>
  (c.env as PortableBindings)[PORTABLE_REQUEST_CONTEXT]

/** Every Linear connection this caller owns, credentials still sealed. */
const linearStored = (c: Context<AppEnv>): Promise<StoredConnection[]> => {
  const context = portableContext(c)
  return context ? context.providers.connections(PROVIDER) : hostOwnedConnections(c, PROVIDER)
}

/** The same list with each credential unsealed for the duration of the visit, never beyond it. */
const linearConnections = (c: Context<AppEnv>): Promise<{ row: StoredConnection; key: string }[]> => {
  const visit = async (row: StoredConnection, key: string) => ({ row, key })
  const context = portableContext(c)
  return context
    ? context.providers.withConnections(PROVIDER, visit)
    : hostWithOwnedConnections(c, PROVIDER, visit)
}

const linearResource = <TInput, TOutput>(
  c: Context<AppEnv>,
  request: PluginProviderResourceRequest<TInput>,
): Promise<RouteResult<TOutput>> => {
  const context = portableContext(c)
  return context
    ? context.providers.resource<TInput, TOutput>(request)
    : hostProviderResource<TInput, TOutput>(c, request)
}

/** Core's external-item cache for this owner, which the batch route reads ACROSS connections. */
const linearItems = (c: Context<AppEnv>) => {
  const context = portableContext(c)
  return context ? context.providers.items(PROVIDER) : hostOwnedExternalItems(c)
}

// The request scheduler is a module-level singleton, so a loaded bundle carries its OWN instance: budgets
// are enforced per bundle rather than shared with the host's resource path. Honest to note, harmless in
// practice — both instances read the same declared budget and Linear's own limiter is the real ceiling.
const providerFetch = (row: StoredConnection, key: string, query: string, variables: Record<string, unknown>) =>
  providerRequestScheduler.run(PROVIDER, row.id, linearProvider.budgets, () => linearFetch(key, query, variables))

// Run an issues-shaped query (ISSUES/ID) against each connection until one returns nodes. Returns the
// resolving connection so a mutation can be sent with the right workspace's credential.
async function resolveIssues(
  connections: { row: StoredConnection; key: string }[],
  query: string,
  variables: Record<string, unknown>,
): Promise<{ integrationId: string; key: string; nodes: LinearNode[]; row: StoredConnection } | null> {
  for (const { row, key } of connections) {
    const res = await providerFetch(row, key, query, variables)
    if (linearError(res)) continue
    try {
      const { issues } = await linearData<{ issues: { nodes: LinearNode[] } }>(res)
      if (issues.nodes.length) return { integrationId: row.id, key, nodes: issues.nodes, row }
    } catch {
      // try the next connection
    }
  }
  return null
}

const triageRow = (row: StoredConnection, node: LinearNode): LinearProjectIssue => {
  const detail = linearNodeToDetail(node)
  return {
    ...linearSummaryOf(detail),
    integrationId: row.id,
    branchName: detail.branchName ?? null,
    priority: detail.priority ?? null,
    priorityLabel: detail.priorityLabel ?? null,
    updatedAt: detail.updatedAt ?? null,
    labels: detail.labels ?? [],
  }
}

type LinearProjectScope = Pick<CoreServices['projects'], 'byId' | 'externalProjects'>

/**
 * Which Linear projects the routed project's WORKSPACE follows, keyed by connection. `null` means
 * nothing is mapped, which is a different answer from "mapped to an empty set" and is what selects the
 * rail's fallback mode. Linked Linear projects hang off the workspace, not the project
 * (docs/workspaces-and-tasks.md), and the descriptor only ever tells us the project.
 */
async function mappedProjects(
  c: Context<AppEnv>,
  projects?: LinearProjectScope,
): Promise<Map<string, string[]> | null> {
  const projectId = c.req.query('project')
  if (!projectId || !projects) return null
  const project = await projects.byId(projectId)
  if (!project) return null
  // Scoped to linear-owned providers for a loaded plugin, unscoped for a built-in. Either way the
  // caller intersects with its OWN connections below, so another provider's mapping cannot leak in.
  const rows = await projects.externalProjects(project.workspaceId)
  if (!rows.length) return null
  const byConnection = new Map<string, string[]>()
  for (const row of rows) {
    byConnection.set(row.connectionId, [...(byConnection.get(row.connectionId) ?? []), row.externalId])
  }
  return byConnection
}

// /v2/p/linear — read Linear issues referenced from a PR, plus the rail source's rows. Per-user, cached
// locally (never shared). A bare identifier is resolved across all connected Linear integrations;
// project/browse routes take an explicit ?integration=<id> since the caller already knows it.
// Provider CRUD (connect/disconnect) lives in core's routes/integrations.ts.
export const createLinearRoutes = (projects?: LinearProjectScope) => new Hono<AppEnv>()
  // Projects across every connected Linear integration, each tagged with its connection so a picker
  // could span multiple Linears. Nothing in the shell calls this today — the browse that did is a
  // host-drawn rail now and the mapping it wrote has no writer left (see ASSIGNED_ISSUES_QUERY).
  .get('/projects', async (c) => {
    const connections = await linearConnections(c)
    if (!connections.length) return respondError(c, 403, 'provider_not_connected')
    const out: LinearProject[] = []
    for (const { row, key } of connections) {
      const res = await providerFetch(row, key, PROJECTS_QUERY, {})
      if (linearError(res)) continue
      try {
        const { projects: found } = await linearData<{ projects: { nodes: LinearProjectNode[] } }>(res)
        out.push(...found.nodes.map((p) => ({ integrationId: row.id, integrationLabel: row.label, id: p.id, name: p.name })))
      } catch {
        // skip this connection
      }
    }
    return c.json({ projects: out } satisfies LinearProjectsResponse)
  })
  // Active issues for the given project ids within ONE connection (?integration=<id>&ids=). Also without
  // a caller in the shell, for the same reason as /projects: the rail builds its mapped rows from this
  // query directly, and the browse that fanned out over the route is gone. Kept because it is the
  // single-connection form of a read the rail already performs, and it is the one place the
  // active-only filter and the branch-suggestion passthrough are covered by a test.
  .get('/project-issues', async (c) => {
    const connections = await linearConnections(c)
    const connection = connections.find(({ row }) => row.id === c.req.query('integration'))
    if (!connection) return respondError(c, 403, 'provider_not_connected')
    const { row, key } = connection
    const ids = [...new Set((c.req.query('ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean))]
    if (!ids.length) return c.json({ issues: [] } satisfies LinearProjectIssuesResponse)
    const res = await providerFetch(row, key, PROJECT_ISSUES_QUERY, { filter: projectIssuesFilter(ids) })
    const err = linearError(res)
    if (err) return respondError(c, err.status, err.status === 401 ? 'provider_needs_auth' : 'provider_unavailable')
    const { issues } = await linearData<{ issues: { nodes: LinearNode[] } }>(res)
    return c.json({ issues: issues.nodes.map((node) => triageRow(row, node)) } satisfies LinearProjectIssuesResponse)
  })
  // The declarative rail source's rows. Degrades to an empty list rather than an error at every step: a
  // rail that shouts is worse than a rail that is quiet, and none of these conditions is the user doing
  // something wrong (docs/plugins.md § Descriptors).
  .get('/rail-items', async (c) => {
    const connections = await linearConnections(c)
    if (!connections.length) return c.json({ items: [] } satisfies LinearRailItemsResponse)
    const mapped = await mappedProjects(c, projects)
    const issues: LinearProjectIssue[] = []
    for (const { row, key } of connections) {
      const projectIds = mapped?.get(row.id) ?? []
      // A mapping that names other connections excludes this one; no mapping at all falls back.
      if (mapped && !projectIds.length) continue
      try {
        const res = projectIds.length
          ? await providerFetch(row, key, PROJECT_ISSUES_QUERY, { filter: projectIssuesFilter(projectIds) })
          : await providerFetch(row, key, ASSIGNED_ISSUES_QUERY, {})
        if (linearError(res)) continue
        const nodes = projectIds.length
          ? (await linearData<{ issues: { nodes: LinearNode[] } }>(res)).issues.nodes
          : (await linearData<ViewerAssignedIssues>(res)).viewer.assignedIssues.nodes
        issues.push(...nodes.map((node) => triageRow(row, node)))
      } catch {
        // Partial success is honest: one workspace failing must not erase another's rows.
      }
    }
    return c.json({ items: sortLinearIssues(issues).map(linearRailItem) } satisfies LinearRailItemsResponse)
  })
  // Batch enrichment for referenced tickets: summaries, 10-minute TTL over core's external-item cache.
  // Stale identifiers are resolved across all connections; each result is cached under its connection.
  .post('/issues', async (c) => {
    const storedConnections = await linearStored(c)
    if (!storedConnections.length) return respondError(c, 403, 'provider_not_connected')
    const connections = await linearConnections(c)

    const body = (await c.req.json().catch(() => ({}))) as Partial<LinearIssuesRequest>
    const identifiers = [...new Set((body.identifiers ?? []).filter((s) => typeof s === 'string'))]
      .slice(0, linearProvider.budgets.maxResolutionBatch)
    if (!identifiers.length) return c.json({ issues: [] } satisfies LinearIssuesResponse)

    // Deliberately NOT scoped to one connection: a bare `ENG-42` has not been resolved to a workspace
    // yet, so the cache read spans every connected Linear and the sort below is what picks the winner.
    // `listByIdentifier` is the store's one read with that shape, and it absorbs the empty-list case
    // that `inArray` turns into a SQL error. It is also the one call that made the loaded tier need an
    // item-store seam at all — no per-connection `resource()` can express a read across connections.
    const items = linearItems(c)
    const cached = await items.listByIdentifier(PROVIDER, identifiers)
    const now = Date.now()
    const byId = new Map<string, ReturnType<NonNullable<typeof linearProvider.codec>['mergeSummary']>>()
    const byConnectionAndId = new Map<string, ReturnType<NonNullable<typeof linearProvider.codec>['mergeSummary']>>()
    const fresh = new Set<string>()
    const order = new Map(storedConnections.map((row, index) => [row.id, index]))
    cached.sort((a, b) => (order.get(a.integrationId) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.integrationId) ?? Number.MAX_SAFE_INTEGER))
    for (const row of cached) {
      const parsed = parseCached(linearProvider.codec!, row.data, linearRef(row.integrationId, row.identifier))
      if (parsed.ok) {
        byConnectionAndId.set(`${row.integrationId}:${row.identifier}`, parsed.value)
        if (!byId.has(row.identifier)) {
          byId.set(row.identifier, parsed.value)
          if (row.fetchedAt + ISSUES_TTL_MS > now) fresh.add(row.identifier)
        }
      }
    }

    let stale = identifiers.filter((id) => !fresh.has(id))
    // Try each connection for whatever's still unresolved; found ids drop out of the next pass.
    for (const { row, key } of connections) {
      if (!stale.length) break
      const filter = issuesFilter(stale)
      if (!filter) break
      try {
        const res = await providerFetch(row, key, ISSUES_QUERY, { filter })
        if (linearError(res)) continue
        const { issues } = await linearData<{ issues: { nodes: LinearNode[] } }>(res)
        const found = new Set<string>()
        for (const node of issues.nodes) {
          const summary = linearSummaryOf(linearNodeToDetail(node))
          const item = linearProvider.codec!.mergeSummary(
            byConnectionAndId.get(`${row.id}:${node.identifier}`) ?? null,
            linearRef(row.id, node.identifier, node.url),
            summary,
            now,
          )
          byId.set(node.identifier, item)
          byConnectionAndId.set(`${row.id}:${node.identifier}`, item)
          found.add(node.identifier)
          const data = encodeCached(item, linearProvider.budgets.maxCachedItemBytes)
          await items.write({ connectionId: row.id, provider: PROVIDER, identifier: node.identifier, data, fetchedAt: now })
        }
        stale = stale.filter((id) => !found.has(id))
      } catch {
        // try the next connection
      }
    }

    const out = identifiers.map((id) => byId.get(id)).filter((item): item is NonNullable<typeof item> => !!item)
    return c.json({ issues: out.map((item) => linearProvider.codec!.summary(item)) } satisfies LinearIssuesResponse)
  })
  // Full detail for the panel. Always through the mirrored resource, which owns the cache read, the TTL,
  // the secret scope and the write-back.
  //
  // Without ?integration this asks each connected workspace in turn and takes the first that answers,
  // because which workspace owns a bare `ENG-42` is exactly what is unknown. That replaced a hand-rolled
  // cache read plus a second fan-out doing the same resolution: the loop is the resolution, and the
  // resource is the cache. refresh=1 (which opening the panel always sends) forces a live read.
  .get('/issues/:identifier', async (c) => {
    const identifier = c.req.param('identifier')
    const requested = c.req.query('integration')
    const force = c.req.query('refresh') === '1'
    const stored = await linearStored(c)
    const candidates = requested ? stored.filter((row) => row.id === requested) : stored
    if (!candidates.length) return respondError(c, 403, 'provider_not_connected')

    let failure: RouteFailure | null = null
    for (const connection of candidates) {
      const result = await linearResource<LinearResourceInput, LinearIssueDetail>(c, {
        providerId: PROVIDER,
        connectionId: connection.id,
        resourceId: 'linear.issues',
        input: { kind: 'detail', identifier },
        force,
      })
      if (result.ok) return c.json(result.value)
      // "Not in this workspace" is the expected answer from every connection but one, so a real failure
      // from any of them is the more useful thing to report.
      if (!failure || failure.status === 404) failure = result.failure
    }
    return respondError(c, failure!.status, failure!.error, failure!.detail)
  })
  // Add a comment (or threaded reply via parentId) to a ticket. Client refetches detail after.
  .post('/issues/:identifier/comments', async (c) => {
    const requestedConnectionId = c.req.query('integration')
    const allConnections = await linearConnections(c)
    const connections = requestedConnectionId
      ? allConnections.filter(({ row }) => row.id === requestedConnectionId)
      : allConnections
    if (!connections.length) return respondError(c, 403, 'provider_not_connected')

    const identifier = c.req.param('identifier')
    const { body, parentId } = (await c.req.json().catch(() => ({}))) as { body?: string; parentId?: string }
    if (!body || !body.trim()) return respondError(c, 400, 'bad_request')

    // commentCreate keys off the internal issue UUID; resolve it (and the owning connection's key).
    const filter = issuesFilter([identifier])
    if (!filter) return respondError(c, 404, 'provider_resource_not_found')
    const resolved = await resolveIssues(connections, ISSUE_ID_QUERY, { filter })
    const issueId = resolved?.nodes[0]?.id
    if (!resolved || !issueId) return respondError(c, 404, 'provider_resource_not_found')
    // The default registry argument is the HOST's when this is compiled in and the bundle's own empty
    // copy when it is loaded, so on the loaded tier this resolves from the stored capability map alone —
    // which linear's `normalize` always writes. Deliberate rather than lucky: the row is the record of
    // what the connection was granted, and the descriptor is only its default.
    if (!connectionHasCapability(resolved.row, 'comments')) return respondError(c, 403, 'provider_missing_scope')

    const input: Record<string, unknown> = { issueId, body: body.trim() }
    if (parentId) input.parentId = parentId
    try {
      const mutation = linearProvider.mutations!.find((item) => item.id === 'linear.comment')!
      await providerRequestScheduler.run(PROVIDER, resolved.row.id, linearProvider.budgets, () =>
        mutation.run!({ secret: resolved.key, input }),
      )
    } catch (error) {
      if (error instanceof ProviderOperationError) return respondError(c, error.status, error.code)
      return respondError(c, 502, 'provider_unavailable')
    }
    return c.json({ ok: true })
  })

// The concrete router, for the compiled mount and for the direct route tests that drive these handlers
// without a plugin host. It has no `projects` scope, so /rail-items falls back for every connection —
// which is what a test asserting the fallback wants anyway.
export const linear = createLinearRoutes()

// The same Hono routes over the portable carrier. Its request context supplies the identity-bound
// provider runtime without exposing host database or secret-service handles to the bundle.
export const createLinearFetch = (projects: LinearProjectScope): PluginFetchHandler => {
  const routes = createLinearRoutes(projects)
  return (request, context) => routes.fetch(request, { [PORTABLE_REQUEST_CONTEXT]: context } as PortableBindings)
}
