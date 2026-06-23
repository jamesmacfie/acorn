import { and, eq } from 'drizzle-orm'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'
import { Hono } from 'hono'
import { getDb, schema } from '../db'
import { ghGraphQL } from '../github'
import type { AppEnv } from '../middleware/auth'

// PR detail — the composite GraphQL read (docs/github-api.md "primary read for the PR screen").
// PR + files + reviews + comments + checks in one round-trip. GraphQL has no ETag, so freshness
// is a TTL gate in sync_state (`pr:<repoId>:<number>`); the mirror tables are the cache. Rows are
// user-scoped. 3a renders header + files; reviews/comments/checks are mirrored for later panes.
const STALE_AFTER_MS = 45_000 // PR data is "fast-changing" (docs/caching.md)

const COMPOSITE_QUERY = `
query PR($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      id number title state isDraft bodyHTML headRefOid
      author { login }
      baseRefName headRefName updatedAt
      labels(first: 20) { nodes { name color } }
      reviews(first: 50) { nodes { id author { login } state bodyHTML submittedAt } }
      comments(first: 50) { nodes { id author { login } bodyHTML createdAt } }
      reviewThreads(first: 50) { nodes {
        id isResolved path line originalLine diffSide
        comments(first: 50) { nodes { id databaseId author { login } bodyHTML createdAt } }
      } }
      commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 50) { nodes {
        __typename
        ... on CheckRun { name status conclusion detailsUrl checkSuite { workflowRun { databaseId } } }
        ... on StatusContext { context state targetUrl }
      } } } } } }
    }
  }
}`
// Files live in pr_files, owned by the REST /files endpoint (it carries patch+sha); not here.
// ponytail: first-page only (reviews,comments 50) — cursor pagination deferred.

type GqlPull = {
  id: string
  number: number
  title: string
  state: string
  isDraft: boolean
  bodyHTML: string | null
  headRefOid: string | null
  author: { login: string } | null
  baseRefName: string | null
  headRefName: string | null
  updatedAt: string | null
  labels: { nodes: { name: string; color: string | null }[] }
  reviews: { nodes: { id: string; author: { login: string } | null; state: string; bodyHTML: string | null; submittedAt: string | null }[] }
  comments: { nodes: { id: string; author: { login: string } | null; bodyHTML: string | null; createdAt: string | null }[] }
  reviewThreads: { nodes: GqlThread[] }
  commits: { nodes: { commit: { statusCheckRollup: { contexts: { nodes: GqlContext[] } } | null } }[] }
}
type GqlThreadComment = {
  id: string
  databaseId: number | null
  author: { login: string } | null
  bodyHTML: string | null
  createdAt: string | null
}
type GqlThread = {
  id: string
  isResolved: boolean
  path: string | null
  line: number | null
  originalLine: number | null
  diffSide: string | null
  comments: { nodes: GqlThreadComment[] }
}
type GqlContext =
  | {
      __typename: 'CheckRun'
      name: string
      status: string | null
      conclusion: string | null
      detailsUrl: string | null
      checkSuite: { workflowRun: { databaseId: number | null } | null } | null
    }
  | { __typename: 'StatusContext'; context: string; state: string | null; targetUrl: string | null }

const ms = (s: string | null) => (s ? Date.parse(s) : null)

export const pullDetail = new Hono<AppEnv>().get('/:owner/:repo/pulls/:number', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthenticated' }, 401)

  const db = getDb(c.env)
  const userId = user.login
  const owner = c.req.param('owner')
  const repo = c.req.param('repo')
  const number = Number(c.req.param('number'))
  if (!Number.isInteger(number)) return c.json({ error: 'bad_number' }, 400)

  const [repoRow] = await db
    .select({ id: schema.repos.id })
    .from(schema.repos)
    .where(and(eq(schema.repos.userId, userId), eq(schema.repos.owner, owner), eq(schema.repos.name, repo)))
  if (!repoRow) return c.json({ error: 'repo_not_found' }, 404)
  const repoId = repoRow.id

  const resource = `pr:${repoId}:${number}`
  const [sync] = await db
    .select()
    .from(schema.syncState)
    .where(and(eq(schema.syncState.userId, userId), eq(schema.syncState.resource, resource)))

  const prWhere = and(
    eq(schema.pullRequests.userId, userId),
    eq(schema.pullRequests.repoId, repoId),
    eq(schema.pullRequests.number, number),
  )
  const childWhere = (t: { userId: SQLiteColumn; repoId: SQLiteColumn; number: SQLiteColumn }) =>
    and(eq(t.userId, userId), eq(t.repoId, repoId), eq(t.number, number))

  const readComposite = async () => {
    const [pull] = await db.select().from(schema.pullRequests).where(prWhere)
    const [labels, reviews, comments, checks, threadRows] = await Promise.all([
      db.select().from(schema.prLabels).where(childWhere(schema.prLabels)),
      db.select().from(schema.reviews).where(childWhere(schema.reviews)),
      db.select().from(schema.comments).where(childWhere(schema.comments)),
      db.select().from(schema.checks).where(childWhere(schema.checks)),
      db.select().from(schema.reviewThreads).where(childWhere(schema.reviewThreads)),
    ])
    // Group thread-comment rows back into threads keyed by threadId.
    const tmap = new Map<string, ReturnType<typeof toThread>>()
    for (const row of threadRows) {
      let t = tmap.get(row.threadId)
      if (!t) tmap.set(row.threadId, (t = toThread(row)))
      t.comments.push({ id: row.id, databaseId: row.databaseId, author: row.author, body: row.body, createdAt: row.createdAt })
    }
    return {
      pull: pull ? toPublicPull(pull) : null,
      labels: labels.map((l) => ({ name: l.name, color: l.color })),
      reviews: reviews.map((r) => ({ id: r.id, author: r.author, state: r.state, body: r.body, submittedAt: r.submittedAt })),
      comments: comments.map((m) => ({ id: m.id, author: m.author, body: m.body, createdAt: m.createdAt })),
      checks: checks.map((k) => ({ name: k.name, status: k.status, url: k.url, runId: k.runId })),
      threads: [...tmap.values()],
    }
  }

  // Fresh → serve the mirror, no GraphQL call.
  if (sync && sync.fetchedAt + STALE_AFTER_MS > Date.now()) return c.json(await readComposite())

  const res = await ghGraphQL(user.token, COMPOSITE_QUERY, { owner, repo, number })
  if (res.status === 401) return c.json({ error: 'reauth' }, 401)
  if (!res.ok) return c.json({ error: 'github_unavailable' }, 502)
  const json = (await res.json()) as {
    data?: { repository?: { pullRequest?: GqlPull | null } }
    errors?: { message: string; type?: string }[]
  }
  // A GraphQL error (200 + errors, data null) must not masquerade as a 404 — surface it.
  if (json.errors?.length) {
    console.error('pullDetail GraphQL errors', JSON.stringify(json.errors))
    return c.json({ error: 'graphql', detail: json.errors.map((e) => e.message) }, 502)
  }
  const pr = json.data?.repository?.pullRequest
  if (!pr) return c.json({ error: 'pull_not_found' }, 404)

  const now = Date.now()
  const key = { userId, repoId, number }

  const pullRow = {
    userId,
    repoId,
    number,
    nodeId: pr.id,
    state: pr.state.toLowerCase(),
    draft: pr.isDraft,
    title: pr.title,
    body: pr.bodyHTML,
    headSha: pr.headRefOid,
    headRef: pr.headRefName,
    baseRef: pr.baseRefName,
    author: pr.author?.login ?? null,
    updatedAt: ms(pr.updatedAt),
    fetchedAt: now,
    staleAfter: STALE_AFTER_MS,
    etag: null,
  }
  const labelRows = pr.labels.nodes.map((l) => ({ ...key, name: l.name, color: l.color }))
  const reviewRows = pr.reviews.nodes.map((r) => ({
    ...key,
    id: r.id,
    author: r.author?.login ?? null,
    state: r.state,
    body: r.bodyHTML,
    submittedAt: ms(r.submittedAt),
  }))
  const commentRows = pr.comments.nodes.map((m) => ({
    ...key,
    id: m.id,
    author: m.author?.login ?? null,
    body: m.bodyHTML,
    createdAt: ms(m.createdAt),
  }))
  const threadRows = pr.reviewThreads.nodes.flatMap((t) =>
    t.comments.nodes.map((cm) => ({
      ...key,
      threadId: t.id,
      id: cm.id,
      databaseId: cm.databaseId,
      path: t.path,
      line: t.line ?? t.originalLine,
      side: t.diffSide,
      resolved: t.isResolved,
      author: cm.author?.login ?? null,
      body: cm.bodyHTML,
      createdAt: ms(cm.createdAt),
    })),
  )
  const checkRows = dedupeByName(
    (pr.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? []).map((ctx) =>
      ctx.__typename === 'CheckRun'
        ? { ...key, name: ctx.name, status: ctx.conclusion ?? ctx.status, url: ctx.detailsUrl, runId: ctx.checkSuite?.workflowRun?.databaseId ?? null }
        : { ...key, name: ctx.context, status: ctx.state, url: ctx.targetUrl, runId: null },
    ),
  )

  // chunk(rows): D1 caps bound params at 100/statement, so cap rows/statement by column count.
  const chunk = <T,>(table: Parameters<typeof db.insert>[0], rows: T[]) => {
    if (rows.length === 0) return []
    const size = Math.max(1, Math.floor(100 / Object.keys(rows[0] as object).length))
    return Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => db.insert(table).values(rows.slice(i * size, i * size + size) as never))
  }

  await db.batch([
    db
      .insert(schema.pullRequests)
      .values(pullRow)
      .onConflictDoUpdate({
        target: [schema.pullRequests.userId, schema.pullRequests.repoId, schema.pullRequests.number],
        set: pullRow,
      }),
    db.delete(schema.prLabels).where(childWhere(schema.prLabels)),
    db.delete(schema.reviews).where(childWhere(schema.reviews)),
    db.delete(schema.comments).where(childWhere(schema.comments)),
    db.delete(schema.checks).where(childWhere(schema.checks)),
    db.delete(schema.reviewThreads).where(childWhere(schema.reviewThreads)),
    ...chunk(schema.prLabels, labelRows),
    ...chunk(schema.reviews, reviewRows),
    ...chunk(schema.comments, commentRows),
    ...chunk(schema.checks, checkRows),
    ...chunk(schema.reviewThreads, threadRows),
    db
      .insert(schema.syncState)
      .values({ userId, resource, etag: null, fetchedAt: now })
      .onConflictDoUpdate({ target: [schema.syncState.userId, schema.syncState.resource], set: { fetchedAt: now } }),
  ])

  return c.json(await readComposite())
})

// A commit can carry duplicate context names across check runs; keep the last (PK is name).
const dedupeByName = <T extends { name: string }>(rows: T[]) => [...new Map(rows.map((r) => [r.name, r])).values()]

type ThreadComment = { id: string; databaseId: number | null; author: string | null; body: string | null; createdAt: number | null }
const toThread = (row: typeof schema.reviewThreads.$inferSelect) => ({
  threadId: row.threadId,
  path: row.path,
  line: row.line,
  side: row.side,
  resolved: row.resolved,
  comments: [] as ThreadComment[],
})

const toPublicPull = (p: typeof schema.pullRequests.$inferSelect) => ({
  number: p.number,
  title: p.title,
  body: p.body,
  state: p.state,
  draft: p.draft,
  author: p.author,
  headSha: p.headSha,
  headRef: p.headRef,
  baseRef: p.baseRef,
  updatedAt: p.updatedAt,
})
