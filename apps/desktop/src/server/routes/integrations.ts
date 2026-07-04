import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb, schema } from '../db'
import {
  COMMENT_CREATE,
  ISSUE_DETAIL_QUERY,
  ISSUE_ID_QUERY,
  ISSUES_QUERY,
  type LinearNode,
  type LinearProjectNode,
  PROJECTS_QUERY,
  PROJECT_ISSUES_QUERY,
  projectIssuesFilter,
  type Viewer,
  VIEWER_QUERY,
  issuesFilter,
  linearData,
  linearError,
  linearFetch,
} from '../linear'
import type { AppEnv } from '../middleware/auth'
import { projectPath, rollbarData, rollbarFetch, type RollbarProject } from '../rollbar'
import { decryptSecret, encryptSecret } from '../session'
import type { ConnectIntegrationRequest, Integration, IntegrationsResponse, LinearActivity, LinearIssueDetail, LinearIssuesRequest, LinearIssuesResponse, LinearProject, LinearProjectIssue, LinearProjectIssuesResponse, LinearProjectsResponse } from '../../shared/api'

const PROVIDER = 'linear'
const ISSUES_STALE_AFTER_MS = 600_000 // 10 min — tickets change slower than PRs; panel forces fresh

type IntegrationRow = typeof schema.integrations.$inferSelect

// Every connected Linear integration for the user (0..n). A bare identifier is resolved by trying
// these in turn (see resolveIssues). ponytail: first-hit-wins — if two Linears both own an
// identifier, the first row queried shadows the other. Accepted ceiling until colliding prefixes
// across connected workspaces is a real case (then route by team prefix).
async function linearRows(c: { env: Env }, userId: string): Promise<IntegrationRow[]> {
  return getDb(c.env)
    .select()
    .from(schema.integrations)
    .where(and(eq(schema.integrations.userId, userId), eq(schema.integrations.provider, PROVIDER)))
}

const rowKey = (c: { env: Env }, row: IntegrationRow) => decryptSecret(row.accessToken, c.env.SESSION_ENC_KEY)

// Run an issues-shaped query (ISSUES/DETAIL/ID) against each connection until one returns nodes.
// Returns the resolving connection so results can be cached/commented under the right integrationId.
async function resolveIssues(
  c: { env: Env },
  rows: IntegrationRow[],
  query: string,
  variables: Record<string, unknown>,
): Promise<{ integrationId: string; key: string; nodes: LinearNode[] } | null> {
  for (const row of rows) {
    const key = await rowKey(c, row)
    if (!key) continue
    const res = await linearFetch(key, query, variables)
    if (linearError(res)) continue
    try {
      const { issues } = await linearData<{ issues: { nodes: LinearNode[] } }>(res)
      if (issues.nodes.length) return { integrationId: row.id, key, nodes: issues.nodes }
    } catch {
      // try the next connection
    }
  }
  return null
}

// Flatten an issue's history into a chronological activity feed (oldest first). One history event
// may carry several changes, so we emit one line per change — matching Linear's activity list.
// Label changes arrive as IDs; resolve to names via the issue's current labels (removed labels we
// no longer hold show as "—"). ponytail: covers state/assignee/label/title; widen if needed.
function buildActivity(n: LinearNode): LinearActivity[] {
  const labels = new Map((n.labels?.nodes ?? []).map((l) => [l.id, l.name]))
  const items: LinearActivity[] = []
  if (n.createdAt)
    items.push({ id: 'created', actor: n.creator?.name ?? null, text: 'created the issue', createdAt: Date.parse(n.createdAt) || null, icon: 'created' })
  for (const h of n.history?.nodes ?? []) {
    const actor = h.actor?.name ?? h.botActor?.name ?? null
    const at = Date.parse(h.createdAt) || null
    const push = (icon: string, text: string, color?: string) => items.push({ id: `${h.id}:${items.length}`, actor, text, createdAt: at, icon, color })
    if (h.toState) push('state', h.fromState ? `moved from ${h.fromState.name} to ${h.toState.name}` : `moved to ${h.toState.name}`, h.toState.color)
    if (h.toAssignee) push('assignee', h.toAssignee.name === actor ? 'self-assigned the issue' : `assigned to ${h.toAssignee.name}`)
    else if (h.fromAssignee) push('assignee', 'unassigned the issue')
    for (const id of h.addedLabelIds ?? []) push('label', `added label ${labels.get(id) ?? '—'}`)
    for (const id of h.removedLabelIds ?? []) push('label', `removed label ${labels.get(id) ?? '—'}`)
    if (h.toTitle && h.fromTitle) push('title', 'changed the title')
  }
  return items.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
}

function nodeToDetail(n: LinearNode): LinearIssueDetail {
  return {
    id: n.id,
    identifier: n.identifier,
    title: n.title,
    url: n.url,
    state: n.state,
    assignee: n.assignee?.name ?? null,
    description: n.description ?? null,
    comments: (n.comments?.nodes ?? []).map((cm) => ({
      id: cm.id,
      author: cm.user?.name ?? null,
      body: cm.body,
      createdAt: Date.parse(cm.createdAt) || null,
      parentId: cm.parent?.id ?? null,
    })),
    activity: buildActivity(n),
  }
}

const toSummary = (d: LinearIssueDetail) => ({ identifier: d.identifier, title: d.title, url: d.url, state: d.state, assignee: d.assignee })

const metaWorkspace = (meta: string | null): string | undefined => (meta ? (JSON.parse(meta) as { workspace?: string }).workspace : undefined)
const rowToIntegration = (r: IntegrationRow): Integration => ({ id: r.id, provider: r.provider as Integration['provider'], label: r.label, connected: true, workspace: metaWorkspace(r.meta) })

// /api/integrations — list/connect/disconnect third-party providers. Multi-row per provider; GitHub
// is synthesized (identity root, token lives in the session cookie), not a stored row.
export const integrations = new Hono<AppEnv>()
  .get('/', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'unauthenticated' }, 401)
    const rows = await getDb(c.env).select().from(schema.integrations).where(eq(schema.integrations.userId, user.login))
    const list: Integration[] = [
      { id: 'github', provider: 'github', label: user.login, connected: true },
      ...rows.map(rowToIntegration),
    ]
    return c.json({ integrations: list } satisfies IntegrationsResponse)
  })
  // Connect a provider by pasting a token (validated + encrypted). Returns the new row. Multiple
  // rows of the same provider are allowed — each is a distinct connection.
  .post('/', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'unauthenticated' }, 401)
    const { provider, token } = (await c.req.json().catch(() => ({}))) as Partial<ConnectIntegrationRequest>
    if (!token || typeof token !== 'string') return c.json({ error: 'bad_request' }, 400)
    if (provider !== 'linear' && provider !== 'rollbar') return c.json({ error: 'unsupported_provider' }, 400)

    // Rollbar (docs/next 10): a project-read token, validated with one cheap /project call.
    if (provider === 'rollbar') {
      let project: RollbarProject
      try {
        project = await rollbarData<RollbarProject>(await rollbarFetch(token.trim(), projectPath))
      } catch {
        return c.json({ error: 'invalid_key' }, 400)
      }
      const row = {
        id: randomUUID(),
        userId: user.login,
        provider: 'rollbar',
        label: `Rollbar · ${project.name}`,
        accessToken: await encryptSecret(token.trim(), c.env.SESSION_ENC_KEY),
        meta: JSON.stringify({ project: project.name, projectId: project.id }),
        createdAt: Date.now(),
      }
      await getDb(c.env).insert(schema.integrations).values(row)
      return c.json({ integration: rowToIntegration(row) })
    }

    // Validate the key by reading the viewer; reject anything that doesn't authenticate.
    const res = await linearFetch(token.trim(), VIEWER_QUERY, {})
    if (linearError(res)) return c.json({ error: 'invalid_key' }, 400)
    let workspace: string
    try {
      workspace = (await linearData<Viewer>(res)).viewer.organization.name
    } catch {
      return c.json({ error: 'invalid_key' }, 400)
    }

    const row = { id: randomUUID(), userId: user.login, provider: PROVIDER, label: `Linear · ${workspace}`, accessToken: await encryptSecret(token.trim(), c.env.SESSION_ENC_KEY), meta: JSON.stringify({ workspace }), createdAt: Date.now() }
    await getDb(c.env).insert(schema.integrations).values(row)
    return c.json({ integration: rowToIntegration(row) })
  })
  // Disconnect one connection by id; cascade its workspace links, cached issues, and task links.
  .delete('/:id', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'unauthenticated' }, 401)
    const id = c.req.param('id')
    if (id === 'github') return c.json({ error: 'cannot_disconnect_github' }, 400)
    const db = getDb(c.env)
    await db.delete(schema.workspaceProjects).where(eq(schema.workspaceProjects.integrationId, id))
    await db.delete(schema.issues).where(and(eq(schema.issues.userId, user.login), eq(schema.issues.integrationId, id)))
    await db.delete(schema.taskLinks).where(eq(schema.taskLinks.integrationId, id))
    await db.delete(schema.integrations).where(and(eq(schema.integrations.id, id), eq(schema.integrations.userId, user.login)))
    return c.body(null, 204)
  })

// /api/linear — read Linear issues referenced from a PR. Per-user, cached locally (never shared).
// A bare identifier is resolved across all connected Linear integrations (resolveIssues);
// project/browse routes take an explicit ?integration=<id> since the client already knows it.
export const linear = new Hono<AppEnv>()
  // Projects across every connected Linear integration, each tagged with its connection so the
  // picker can span multiple Linears (docs/workspaces 04). A failing connection is skipped.
  .get('/projects', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'unauthenticated' }, 401)
    const rows = await linearRows(c, user.login)
    if (!rows.length) return c.json({ error: 'linear_not_connected' }, 403)
    const out: LinearProject[] = []
    for (const row of rows) {
      const key = await rowKey(c, row)
      if (!key) continue
      const res = await linearFetch(key, PROJECTS_QUERY, {})
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
    const user = c.get('user')
    if (!user) return c.json({ error: 'unauthenticated' }, 401)
    const rows = await linearRows(c, user.login)
    const row = rows.find((r) => r.id === c.req.query('integration'))
    if (!row) return c.json({ error: 'linear_not_connected' }, 403)
    const key = await rowKey(c, row)
    if (!key) return c.json({ error: 'linear_not_connected' }, 403)
    const ids = [...new Set((c.req.query('ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean))]
    if (!ids.length) return c.json({ issues: [] } satisfies LinearProjectIssuesResponse)
    const res = await linearFetch(key, PROJECT_ISSUES_QUERY, { filter: projectIssuesFilter(ids) })
    const err = linearError(res)
    if (err) return c.json({ error: err.error }, err.status)
    const { issues } = await linearData<{ issues: { nodes: LinearNode[] } }>(res)
    const out: LinearProjectIssue[] = issues.nodes.map((n) => ({ ...toSummary(nodeToDetail(n)), integrationId: row.id, branchName: n.branchName ?? null }))
    return c.json({ issues: out } satisfies LinearProjectIssuesResponse)
  })
  // Batch enrichment for referenced tickets: summaries, serve-then-revalidate (10-min TTL). Stale
  // identifiers are resolved across all connections; each result is cached under its connection.
  .post('/issues', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'unauthenticated' }, 401)
    const rows = await linearRows(c, user.login)
    if (!rows.length) return c.json({ error: 'linear_not_connected' }, 403)

    const body = (await c.req.json().catch(() => ({}))) as Partial<LinearIssuesRequest>
    const identifiers = [...new Set((body.identifiers ?? []).filter((s) => typeof s === 'string'))]
    if (!identifiers.length) return c.json({ issues: [] } satisfies LinearIssuesResponse)

    const db = getDb(c.env)
    const cached = await db
      .select()
      .from(schema.issues)
      .where(and(eq(schema.issues.userId, user.login), eq(schema.issues.provider, PROVIDER), inArray(schema.issues.identifier, identifiers)))
    const now = Date.now()
    const byId = new Map<string, LinearIssueDetail>()
    const fresh = new Set<string>()
    for (const row of cached) {
      byId.set(row.identifier, JSON.parse(row.data) as LinearIssueDetail)
      if (row.fetchedAt + ISSUES_STALE_AFTER_MS > now) fresh.add(row.identifier)
    }

    let stale = identifiers.filter((id) => !fresh.has(id))
    // Try each connection for whatever's still unresolved; found ids drop out of the next pass.
    for (const row of rows) {
      if (!stale.length) break
      const key = await rowKey(c, row)
      if (!key) continue
      const filter = issuesFilter(stale)
      if (!filter) break
      try {
        const res = await linearFetch(key, ISSUES_QUERY, { filter })
        if (linearError(res)) continue
        const { issues } = await linearData<{ issues: { nodes: LinearNode[] } }>(res)
        const found = new Set<string>()
        for (const node of issues.nodes) {
          const prev = byId.get(node.identifier)
          const detail: LinearIssueDetail = { ...nodeToDetail(node), description: prev?.description ?? null, comments: prev?.comments ?? [], activity: prev?.activity ?? [] }
          byId.set(node.identifier, detail)
          found.add(node.identifier)
          await db
            .insert(schema.issues)
            .values({ userId: user.login, integrationId: row.id, provider: PROVIDER, identifier: node.identifier, data: JSON.stringify(detail), fetchedAt: now })
            .onConflictDoUpdate({ target: [schema.issues.userId, schema.issues.integrationId, schema.issues.identifier], set: { data: JSON.stringify(detail), fetchedAt: now } })
        }
        stale = stale.filter((id) => !found.has(id))
      } catch {
        // try the next connection
      }
    }

    const out = identifiers.map((id) => byId.get(id)).filter((d): d is LinearIssueDetail => !!d)
    return c.json({ issues: out.map(toSummary) } satisfies LinearIssuesResponse)
  })
  // Full detail for the side panel. refresh=1 (panel open) always refetches to stay current.
  .get('/issues/:identifier', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'unauthenticated' }, 401)
    const rows = await linearRows(c, user.login)
    if (!rows.length) return c.json({ error: 'linear_not_connected' }, 403)

    const identifier = c.req.param('identifier')
    const refresh = c.req.query('refresh') === '1'
    const db = getDb(c.env)
    const now = Date.now()

    if (!refresh) {
      const cached = await db
        .select()
        .from(schema.issues)
        .where(and(eq(schema.issues.userId, user.login), eq(schema.issues.provider, PROVIDER), eq(schema.issues.identifier, identifier)))
      const row = cached[0]
      if (row && row.fetchedAt + ISSUES_STALE_AFTER_MS > now) return c.json(JSON.parse(row.data) as LinearIssueDetail)
    }

    const filter = issuesFilter([identifier])
    if (!filter) return c.json({ error: 'not_found' }, 404)
    const resolved = await resolveIssues(c, rows, ISSUE_DETAIL_QUERY, { filter })
    if (!resolved) return c.json({ error: 'not_found' }, 404)
    const detail = nodeToDetail(resolved.nodes[0])
    await db
      .insert(schema.issues)
      .values({ userId: user.login, integrationId: resolved.integrationId, provider: PROVIDER, identifier: detail.identifier, data: JSON.stringify(detail), fetchedAt: now })
      .onConflictDoUpdate({ target: [schema.issues.userId, schema.issues.integrationId, schema.issues.identifier], set: { data: JSON.stringify(detail), fetchedAt: now } })
    return c.json(detail)
  })
  // Add a comment (or threaded reply via parentId) to a ticket. Client refetches detail after.
  .post('/issues/:identifier/comments', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'unauthenticated' }, 401)
    const rows = await linearRows(c, user.login)
    if (!rows.length) return c.json({ error: 'linear_not_connected' }, 403)

    const identifier = c.req.param('identifier')
    const { body, parentId } = (await c.req.json().catch(() => ({}))) as { body?: string; parentId?: string }
    if (!body || !body.trim()) return c.json({ error: 'bad_request' }, 400)

    // commentCreate keys off the internal issue UUID; resolve it (and the owning connection's key).
    const filter = issuesFilter([identifier])
    if (!filter) return c.json({ error: 'not_found' }, 404)
    const resolved = await resolveIssues(c, rows, ISSUE_ID_QUERY, { filter })
    const issueId = resolved?.nodes[0]?.id
    if (!resolved || !issueId) return c.json({ error: 'not_found' }, 404)

    const input: Record<string, unknown> = { issueId, body: body.trim() }
    if (parentId) input.parentId = parentId
    const res = await linearFetch(resolved.key, COMMENT_CREATE, { input })
    const err = linearError(res)
    if (err) return c.json({ error: err.error }, err.status)
    try {
      const data = await linearData<{ commentCreate: { success: boolean } }>(res)
      if (!data.commentCreate.success) return c.json({ error: 'comment_failed' }, 502)
    } catch {
      return c.json({ error: 'comment_failed' }, 502)
    }
    return c.json({ ok: true })
  })
