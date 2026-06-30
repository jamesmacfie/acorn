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
import { decryptSecret, encryptSecret } from '../session'
import type { LinearActivity, IntegrationsStatus, LinearIssueDetail, LinearIssuesRequest, LinearIssuesResponse, LinearProjectIssue, LinearProjectIssuesResponse, LinearProjectsResponse } from '../../shared/api'

const PROVIDER = 'linear'
const ISSUES_STALE_AFTER_MS = 600_000 // 10 min — tickets change slower than PRs; panel forces fresh

// Decrypt the caller's stored Linear key, or null if they haven't connected.
async function linearKey(c: { env: Env }, userId: string): Promise<string | null> {
  const rows = await getDb(c.env)
    .select()
    .from(schema.integrations)
    .where(and(eq(schema.integrations.userId, userId), eq(schema.integrations.provider, PROVIDER)))
  return rows[0] ? decryptSecret(rows[0].accessToken, c.env.SESSION_ENC_KEY) : null
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

// /api/integrations — connect/disconnect/status for third-party providers (Linear first).
export const integrations = new Hono<AppEnv>()
  .get('/', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'unauthenticated' }, 401)
    const rows = await getDb(c.env)
      .select()
      .from(schema.integrations)
      .where(and(eq(schema.integrations.userId, user.login), eq(schema.integrations.provider, PROVIDER)))
    const workspace = rows[0]?.meta ? (JSON.parse(rows[0].meta) as { workspace?: string }).workspace : undefined
    return c.json({ linear: { connected: !!rows[0], workspace } } satisfies IntegrationsStatus)
  })
  .post('/linear', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'unauthenticated' }, 401)
    const { apiKey } = (await c.req.json().catch(() => ({}))) as { apiKey?: string }
    if (!apiKey || typeof apiKey !== 'string') return c.json({ error: 'bad_request' }, 400)

    // Validate the key by reading the viewer; reject anything that doesn't authenticate.
    const res = await linearFetch(apiKey.trim(), VIEWER_QUERY, {})
    if (linearError(res)) return c.json({ error: 'invalid_key' }, 400)
    let workspace: string
    try {
      workspace = (await linearData<Viewer>(res)).viewer.organization.name
    } catch {
      return c.json({ error: 'invalid_key' }, 400)
    }

    await getDb(c.env)
      .insert(schema.integrations)
      .values({ userId: user.login, provider: PROVIDER, accessToken: await encryptSecret(apiKey.trim(), c.env.SESSION_ENC_KEY), meta: JSON.stringify({ workspace }), createdAt: Date.now() })
      .onConflictDoUpdate({
        target: [schema.integrations.userId, schema.integrations.provider],
        set: { accessToken: await encryptSecret(apiKey.trim(), c.env.SESSION_ENC_KEY), meta: JSON.stringify({ workspace }) },
      })
    return c.json({ linear: { connected: true, workspace } } satisfies IntegrationsStatus)
  })
  .delete('/linear', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'unauthenticated' }, 401)
    await getDb(c.env)
      .delete(schema.integrations)
      .where(and(eq(schema.integrations.userId, user.login), eq(schema.integrations.provider, PROVIDER)))
    return c.body(null, 204)
  })

// /api/linear — read Linear issues referenced from a PR. Per-user, cached in D1 (never shared KV).
export const linear = new Hono<AppEnv>()
  // Workspace projects for the per-repo picker (docs/workspaces — Linear source). Live read.
  .get('/projects', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'unauthenticated' }, 401)
    const key = await linearKey(c, user.login)
    if (!key) return c.json({ error: 'linear_not_connected' }, 403)
    const res = await linearFetch(key, PROJECTS_QUERY, {})
    const err = linearError(res)
    if (err) return c.json({ error: err.error }, err.status)
    const { projects } = await linearData<{ projects: { nodes: LinearProjectNode[] } }>(res)
    return c.json({ projects: projects.nodes.map((p) => ({ id: p.id, name: p.name })) } satisfies LinearProjectsResponse)
  })
  // Active issues for the given project ids (the Linear source browse). Live read, client caches.
  .get('/project-issues', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'unauthenticated' }, 401)
    const key = await linearKey(c, user.login)
    if (!key) return c.json({ error: 'linear_not_connected' }, 403)
    const ids = [...new Set((c.req.query('ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean))]
    if (!ids.length) return c.json({ issues: [] } satisfies LinearProjectIssuesResponse)
    const res = await linearFetch(key, PROJECT_ISSUES_QUERY, { filter: projectIssuesFilter(ids) })
    const err = linearError(res)
    if (err) return c.json({ error: err.error }, err.status)
    const { issues } = await linearData<{ issues: { nodes: LinearNode[] } }>(res)
    const out: LinearProjectIssue[] = issues.nodes.map((n) => ({ ...toSummary(nodeToDetail(n)), branchName: n.branchName ?? null }))
    return c.json({ issues: out } satisfies LinearProjectIssuesResponse)
  })
  // Batch enrichment for the Integrations list: summaries, serve-then-revalidate (10-min TTL).
  .post('/issues', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'unauthenticated' }, 401)
    const key = await linearKey(c, user.login)
    if (!key) return c.json({ error: 'linear_not_connected' }, 403)

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

    const stale = identifiers.filter((id) => !fresh.has(id))
    const filter = issuesFilter(stale)
    if (filter) {
      try {
        const res = await linearFetch(key, ISSUES_QUERY, { filter })
        const err = linearError(res)
        if (err) return c.json({ error: err.error }, err.status)
        const { issues } = await linearData<{ issues: { nodes: LinearNode[] } }>(res)
        for (const node of issues.nodes) {
          const prev = byId.get(node.identifier)
          // Preserve any already-fetched description/comments/activity from a prior detail fetch.
          const detail: LinearIssueDetail = { ...nodeToDetail(node), description: prev?.description ?? null, comments: prev?.comments ?? [], activity: prev?.activity ?? [] }
          byId.set(node.identifier, detail)
          await db
            .insert(schema.issues)
            .values({ userId: user.login, provider: PROVIDER, identifier: node.identifier, data: JSON.stringify(detail), fetchedAt: now })
            .onConflictDoUpdate({
              target: [schema.issues.userId, schema.issues.provider, schema.issues.identifier],
              set: { data: JSON.stringify(detail), fetchedAt: now },
            })
        }
      } catch {
        // Network/GraphQL failure: fall back to whatever we had cached.
      }
    }

    const out = identifiers.map((id) => byId.get(id)).filter((d): d is LinearIssueDetail => !!d)
    return c.json({ issues: out.map(toSummary) } satisfies LinearIssuesResponse)
  })
  // Full detail for the side panel. refresh=1 (panel open) always refetches to stay current.
  .get('/issues/:identifier', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'unauthenticated' }, 401)
    const key = await linearKey(c, user.login)
    if (!key) return c.json({ error: 'linear_not_connected' }, 403)

    const identifier = c.req.param('identifier')
    const refresh = c.req.query('refresh') === '1'
    const db = getDb(c.env)
    const now = Date.now()

    if (!refresh) {
      const rows = await db
        .select()
        .from(schema.issues)
        .where(and(eq(schema.issues.userId, user.login), eq(schema.issues.provider, PROVIDER), eq(schema.issues.identifier, identifier)))
      const row = rows[0]
      if (row && row.fetchedAt + ISSUES_STALE_AFTER_MS > now) return c.json(JSON.parse(row.data) as LinearIssueDetail)
    }

    const filter = issuesFilter([identifier])
    if (!filter) return c.json({ error: 'not_found' }, 404)
    const res = await linearFetch(key, ISSUE_DETAIL_QUERY, { filter })
    const err = linearError(res)
    if (err) return c.json({ error: err.error }, err.status)
    let node: LinearNode | undefined
    try {
      node = (await linearData<{ issues: { nodes: LinearNode[] } }>(res)).issues.nodes[0]
    } catch {
      return c.json({ error: 'linear_unavailable' }, 502)
    }
    if (!node) return c.json({ error: 'not_found' }, 404)
    const detail = nodeToDetail(node)
    await db
      .insert(schema.issues)
      .values({ userId: user.login, provider: PROVIDER, identifier: detail.identifier, data: JSON.stringify(detail), fetchedAt: now })
      .onConflictDoUpdate({
        target: [schema.issues.userId, schema.issues.provider, schema.issues.identifier],
        set: { data: JSON.stringify(detail), fetchedAt: now },
      })
    return c.json(detail)
  })
  // Add a comment (or threaded reply via parentId) to a ticket. Client refetches detail after.
  .post('/issues/:identifier/comments', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'unauthenticated' }, 401)
    const key = await linearKey(c, user.login)
    if (!key) return c.json({ error: 'linear_not_connected' }, 403)

    const identifier = c.req.param('identifier')
    const { body, parentId } = (await c.req.json().catch(() => ({}))) as { body?: string; parentId?: string }
    if (!body || !body.trim()) return c.json({ error: 'bad_request' }, 400)

    // commentCreate keys off the internal issue UUID — reuse the cached detail's id, else resolve it.
    const db = getDb(c.env)
    const rows = await db
      .select()
      .from(schema.issues)
      .where(and(eq(schema.issues.userId, user.login), eq(schema.issues.provider, PROVIDER), eq(schema.issues.identifier, identifier)))
    let issueId = rows[0] ? (JSON.parse(rows[0].data) as LinearIssueDetail).id || undefined : undefined
    if (!issueId) {
      const filter = issuesFilter([identifier])
      if (!filter) return c.json({ error: 'not_found' }, 404)
      const idRes = await linearFetch(key, ISSUE_ID_QUERY, { filter })
      const idErr = linearError(idRes)
      if (idErr) return c.json({ error: idErr.error }, idErr.status)
      try {
        issueId = (await linearData<{ issues: { nodes: { id: string }[] } }>(idRes)).issues.nodes[0]?.id
      } catch {
        return c.json({ error: 'linear_unavailable' }, 502)
      }
    }
    if (!issueId) return c.json({ error: 'not_found' }, 404)

    const input: Record<string, unknown> = { issueId, body: body.trim() }
    if (parentId) input.parentId = parentId
    const res = await linearFetch(key, COMMENT_CREATE, { input })
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
