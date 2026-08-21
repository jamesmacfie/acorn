import { and, eq } from 'drizzle-orm'
import { Hono, type Context } from 'hono'
import { gh, ghError, ghGraphQL, ghGraphQLResult } from '..'
import { type AppEnv, ownerId, type PluginDatabase, respondError } from '@acorn/plugin-api/node'
import { bustPrSync, resolvePr, setPrState } from './prContext'
import { githubToken } from '../githubToken'
import { comments, prLabels, pullRequests, reviewRequests, viewedFiles } from '../../node/schema'

// PR write actions (docs/github-integration.md). Each calls GitHub, updates the local mirror so
// a read within the TTL window reflects the change, and returns the canonical bit. The client
// layers optimistic updates / invalidation on top.

// Factory over this plugin's own database, not a module-scope router (docs/data-layer.md § Plugin
// databases).
export const prActions = (db: PluginDatabase) => new Hono<AppEnv>()
  // Merge: PUT /pulls/{n}/merge. 405 = not mergeable, 409 = head moved.
  .post('/:owner/:repo/pulls/:number/merge', async (c) => {
    const r = await resolvePr(db, c)
    if ('error' in r) return respondError(c, r.status, r.error)
    const { method } = (await c.req.json().catch(() => ({}))) as { method?: string }
    const res = await gh(r.token, `/repos/${r.owner}/${r.repo}/pulls/${r.number}/merge`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ merge_method: method ?? 'merge' }),
    })
    if (res.status === 405 || res.status === 409) return respondError(c, 409, 'merge_failed')
    const err = ghError(res)
    if (err) return respondError(c, err.status, err.error)
    await setPrState(r.db, r.userId, r.repoId, r.number, 'merged')
    return c.json({ state: 'merged' })
  })
  // Enable auto-merge: GraphQL enablePullRequestAutoMerge (no REST endpoint exists). Needs the PR
  // node id; mergeMethod is the PullRequestMergeMethod enum (MERGE|SQUASH|REBASE).
  .post('/:owner/:repo/pulls/:number/auto-merge', async (c) => {
    const r = await resolvePr(db, c)
    if ('error' in r) return respondError(c, r.status, r.error)
    if (!r.nodeId) return respondError(c, 409, 'node_id_unknown') // open the PR first to mirror its node id
    const { method } = (await c.req.json().catch(() => ({}))) as { method?: string }
    const res = await ghGraphQL(
      r.token,
      `mutation($id:ID!,$m:PullRequestMergeMethod!){ enablePullRequestAutoMerge(input:{pullRequestId:$id, mergeMethod:$m}){ clientMutationId } }`,
      { id: r.nodeId, m: (method ?? 'merge').toUpperCase() },
    )
    const result = await ghGraphQLResult(res)
    if (!result.ok) {
      // GraphQL surfaces "auto-merge not allowed / PR already mergeable" as errors, not a status code.
      if (result.kind === 'graphql') return respondError(c, 422, 'auto_merge_not_allowed')
      return respondError(c, result.failure.status, result.failure.error)
    }
    await r.db
      .update(pullRequests)
      .set({ autoMergeEnabled: true })
      .where(and(eq(pullRequests.userId, r.userId), eq(pullRequests.repoId, r.repoId), eq(pullRequests.number, r.number)))
    return c.json({ autoMergeEnabled: true })
  })
  // Disable auto-merge: GraphQL disablePullRequestAutoMerge (no REST endpoint exists).
  .delete('/:owner/:repo/pulls/:number/auto-merge', async (c) => {
    const r = await resolvePr(db, c)
    if ('error' in r) return respondError(c, r.status, r.error)
    if (!r.nodeId) return respondError(c, 409, 'node_id_unknown')
    const res = await ghGraphQL(r.token, `mutation($id:ID!){ disablePullRequestAutoMerge(input:{pullRequestId:$id}){ clientMutationId } }`, {
      id: r.nodeId,
    })
    const result = await ghGraphQLResult(res)
    if (!result.ok) {
      if (result.kind === 'graphql') return respondError(c, 502, 'github_unavailable')
      return respondError(c, result.failure.status, result.failure.error)
    }
    await r.db
      .update(pullRequests)
      .set({ autoMergeEnabled: false })
      .where(and(eq(pullRequests.userId, r.userId), eq(pullRequests.repoId, r.repoId), eq(pullRequests.number, r.number)))
    return c.json({ autoMergeEnabled: false })
  })
  // Close / reopen: PATCH /pulls/{n} { state }.
  .post('/:owner/:repo/pulls/:number/:action{close|reopen}', async (c) => {
    const r = await resolvePr(db, c)
    if ('error' in r) return respondError(c, r.status, r.error)
    const state = c.req.param('action') === 'close' ? 'closed' : 'open'
    const res = await gh(r.token, `/repos/${r.owner}/${r.repo}/pulls/${r.number}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    })
    const err = ghError(res)
    if (err) return respondError(c, err.status, err.error)
    await setPrState(r.db, r.userId, r.repoId, r.number, state)
    return c.json({ state })
  })
  // Draft ↔ ready: GraphQL only, needs the PR node id.
  .post('/:owner/:repo/pulls/:number/draft', async (c) => {
    const r = await resolvePr(db, c)
    if ('error' in r) return respondError(c, r.status, r.error)
    if (!r.nodeId) return respondError(c, 409, 'node_id_unknown') // open the PR first to mirror its node id
    const { draft } = (await c.req.json().catch(() => ({}))) as { draft?: boolean }
    const mutation = draft
      ? `mutation($id:ID!){ convertPullRequestToDraft(input:{pullRequestId:$id}){ clientMutationId } }`
      : `mutation($id:ID!){ markPullRequestReadyForReview(input:{pullRequestId:$id}){ clientMutationId } }`
    const res = await ghGraphQL(r.token, mutation, { id: r.nodeId })
    const result = await ghGraphQLResult(res)
    if (!result.ok) {
      if (result.kind === 'graphql') return respondError(c, 502, 'github_unavailable')
      return respondError(c, result.failure.status, result.failure.error)
    }
    await r.db
      .update(pullRequests)
      .set({ draft: !!draft })
      .where(
        and(
          eq(pullRequests.userId, r.userId),
          eq(pullRequests.repoId, r.repoId),
          eq(pullRequests.number, r.number),
        ),
      )
    return c.json({ draft: !!draft })
  })
  // Add a discussion comment: POST /issues/{n}/comments. full+json returns body_html.
  .post('/:owner/:repo/pulls/:number/comments', async (c) => {
    const r = await resolvePr(db, c)
    if ('error' in r) return respondError(c, r.status, r.error)
    const { body } = (await c.req.json().catch(() => ({}))) as { body?: string }
    if (!body?.trim()) return respondError(c, 400, 'empty_body')
    const res = await gh(r.token, `/repos/${r.owner}/${r.repo}/issues/${r.number}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/vnd.github.full+json' },
      body: JSON.stringify({ body }),
    })
    const err = ghError(res)
    if (err) return respondError(c, err.status, err.error)
    const ct = (await res.json()) as { node_id: string; user: { login: string } | null; body_html?: string; created_at: string }
    const row = {
      userId: r.userId,
      repoId: r.repoId,
      number: r.number,
      id: ct.node_id,
      author: ct.user?.login ?? null,
      body: ct.body_html ?? body,
      createdAt: Date.parse(ct.created_at),
    }
    await r.db.insert(comments).values(row).onConflictDoNothing()
    return c.json({ id: row.id, author: row.author, body: row.body, createdAt: row.createdAt })
  })
  // Add a label: POST /issues/{n}/labels. Remove a label: DELETE /issues/{n}/labels/{name}.
  // Both return the PR's full label set → replace the pr_labels mirror so a within-TTL read is fresh.
  .post('/:owner/:repo/pulls/:number/labels', (c) => mutateLabels(db, c, 'add'))
  .delete('/:owner/:repo/pulls/:number/labels', (c) => mutateLabels(db, c, 'remove'))
  // Toggle a file's "viewed" checkbox (app-state, no GitHub call).
  .post('/:owner/:repo/pulls/:number/viewed', async (c) => {
    const r = await resolvePr(db, c)
    if ('error' in r) return respondError(c, r.status, r.error)
    const { path, viewed } = (await c.req.json().catch(() => ({}))) as { path?: string; viewed?: boolean }
    if (!path) return respondError(c, 400, 'bad_request')
    const key = { userId: r.userId, repoId: r.repoId, number: r.number, path }
    const where = and(
      eq(viewedFiles.userId, r.userId),
      eq(viewedFiles.repoId, r.repoId),
      eq(viewedFiles.number, r.number),
      eq(viewedFiles.path, path),
    )
    if (viewed) await r.db.insert(viewedFiles).values({ ...key, viewedAt: Date.now() }).onConflictDoNothing()
    else await r.db.delete(viewedFiles).where(where)
    return c.json({ path, viewed: !!viewed })
  })
  // Start a new inline review comment on a line: POST /pulls/{n}/comments { commit_id, path, line, side }.
  .post('/:owner/:repo/pulls/:number/review-comments', async (c) => {
    const r = await resolvePr(db, c)
    if ('error' in r) return respondError(c, r.status, r.error)
    if (!r.headSha) return respondError(c, 409, 'head_sha_unknown') // open the PR first to mirror head sha
    const { body, path, line, side } = (await c.req.json().catch(() => ({}))) as {
      body?: string
      path?: string
      line?: number
      side?: string
    }
    if (!body?.trim() || !path || !line) return respondError(c, 400, 'bad_request')
    const res = await gh(r.token, `/repos/${r.owner}/${r.repo}/pulls/${r.number}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, commit_id: r.headSha, path, line, side: side ?? 'RIGHT' }),
    })
    const err = ghError(res)
    if (err) return respondError(c, err.status, err.error)
    await bustPrSync(r.db, r.userId, r.repoId, r.number)
    return c.json({ ok: true })
  })
  // Reply to an existing thread: POST /pulls/{n}/comments/{comment_id}/replies. id = numeric databaseId.
  .post('/:owner/:repo/pulls/:number/review-comments/:commentId/replies', async (c) => {
    const r = await resolvePr(db, c)
    if ('error' in r) return respondError(c, r.status, r.error)
    const commentId = c.req.param('commentId')
    const { body } = (await c.req.json().catch(() => ({}))) as { body?: string }
    if (!body?.trim()) return respondError(c, 400, 'empty_body')
    const res = await gh(r.token, `/repos/${r.owner}/${r.repo}/pulls/${r.number}/comments/${commentId}/replies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    })
    const err = ghError(res)
    if (err) return respondError(c, err.status, err.error)
    await bustPrSync(r.db, r.userId, r.repoId, r.number)
    return c.json({ ok: true })
  })
  // Resolve / unresolve a thread (GraphQL, by thread node id).
  .post('/:owner/:repo/pulls/:number/threads/:threadId/resolve', async (c) => {
    const r = await resolvePr(db, c)
    if ('error' in r) return respondError(c, r.status, r.error)
    const threadId = c.req.param('threadId')
    const { resolved } = (await c.req.json().catch(() => ({}))) as { resolved?: boolean }
    const field = resolved ? 'resolveReviewThread' : 'unresolveReviewThread'
    const res = await ghGraphQL(r.token, `mutation($id:ID!){ ${field}(input:{threadId:$id}){ thread { id } } }`, {
      id: threadId,
    })
    const result = await ghGraphQLResult(res)
    if (!result.ok) {
      if (result.kind === 'graphql') return respondError(c, 502, 'github_unavailable')
      return respondError(c, result.failure.status, result.failure.error)
    }
    await bustPrSync(r.db, r.userId, r.repoId, r.number)
    return c.json({ resolved: !!resolved })
  })
  // Submit a PR review: POST /pulls/{n}/reviews { event, body }.
  .post('/:owner/:repo/pulls/:number/reviews', async (c) => {
    const r = await resolvePr(db, c)
    if ('error' in r) return respondError(c, r.status, r.error)
    const { body, event } = (await c.req.json().catch(() => ({}))) as { body?: string; event?: string }
    if (!event || !['APPROVE', 'REQUEST_CHANGES', 'COMMENT'].includes(event))
      return respondError(c, 400, 'bad_request')
    if ((event === 'REQUEST_CHANGES' || event === 'COMMENT') && !body?.trim())
      return respondError(c, 400, 'body_required')
    const res = await gh(r.token, `/repos/${r.owner}/${r.repo}/pulls/${r.number}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: body?.trim() ?? '', event }),
    })
    const err = ghError(res)
    if (err) return respondError(c, err.status, err.error)
    await bustPrSync(r.db, r.userId, r.repoId, r.number)
    return c.json({ ok: true })
  })
  // Request a reviewer: POST /pulls/{n}/requested_reviewers { reviewers }. Remove: DELETE same.
  // bustPrSync so the next composite refetch picks up the changed request set.
  .post('/:owner/:repo/pulls/:number/requested-reviewers', (c) => mutateReviewers(db, c, 'add'))
  .delete('/:owner/:repo/pulls/:number/requested-reviewers', (c) => mutateReviewers(db, c, 'remove'))
  // Rerun a workflow run's failed jobs: POST /actions/runs/{runId}/rerun-failed-jobs (GitHub → 201).
  // Repo-scoped (no PR number): a check's runId is the Actions run, not the PR. No mirror to update;
  // the new run states surface on the next composite refetch.
  .post('/:owner/:repo/actions/:runId/rerun', async (c) => {
    ownerId(c) // gate on auth; the credential itself comes from the stored integration
    const token = await githubToken(c)
    const owner = c.req.param('owner')
    const repo = c.req.param('repo')
    const runId = c.req.param('runId')
    const res = await gh(token, `/repos/${owner}/${repo}/actions/runs/${runId}/rerun-failed-jobs`, { method: 'POST' })
    const err = ghError(res)
    if (err) return respondError(c, err.status, err.error)
    return c.json({ ok: true })
  })

async function mutateReviewers(db: PluginDatabase, c: Context<AppEnv>, op: 'add' | 'remove') {
  const r = await resolvePr(db, c)
  if ('error' in r) return respondError(c, r.status, r.error)
  const { login } = (await c.req.json().catch(() => ({}))) as { login?: string }
  if (!login?.trim()) return respondError(c, 400, 'empty_login')
  const res = await gh(r.token, `/repos/${r.owner}/${r.repo}/pulls/${r.number}/requested_reviewers`, {
    method: op === 'add' ? 'POST' : 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewers: [login] }),
  })
  const err = ghError(res)
  if (err) return respondError(c, err.status, err.error)
  const pr = (await res.json()) as { requested_reviewers?: { login: string }[] }
  const rows = (pr.requested_reviewers ?? []).map((u) => ({ userId: r.userId, repoId: r.repoId, number: r.number, login: u.login }))
  const where = and(
    eq(reviewRequests.userId, r.userId),
    eq(reviewRequests.repoId, r.repoId),
    eq(reviewRequests.number, r.number),
  )
  await r.db.batch([r.db.delete(reviewRequests).where(where), ...rows.map((row) => r.db.insert(reviewRequests).values(row))])
  return c.json(rows.map((row) => row.login))
}

async function mutateLabels(db: PluginDatabase, c: Context<AppEnv>, op: 'add' | 'remove') {
  const r = await resolvePr(db, c)
  if ('error' in r) return respondError(c, r.status, r.error)
  const { name } = (await c.req.json().catch(() => ({}))) as { name?: string }
  if (!name?.trim()) return respondError(c, 400, 'empty_name')
  const res =
    op === 'add'
      ? await gh(r.token, `/repos/${r.owner}/${r.repo}/issues/${r.number}/labels`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ labels: [name] }),
        })
      : await gh(r.token, `/repos/${r.owner}/${r.repo}/issues/${r.number}/labels/${encodeURIComponent(name)}`, {
          method: 'DELETE',
        })
  const err = ghError(res)
  if (err) return respondError(c, err.status, err.error)
  const labels = (await res.json()) as { name: string; color: string | null }[]
  const rows = labels.map((l) => ({ userId: r.userId, repoId: r.repoId, number: r.number, name: l.name, color: l.color }))
  const where = and(
    eq(prLabels.userId, r.userId),
    eq(prLabels.repoId, r.repoId),
    eq(prLabels.number, r.number),
  )
  await r.db.batch([r.db.delete(prLabels).where(where), ...rows.map((row) => r.db.insert(prLabels).values(row))])
  return c.json(rows.map((row) => ({ name: row.name, color: row.color })))
}
