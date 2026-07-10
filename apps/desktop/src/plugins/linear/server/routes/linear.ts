import { and, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb, schema } from '../../../../core/server/db'
import {
  ISSUE_DETAIL_QUERY,
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
} from '..'
import type { AppEnv } from '../../../../core/server/middleware/auth'
import { getUser } from '../../../../core/server/middleware/requireUser'
import { respondError } from '../../../../core/server/respond'
import { encodeCached, parseCached } from '../../../../core/server/integrations/codec'
import { connectionHasCapability, forEachConnection, listProviderConnections } from '../../../../core/server/integrations/connections'
import {
  linearNodeToDetail,
  linearProvider,
  linearRef,
  linearSummaryOf,
  type LinearResourceInput,
} from '../provider'
import { runProviderResource } from '../../../../core/server/integrations/resourceRuntime'
import { providerRequestScheduler } from '../../../../core/server/integrations/budgetRuntime'
import { ProviderOperationError } from '../../../../core/server/integrations/types'
import type { LinearIssueDetail, LinearIssuesRequest, LinearIssuesResponse, LinearProject, LinearProjectIssue, LinearProjectIssuesResponse, LinearProjectsResponse } from '../../../../core/shared/api'

// TTL centralized in server/sync/policy.ts. Linear's reads fan out across all connected
// integrations with partial results and per-item (`issues.fetchedAt`) freshness, so they do NOT use
// the serve-then-revalidate wrapper (inventories.md §2d) — the engine owns single-resource flow,
// this owns multi-connection resolution.
const PROVIDER = 'linear'
const ISSUES_TTL_MS = linearProvider.resources.find((resource) => resource.id === 'linear.issues')!.ttlMs

type IntegrationRow = typeof schema.integrations.$inferSelect

// Every connected Linear integration for the user (0..n). A bare identifier is resolved by trying
// these in turn (see resolveIssues). ponytail: first-hit-wins — if two Linears both own an
// identifier, the first row queried shadows the other. Accepted ceiling until colliding prefixes
// across connected workspaces is a real case (then route by team prefix).
const linearConnections = (c: { env: Env }, userId: string) =>
  forEachConnection(getDb(c.env), userId, PROVIDER, c.env.SESSION_ENC_KEY, async (row, key) => ({ row, key }))

const providerFetch = (row: IntegrationRow, key: string, query: string, variables: Record<string, unknown>) =>
  providerRequestScheduler.run(PROVIDER, row.id, linearProvider.budgets, () => linearFetch(key, query, variables))

// Run an issues-shaped query (ISSUES/DETAIL/ID) against each connection until one returns nodes.
// Returns the resolving connection so results can be cached/commented under the right integrationId.
async function resolveIssues(
  c: { env: Env },
  connections: { row: IntegrationRow; key: string }[],
  query: string,
  variables: Record<string, unknown>,
): Promise<{ integrationId: string; key: string; nodes: LinearNode[]; row: IntegrationRow } | null> {
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

// /api/linear — read Linear issues referenced from a PR. Per-user, cached locally (never shared).
// A bare identifier is resolved across all connected Linear integrations (resolveIssues);
// project/browse routes take an explicit ?integration=<id> since the client already knows it.
// Provider CRUD (connect/disconnect) lives in routes/integrations.ts.
export const linear = new Hono<AppEnv>()
  // Projects across every connected Linear integration, each tagged with its connection so the
  // picker can span multiple Linears (docs/workspaces 04). A failing connection is skipped.
  .get('/projects', async (c) => {
    const user = getUser(c)
    const connections = await linearConnections(c, user.login)
    if (!connections.length) return respondError(c, 403, 'provider_not_connected')
    const out: LinearProject[] = []
    for (const { row, key } of connections) {
      const res = await providerFetch(row, key, PROJECTS_QUERY, {})
      if (linearError(res)) continue
      try {
        const { projects } = await linearData<{ projects: { nodes: LinearProjectNode[] } }>(res)
        out.push(...projects.nodes.map((p) => ({ integrationId: row.id, integrationLabel: row.label, id: p.id, name: p.name })))
      } catch {
        // skip this connection
      }
    }
    return c.json({ projects: out } satisfies LinearProjectsResponse)
  })
  // Active issues for the given project ids within ONE connection (?integration=<id>&ids=).
  .get('/project-issues', async (c) => {
    const user = getUser(c)
    const connections = await linearConnections(c, user.login)
    const connection = connections.find(({ row }) => row.id === c.req.query('integration'))
    if (!connection) return respondError(c, 403, 'provider_not_connected')
    const { row, key } = connection
    const ids = [...new Set((c.req.query('ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean))]
    if (!ids.length) return c.json({ issues: [] } satisfies LinearProjectIssuesResponse)
    const res = await providerFetch(row, key, PROJECT_ISSUES_QUERY, { filter: projectIssuesFilter(ids) })
    const err = linearError(res)
    if (err) return respondError(c, err.status, err.status === 401 ? 'provider_needs_auth' : 'provider_unavailable')
    const { issues } = await linearData<{ issues: { nodes: LinearNode[] } }>(res)
    const out: LinearProjectIssue[] = issues.nodes.map((node) => ({
      ...linearSummaryOf(linearNodeToDetail(node)), integrationId: row.id, branchName: node.branchName ?? null,
    }))
    return c.json({ issues: out } satisfies LinearProjectIssuesResponse)
  })
  // Batch enrichment for referenced tickets: summaries, serve-then-revalidate (10-min TTL). Stale
  // identifiers are resolved across all connections; each result is cached under its connection.
  .post('/issues', async (c) => {
    const user = getUser(c)
    const db = getDb(c.env)
    const storedConnections = await listProviderConnections(db, user.login, PROVIDER)
    if (!storedConnections.length) return respondError(c, 403, 'provider_not_connected')
    const connections = await linearConnections(c, user.login)

    const body = (await c.req.json().catch(() => ({}))) as Partial<LinearIssuesRequest>
    const identifiers = [...new Set((body.identifiers ?? []).filter((s) => typeof s === 'string'))]
      .slice(0, linearProvider.budgets.maxResolutionBatch)
    if (!identifiers.length) return c.json({ issues: [] } satisfies LinearIssuesResponse)

    const cached = await db
      .select()
      .from(schema.issues)
      .where(and(eq(schema.issues.userId, user.login), eq(schema.issues.provider, PROVIDER), inArray(schema.issues.identifier, identifiers)))
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
          await db
            .insert(schema.issues)
            .values({ userId: user.login, integrationId: row.id, provider: PROVIDER, identifier: node.identifier, data, fetchedAt: now })
            .onConflictDoUpdate({ target: [schema.issues.userId, schema.issues.integrationId, schema.issues.identifier], set: { data, fetchedAt: now } })
        }
        stale = stale.filter((id) => !found.has(id))
      } catch {
        // try the next connection
      }
    }

    const out = identifiers.map((id) => byId.get(id)).filter((item): item is NonNullable<typeof item> => !!item)
    return c.json({ issues: out.map((item) => linearProvider.codec!.summary(item)) } satisfies LinearIssuesResponse)
  })
  // Full detail for the side panel. refresh=1 (panel open) always refetches to stay current.
  .get('/issues/:identifier', async (c) => {
    const user = getUser(c)
    const identifier = c.req.param('identifier')
    const connectionId = c.req.query('integration')
    const refresh = c.req.query('refresh') === '1'
    const db = getDb(c.env)
    const now = Date.now()

    if (connectionId) {
      const result = await runProviderResource<LinearResourceInput, LinearIssueDetail>({
        db,
        userId: user.login,
        encryptionKey: c.env.SESSION_ENC_KEY,
        providerId: PROVIDER,
        connectionId,
        resourceId: 'linear.issues',
        input: { kind: 'detail', identifier },
        force: refresh,
      })
      return result.ok ? c.json(result.value) : respondError(c, result.failure.status, result.failure.error, result.failure.detail)
    }

    const stored = await listProviderConnections(db, user.login, PROVIDER)
    if (!stored.length) return respondError(c, 403, 'provider_not_connected')
    const cached = await db
      .select()
      .from(schema.issues)
      .where(and(eq(schema.issues.userId, user.login), eq(schema.issues.provider, PROVIDER), eq(schema.issues.identifier, identifier)))
    const order = new Map(stored.map((connection, index) => [connection.id, index]))
    const cachedRow = cached.sort((a, b) => (order.get(a.integrationId) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.integrationId) ?? Number.MAX_SAFE_INTEGER))[0]
    const cachedItem = cachedRow
      ? parseCached(linearProvider.codec!, cachedRow.data, linearRef(cachedRow.integrationId, cachedRow.identifier))
      : null
    if (!refresh && cachedRow && cachedRow.fetchedAt + ISSUES_TTL_MS > now && cachedItem?.ok && cachedItem.value.detail) {
      return c.json(cachedItem.value.detail)
    }

    const connections = await linearConnections(c, user.login)
    if (!connections.length && cachedItem?.ok && cachedItem.value.detail) return c.json(cachedItem.value.detail)
    if (!connections.length) return respondError(c, 403, 'provider_not_connected')

    const filter = issuesFilter([identifier])
    if (!filter) return respondError(c, 404, 'provider_resource_not_found')
    const resolved = await resolveIssues(c, connections, ISSUE_DETAIL_QUERY, { filter })
    if (!resolved) {
      if (cachedItem?.ok && cachedItem.value.detail) return c.json(cachedItem.value.detail)
      return respondError(c, 404, 'provider_resource_not_found')
    }
    const detail = linearNodeToDetail(resolved.nodes[0])
    const item = linearProvider.codec!.withDetail(linearRef(resolved.integrationId, detail.identifier, detail.url), linearSummaryOf(detail), detail, now)
    const data = encodeCached(item, linearProvider.budgets.maxCachedItemBytes)
    await db
      .insert(schema.issues)
      .values({ userId: user.login, integrationId: resolved.integrationId, provider: PROVIDER, identifier: detail.identifier, data, fetchedAt: now })
      .onConflictDoUpdate({ target: [schema.issues.userId, schema.issues.integrationId, schema.issues.identifier], set: { data, fetchedAt: now } })
    return c.json(detail)
  })
  // Add a comment (or threaded reply via parentId) to a ticket. Client refetches detail after.
  .post('/issues/:identifier/comments', async (c) => {
    const user = getUser(c)
    const requestedConnectionId = c.req.query('integration')
    const allConnections = await linearConnections(c, user.login)
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
    const resolved = await resolveIssues(c, connections, ISSUE_ID_QUERY, { filter })
    const issueId = resolved?.nodes[0]?.id
    if (!resolved || !issueId) return respondError(c, 404, 'provider_resource_not_found')
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
