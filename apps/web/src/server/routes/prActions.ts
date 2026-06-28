import { and, eq } from 'drizzle-orm'
import { Hono, type Context } from 'hono'
import { schema } from '../db'
import { gh, ghError, ghGraphQL } from '../github'
import type { AppEnv } from '../middleware/auth'
import { bustPrSync, resolvePr, setPrState } from './prContext'

// PR write actions (docs/github-api.md). Each calls GitHub, updates the D1 mirror so a read
// within the TTL window reflects the change, and returns the canonical bit. The client layers
// optimistic updates / invalidation on top.

export const prActions = new Hono<AppEnv>()
  // Merge: PUT /pulls/{n}/merge. 405 = not mergeable, 409 = head moved.
  .post('/:owner/:repo/pulls/:number/merge', async (c) => {
    const r = await resolvePr(c)
    if ('error' in r) return c.json({ error: r.error }, r.status)
    const { method } = (await c.req.json().catch(() => ({}))) as { method?: string }
    const res = await gh(r.user.token, `/repos/${r.owner}/${r.repo}/pulls/${r.number}/merge`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ merge_method: method ?? 'merge' }),
    })
    if (res.status === 405 || res.status === 409) return c.json({ error: 'merge_failed', status: res.status }, 409)
    const err = ghError(res)
    if (err) return c.json({ error: err.error }, err.status)
    await setPrState(r.db, r.user.login, r.repoId, r.number, 'merged')
    return c.json({ state: 'merged' })
  })
  // Enable auto-merge: PUT /pulls/{n}/auto-merge { merge_method }.
  .post('/:owner/:repo/pulls/:number/auto-merge', async (c) => {
    const r = await resolvePr(c)
    if ('error' in r) return c.json({ error: r.error }, r.status)
    const { method } = (await c.req.json().catch(() => ({}))) as { method?: string }
    const res = await gh(r.user.token, `/repos/${r.owner}/${r.repo}/pulls/${r.number}/auto-merge`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ merge_method: method ?? 'merge' }),
    })
    if (res.status === 422) return c.json({ error: 'auto_merge_not_allowed' }, 422)
    const err = ghError(res)
    if (err) return c.json({ error: err.error }, err.status)
    await r.db
      .update(schema.pullRequests)
      .set({ autoMergeEnabled: true })
      .where(and(eq(schema.pullRequests.userId, r.user.login), eq(schema.pullRequests.repoId, r.repoId), eq(schema.pullRequests.number, r.number)))
    return c.json({ autoMergeEnabled: true })
  })
  // Disable auto-merge: DELETE /pulls/{n}/auto-merge.
  .delete('/:owner/:repo/pulls/:number/auto-merge', async (c) => {
    const r = await resolvePr(c)
    if ('error' in r) return c.json({ error: r.error }, r.status)
    const res = await gh(r.user.token, `/repos/${r.owner}/${r.repo}/pulls/${r.number}/auto-merge`, { method: 'DELETE' })
    const err = ghError(res)
    if (err) return c.json({ error: err.error }, err.status)
    await r.db
      .update(schema.pullRequests)
      .set({ autoMergeEnabled: false })
      .where(and(eq(schema.pullRequests.userId, r.user.login), eq(schema.pullRequests.repoId, r.repoId), eq(schema.pullRequests.number, r.number)))
    return c.json({ autoMergeEnabled: false })
  })
  // Close / reopen: PATCH /pulls/{n} { state }.
  .post('/:owner/:repo/pulls/:number/:action{close|reopen}', async (c) => {
    const r = await resolvePr(c)
    if ('error' in r) return c.json({ error: r.error }, r.status)
    const state = c.req.param('action') === 'close' ? 'closed' : 'open'
    const res = await gh(r.user.token, `/repos/${r.owner}/${r.repo}/pulls/${r.number}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    })
    const err = ghError(res)
    if (err) return c.json({ error: err.error }, err.status)
    await setPrState(r.db, r.user.login, r.repoId, r.number, state)
    return c.json({ state })
  })
  // Draft ↔ ready: GraphQL only, needs the PR node id.
  .post('/:owner/:repo/pulls/:number/draft', async (c) => {
    const r = await resolvePr(c)
    if ('error' in r) return c.json({ error: r.error }, r.status)
    if (!r.nodeId) return c.json({ error: 'node_id_unknown' }, 409) // open the PR first to mirror its node id
    const { draft } = (await c.req.json().catch(() => ({}))) as { draft?: boolean }
    const mutation = draft
      ? `mutation($id:ID!){ convertPullRequestToDraft(input:{pullRequestId:$id}){ clientMutationId } }`
      : `mutation($id:ID!){ markPullRequestReadyForReview(input:{pullRequestId:$id}){ clientMutationId } }`
    const res = await ghGraphQL(r.user.token, mutation, { id: r.nodeId })
    const err = ghError(res)
    if (err) return c.json({ error: err.error }, err.status)
    const body = (await res.json().catch(() => ({}))) as { errors?: unknown }
    if (body.errors) return c.json({ error: 'github_unavailable' }, 502)
    await r.db
      .update(schema.pullRequests)
      .set({ draft: !!draft })
      .where(
        and(
          eq(schema.pullRequests.userId, r.user.login),
          eq(schema.pullRequests.repoId, r.repoId),
          eq(schema.pullRequests.number, r.number),
        ),
      )
    return c.json({ draft: !!draft })
  })
  // Add a discussion comment: POST /issues/{n}/comments. full+json returns body_html.
  .post('/:owner/:repo/pulls/:number/comments', async (c) => {
    const r = await resolvePr(c)
    if ('error' in r) return c.json({ error: r.error }, r.status)
    const { body } = (await c.req.json().catch(() => ({}))) as { body?: string }
    if (!body?.trim()) return c.json({ error: 'empty_body' }, 400)
    const res = await gh(r.user.token, `/repos/${r.owner}/${r.repo}/issues/${r.number}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/vnd.github.full+json' },
      body: JSON.stringify({ body }),
    })
    const err = ghError(res)
    if (err) return c.json({ error: err.error }, err.status)
    const ct = (await res.json()) as { node_id: string; user: { login: string } | null; body_html?: string; created_at: string }
    const row = {
      userId: r.user.login,
      repoId: r.repoId,
      number: r.number,
      id: ct.node_id,
      author: ct.user?.login ?? null,
      body: ct.body_html ?? body,
      createdAt: Date.parse(ct.created_at),
    }
    await r.db.insert(schema.comments).values(row).onConflictDoNothing()
    return c.json({ id: row.id, author: row.author, body: row.body, createdAt: row.createdAt })
  })
  // Add a label: POST /issues/{n}/labels. Remove a label: DELETE /issues/{n}/labels/{name}.
  // Both return the PR's full label set → replace the pr_labels mirror so a within-TTL read is fresh.
  .post('/:owner/:repo/pulls/:number/labels', (c) => mutateLabels(c, 'add'))
  .delete('/:owner/:repo/pulls/:number/labels', (c) => mutateLabels(c, 'remove'))
  // Toggle a file's "viewed" checkbox (app-state, no GitHub call).
  .post('/:owner/:repo/pulls/:number/viewed', async (c) => {
    const r = await resolvePr(c)
    if ('error' in r) return c.json({ error: r.error }, r.status)
    const { path, viewed } = (await c.req.json().catch(() => ({}))) as { path?: string; viewed?: boolean }
    if (!path) return c.json({ error: 'bad_request' }, 400)
    const key = { userId: r.user.login, repoId: r.repoId, number: r.number, path }
    const where = and(
      eq(schema.viewedFiles.userId, r.user.login),
      eq(schema.viewedFiles.repoId, r.repoId),
      eq(schema.viewedFiles.number, r.number),
      eq(schema.viewedFiles.path, path),
    )
    if (viewed) await r.db.insert(schema.viewedFiles).values({ ...key, viewedAt: Date.now() }).onConflictDoNothing()
    else await r.db.delete(schema.viewedFiles).where(where)
    return c.json({ path, viewed: !!viewed })
  })
  // Start a new inline review comment on a line: POST /pulls/{n}/comments { commit_id, path, line, side }.
  .post('/:owner/:repo/pulls/:number/review-comments', async (c) => {
    const r = await resolvePr(c)
    if ('error' in r) return c.json({ error: r.error }, r.status)
    if (!r.headSha) return c.json({ error: 'head_sha_unknown' }, 409) // open the PR first to mirror head sha
    const { body, path, line, side } = (await c.req.json().catch(() => ({}))) as {
      body?: string
      path?: string
      line?: number
      side?: string
    }
    if (!body?.trim() || !path || !line) return c.json({ error: 'bad_request' }, 400)
    const res = await gh(r.user.token, `/repos/${r.owner}/${r.repo}/pulls/${r.number}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, commit_id: r.headSha, path, line, side: side ?? 'RIGHT' }),
    })
    const err = ghError(res)
    if (err) return c.json({ error: err.error }, err.status)
    await bustPrSync(r.db, r.user.login, r.repoId, r.number)
    return c.json({ ok: true })
  })
  // Reply to an existing thread: POST /pulls/{n}/comments/{comment_id}/replies. id = numeric databaseId.
  .post('/:owner/:repo/pulls/:number/review-comments/:commentId/replies', async (c) => {
    const r = await resolvePr(c)
    if ('error' in r) return c.json({ error: r.error }, r.status)
    const commentId = c.req.param('commentId')
    const { body } = (await c.req.json().catch(() => ({}))) as { body?: string }
    if (!body?.trim()) return c.json({ error: 'empty_body' }, 400)
    const res = await gh(r.user.token, `/repos/${r.owner}/${r.repo}/pulls/${r.number}/comments/${commentId}/replies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    })
    const err = ghError(res)
    if (err) return c.json({ error: err.error }, err.status)
    await bustPrSync(r.db, r.user.login, r.repoId, r.number)
    return c.json({ ok: true })
  })
  // Resolve / unresolve a thread (GraphQL, by thread node id).
  .post('/:owner/:repo/pulls/:number/threads/:threadId/resolve', async (c) => {
    const r = await resolvePr(c)
    if ('error' in r) return c.json({ error: r.error }, r.status)
    const threadId = c.req.param('threadId')
    const { resolved } = (await c.req.json().catch(() => ({}))) as { resolved?: boolean }
    const field = resolved ? 'resolveReviewThread' : 'unresolveReviewThread'
    const res = await ghGraphQL(r.user.token, `mutation($id:ID!){ ${field}(input:{threadId:$id}){ thread { id } } }`, {
      id: threadId,
    })
    const err = ghError(res)
    if (err) return c.json({ error: err.error }, err.status)
    const out = (await res.json().catch(() => ({}))) as { errors?: unknown }
    if (out.errors) return c.json({ error: 'github_unavailable' }, 502)
    await bustPrSync(r.db, r.user.login, r.repoId, r.number)
    return c.json({ resolved: !!resolved })
  })
  // Submit a PR review: POST /pulls/{n}/reviews { event, body }.
  .post('/:owner/:repo/pulls/:number/reviews', async (c) => {
    const r = await resolvePr(c)
    if ('error' in r) return c.json({ error: r.error }, r.status)
    const { body, event } = (await c.req.json().catch(() => ({}))) as { body?: string; event?: string }
    if (!event || !['APPROVE', 'REQUEST_CHANGES', 'COMMENT'].includes(event))
      return c.json({ error: 'bad_request' }, 400)
    if ((event === 'REQUEST_CHANGES' || event === 'COMMENT') && !body?.trim())
      return c.json({ error: 'body_required' }, 400)
    const res = await gh(r.user.token, `/repos/${r.owner}/${r.repo}/pulls/${r.number}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: body?.trim() ?? '', event }),
    })
    const err = ghError(res)
    if (err) return c.json({ error: err.error }, err.status)
    await bustPrSync(r.db, r.user.login, r.repoId, r.number)
    return c.json({ ok: true })
  })
  // Rerun a workflow run's failed jobs: POST /actions/runs/{runId}/rerun-failed-jobs (GitHub → 201).
  // Repo-scoped (no PR number): a check's runId is the Actions run, not the PR. No mirror to update —
  // the new run states surface on the next composite refetch.
  .post('/:owner/:repo/actions/:runId/rerun', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'unauthenticated' }, 401)
    const owner = c.req.param('owner')
    const repo = c.req.param('repo')
    const runId = c.req.param('runId')
    const res = await gh(user.token, `/repos/${owner}/${repo}/actions/runs/${runId}/rerun-failed-jobs`, { method: 'POST' })
    const err = ghError(res)
    if (err) return c.json({ error: err.error }, err.status)
    return c.json({ ok: true })
  })

async function mutateLabels(c: Context<AppEnv>, op: 'add' | 'remove') {
  const r = await resolvePr(c)
  if ('error' in r) return c.json({ error: r.error }, r.status)
  const { name } = (await c.req.json().catch(() => ({}))) as { name?: string }
  if (!name?.trim()) return c.json({ error: 'empty_name' }, 400)
  const res =
    op === 'add'
      ? await gh(r.user.token, `/repos/${r.owner}/${r.repo}/issues/${r.number}/labels`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ labels: [name] }),
        })
      : await gh(r.user.token, `/repos/${r.owner}/${r.repo}/issues/${r.number}/labels/${encodeURIComponent(name)}`, {
          method: 'DELETE',
        })
  const err = ghError(res)
  if (err) return c.json({ error: err.error }, err.status)
  const labels = (await res.json()) as { name: string; color: string | null }[]
  const rows = labels.map((l) => ({ userId: r.user.login, repoId: r.repoId, number: r.number, name: l.name, color: l.color }))
  const where = and(
    eq(schema.prLabels.userId, r.user.login),
    eq(schema.prLabels.repoId, r.repoId),
    eq(schema.prLabels.number, r.number),
  )
  await r.db.batch([r.db.delete(schema.prLabels).where(where), ...rows.map((row) => r.db.insert(schema.prLabels).values(row))])
  return c.json(rows.map((row) => ({ name: row.name, color: row.color })))
}
