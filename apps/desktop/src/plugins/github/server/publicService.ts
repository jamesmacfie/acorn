import { type AnyColumn, and, eq, inArray } from 'drizzle-orm'
import type { z } from 'zod'
import { type AppDatabase, schema } from '../../../core/server/db'
import { PublicApiError } from '../../../core/shared/publicApi/errors'
import type {
  ActionJobsSchema,
  CommentSchema,
  CompareSchema,
  CreatePullSchema,
  PullDetailSchema,
  PullFileSchema,
  PullSchema,
  RepoSchema,
} from '../../../core/shared/publicApi/github'
import { gh, ghError, ghGraphQL } from '.'
import { refreshRepos } from './routes/repoMirror'

// GitHub public service (docs/public-api.md). Reads project the local mirror tables
// (Acorn's stable projection, never raw GitHub). Mutations resolve the encrypted OAuth credential
// and call GitHub; an invalid upstream token is 424 (not 401 — the Acorn bearer is still valid).

type Repo = z.infer<typeof RepoSchema>
type Pull = z.infer<typeof PullSchema>
type PullFile = z.infer<typeof PullFileSchema>
type PullDetail = z.infer<typeof PullDetailSchema>
type Comment = z.infer<typeof CommentSchema>

export type GitHubPublicDeps = {
  db: AppDatabase
  blobs: { get(key: string): Promise<string | null> }
  resolveToken: (userId: string) => Promise<string | null>
}

// Map an upstream GitHub error to the public vocabulary. 401 → 424 (renew GitHub), not a bearer 401.
function upstreamError(status: number, message: string): PublicApiError {
  if (status === 401) return new PublicApiError('upstream_reauthentication_required', 'GitHub authorization must be renewed in Acorn', { details: { provider: 'github' } })
  if (status === 429) return new PublicApiError('upstream_rate_limited', message)
  if (status === 403) return new PublicApiError('operation_forbidden', message)
  return new PublicApiError('provider_unavailable', message)
}

export class GitHubPublicService {
  constructor(private readonly deps: GitHubPublicDeps) {}

  private async repoId(userId: string, owner: string, name: string): Promise<number | null> {
    const [row] = await this.deps.db
      .select({ id: schema.repos.id })
      .from(schema.repos)
      .where(and(eq(schema.repos.userId, userId), eq(schema.repos.owner, owner), eq(schema.repos.name, name)))
      .limit(1)
    return row?.id ?? null
  }

  async repos(userId: string): Promise<Repo[]> {
    const rows = await this.deps.db.select().from(schema.repos).where(eq(schema.repos.userId, userId))
    return rows
      .map((r) => ({ id: r.id, owner: r.owner, name: r.name, private: r.private, defaultBranch: r.defaultBranch, pushedAt: r.pushedAt }))
      .sort((a, b) => (b.pushedAt ?? 0) - (a.pushedAt ?? 0))
  }

  async pulls(userId: string, owner: string, repo: string, state: 'open' | 'closed'): Promise<Pull[]> {
    const repoId = await this.repoId(userId, owner, repo)
    if (repoId === null) return []
    const rows = await this.deps.db
      .select()
      .from(schema.pullRequests)
      .where(and(eq(schema.pullRequests.userId, userId), eq(schema.pullRequests.repoId, repoId)))
    return rows.filter((r) => (state === 'open' ? r.state === 'open' : r.state !== 'open')).map((r) => this.rowToPull(r))
  }

  private rowToPull(r: typeof schema.pullRequests.$inferSelect): Pull {
    return {
      number: r.number,
      title: r.title,
      state: r.state,
      draft: r.draft,
      author: r.author,
      headRef: r.headRef,
      baseRef: r.baseRef,
      updatedAt: r.updatedAt,
      mergeable: r.mergeable,
      mergeStateStatus: r.mergeStateStatus,
      autoMergeEnabled: r.autoMergeEnabled,
    }
  }

  // Batch-warm: return the mirrored pull items for the requested numbers (read-scoped).
  async prefetch(userId: string, owner: string, repo: string, numbers: number[]): Promise<Pull[]> {
    const repoId = await this.repoId(userId, owner, repo)
    if (repoId === null) return []
    const rows = await this.deps.db
      .select()
      .from(schema.pullRequests)
      .where(and(eq(schema.pullRequests.userId, userId), eq(schema.pullRequests.repoId, repoId), inArray(schema.pullRequests.number, numbers)))
    return rows.map((r) => this.rowToPull(r))
  }

  async pullDetail(userId: string, owner: string, repo: string, number: number): Promise<PullDetail> {
    const repoId = await this.repoId(userId, owner, repo)
    if (repoId === null) throw new PublicApiError('not_found', 'Repository not mirrored')
    const key = and(eq(schema.pullRequests.userId, userId), eq(schema.pullRequests.repoId, repoId), eq(schema.pullRequests.number, number))
    const [pr] = await this.deps.db.select().from(schema.pullRequests).where(key).limit(1)
    const db = this.deps.db
    // Every PR-detail child table is keyed by (userId, repoId, number).
    const scope = (t: { userId: AnyColumn; repoId: AnyColumn; number: AnyColumn }) => and(eq(t.userId, userId), eq(t.repoId, repoId), eq(t.number, number))

    const [reviews, comments, commits, labels, reviewers, checks, threads] = await Promise.all([
      db.select().from(schema.reviews).where(scope(schema.reviews)),
      db.select().from(schema.comments).where(scope(schema.comments)),
      db.select().from(schema.prCommits).where(scope(schema.prCommits)),
      db.select().from(schema.prLabels).where(scope(schema.prLabels)),
      db.select().from(schema.reviewRequests).where(scope(schema.reviewRequests)),
      db.select().from(schema.checks).where(scope(schema.checks)),
      db.select().from(schema.reviewThreads).where(scope(schema.reviewThreads)),
    ])

    const threadMap = new Map<string, PullDetail['threads'][number]>()
    for (const t of threads) {
      const thread = threadMap.get(t.threadId) ?? { threadId: t.threadId, path: t.path, line: t.line, side: t.side, resolved: t.resolved, comments: [] }
      thread.comments.push({ id: t.id, databaseId: t.databaseId, author: t.author, body: t.body, createdAt: t.createdAt })
      threadMap.set(t.threadId, thread)
    }

    return {
      pull: pr ? { ...this.rowToPull(pr), body: pr.body, headSha: pr.headSha } : null,
      labels: labels.map((l) => ({ name: l.name, color: l.color })),
      reviews: reviews.map((r) => ({ id: r.id, author: r.author, state: r.state, body: r.body, submittedAt: r.submittedAt })),
      requestedReviewers: reviewers.map((r) => r.login),
      comments: comments.map((c) => ({ id: c.id, author: c.author, body: c.body, createdAt: c.createdAt })),
      commits: commits.map((c) => ({ sha: c.sha, message: c.message, author: c.author, authorLogin: c.authorLogin, committedAt: c.committedAt })),
      checks: checks.map((c) => ({ name: c.name, status: c.status, url: c.url, runId: c.runId })),
      threads: [...threadMap.values()],
    }
  }

  async pullFiles(userId: string, owner: string, repo: string, number: number, includePatch: boolean): Promise<PullFile[]> {
    const repoId = await this.repoId(userId, owner, repo)
    if (repoId === null) return []
    const rows = await this.deps.db
      .select()
      .from(schema.prFiles)
      .where(and(eq(schema.prFiles.userId, userId), eq(schema.prFiles.repoId, repoId), eq(schema.prFiles.number, number)))
    const viewedRows = await this.deps.db
      .select({ path: schema.viewedFiles.path })
      .from(schema.viewedFiles)
      .where(and(eq(schema.viewedFiles.userId, userId), eq(schema.viewedFiles.repoId, repoId), eq(schema.viewedFiles.number, number)))
    const viewed = new Set(viewedRows.map((v) => v.path))
    const out: PullFile[] = []
    for (const f of rows) {
      const patch = includePatch && f.sha ? await this.deps.blobs.get(`patch:${f.sha}`) : null
      out.push({ path: f.path, status: f.status, additions: f.additions, deletions: f.deletions, sha: f.sha, viewed: viewed.has(f.path), patch })
    }
    return out
  }

  async blob(sha: string): Promise<{ text: string }> {
    const text = await this.deps.blobs.get(`filebody:${sha}`)
    if (text === null) throw new PublicApiError('not_found', 'Blob not cached')
    if (Buffer.byteLength(text) > 5 * 1024 * 1024) throw new PublicApiError('response_too_large', 'Blob exceeds the 5 MiB cap')
    return { text }
  }

  // ---- Mutations (resolve the encrypted OAuth credential) ----

  private async token(userId: string): Promise<string> {
    const token = await this.deps.resolveToken(userId)
    if (!token) throw new PublicApiError('upstream_reauthentication_required', 'No stored GitHub credential; reauthenticate in Acorn', { details: { provider: 'github' } })
    return token
  }

  private async ghJson<T>(userId: string, path: string, init?: RequestInit): Promise<T> {
    const res = await gh(await this.token(userId), path, init)
    const err = ghError(res)
    if (err) throw upstreamError(err.status, err.error)
    return (await res.json()) as T
  }

  async createPull(userId: string, owner: string, repo: string, input: z.infer<typeof CreatePullSchema>): Promise<{ number: number }> {
    const body = await this.ghJson<{ number: number }>(userId, `/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      body: JSON.stringify({ title: input.title, body: input.body, base: input.base, head: input.head, draft: input.draft }),
    })
    return { number: body.number }
  }

  async merge(userId: string, owner: string, repo: string, number: number, method: 'merge' | 'squash' | 'rebase'): Promise<{ state: 'merged' }> {
    await this.ghJson(userId, `/repos/${owner}/${repo}/pulls/${number}/merge`, { method: 'PUT', body: JSON.stringify({ merge_method: method }) })
    return { state: 'merged' }
  }

  async comment(userId: string, owner: string, repo: string, number: number, text: string): Promise<Comment> {
    const c = await this.ghJson<{ id: number | string; user?: { login?: string }; body?: string; created_at?: string }>(
      userId,
      `/repos/${owner}/${repo}/issues/${number}/comments`,
      { method: 'POST', body: JSON.stringify({ body: text }) },
    )
    return { id: String(c.id), author: c.user?.login ?? null, body: c.body ?? null, createdAt: c.created_at ? Date.parse(c.created_at) : null }
  }

  async setState(userId: string, owner: string, repo: string, number: number, state: 'closed' | 'open'): Promise<{ state: 'closed' | 'open' }> {
    await this.ghJson(userId, `/repos/${owner}/${repo}/pulls/${number}`, { method: 'PATCH', body: JSON.stringify({ state }) })
    return { state }
  }

  // The PR's GraphQL node id + head sha from the mirror — needed for GraphQL mutations / inline comments.
  private async prMeta(userId: string, owner: string, repo: string, number: number): Promise<{ nodeId: string; headSha: string | null }> {
    const repoId = await this.repoId(userId, owner, repo)
    if (repoId === null) throw new PublicApiError('not_found', 'Repository not mirrored')
    const [pr] = await this.deps.db
      .select({ nodeId: schema.pullRequests.nodeId, headSha: schema.pullRequests.headSha })
      .from(schema.pullRequests)
      .where(and(eq(schema.pullRequests.userId, userId), eq(schema.pullRequests.repoId, repoId), eq(schema.pullRequests.number, number)))
      .limit(1)
    if (!pr?.nodeId) throw new PublicApiError('not_found', 'Pull request not mirrored')
    return { nodeId: pr.nodeId, headSha: pr.headSha }
  }

  private async graphql(userId: string, query: string, variables: Record<string, unknown>): Promise<void> {
    const res = await ghGraphQL(await this.token(userId), query, variables)
    const err = ghError(res)
    if (err) throw upstreamError(err.status, err.error)
  }

  async setDraft(userId: string, owner: string, repo: string, number: number, draft: boolean): Promise<{ draft: boolean }> {
    const { nodeId } = await this.prMeta(userId, owner, repo, number)
    const mutation = draft
      ? `mutation($id:ID!){ convertPullRequestToDraft(input:{pullRequestId:$id}){ clientMutationId } }`
      : `mutation($id:ID!){ markPullRequestReadyForReview(input:{pullRequestId:$id}){ clientMutationId } }`
    await this.graphql(userId, mutation, { id: nodeId })
    return { draft }
  }

  async enableAutoMerge(userId: string, owner: string, repo: string, number: number, method: 'merge' | 'squash' | 'rebase'): Promise<{ autoMergeEnabled: true }> {
    const { nodeId } = await this.prMeta(userId, owner, repo, number)
    await this.graphql(userId, `mutation($id:ID!,$m:PullRequestMergeMethod!){ enablePullRequestAutoMerge(input:{pullRequestId:$id, mergeMethod:$m}){ clientMutationId } }`, { id: nodeId, m: method.toUpperCase() })
    return { autoMergeEnabled: true }
  }

  async disableAutoMerge(userId: string, owner: string, repo: string, number: number): Promise<void> {
    const { nodeId } = await this.prMeta(userId, owner, repo, number)
    await this.graphql(userId, `mutation($id:ID!){ disablePullRequestAutoMerge(input:{pullRequestId:$id}){ clientMutationId } }`, { id: nodeId })
  }

  async setThreadResolved(userId: string, threadId: string, resolved: boolean): Promise<{ resolved: boolean }> {
    const field = resolved ? 'resolveReviewThread' : 'unresolveReviewThread'
    await this.graphql(userId, `mutation($id:ID!){ ${field}(input:{threadId:$id}){ thread { id } } }`, { id: threadId })
    return { resolved }
  }

  async labels(userId: string, owner: string, repo: string, number: number, op: 'add' | 'remove', name: string): Promise<{ name: string; color: string | null }[]> {
    const raw =
      op === 'add'
        ? await this.ghJson<{ name: string; color: string | null }[]>(userId, `/repos/${owner}/${repo}/issues/${number}/labels`, { method: 'POST', body: JSON.stringify({ labels: [name] }) })
        : await this.ghJson<{ name: string; color: string | null }[]>(userId, `/repos/${owner}/${repo}/issues/${number}/labels/${encodeURIComponent(name)}`, { method: 'DELETE' })
    return raw.map((l) => ({ name: l.name, color: l.color ?? null }))
  }

  async setViewed(userId: string, owner: string, repo: string, number: number, path: string, viewed: boolean): Promise<{ path: string; viewed: boolean }> {
    const repoId = await this.repoId(userId, owner, repo)
    if (repoId === null) throw new PublicApiError('not_found', 'Repository not mirrored')
    if (viewed) {
      await this.deps.db.insert(schema.viewedFiles).values({ userId, repoId, number, path, viewedAt: Date.now() }).onConflictDoNothing()
    } else {
      await this.deps.db
        .delete(schema.viewedFiles)
        .where(and(eq(schema.viewedFiles.userId, userId), eq(schema.viewedFiles.repoId, repoId), eq(schema.viewedFiles.number, number), eq(schema.viewedFiles.path, path)))
    }
    return { path, viewed }
  }

  async reviewComment(userId: string, owner: string, repo: string, number: number, input: { body: string; path: string; line: number; side: 'LEFT' | 'RIGHT' }): Promise<{ created: true }> {
    const { headSha } = await this.prMeta(userId, owner, repo, number)
    await this.ghJson(userId, `/repos/${owner}/${repo}/pulls/${number}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: input.body, commit_id: headSha, path: input.path, line: input.line, side: input.side }),
    })
    return { created: true }
  }

  async reviewReply(userId: string, owner: string, repo: string, number: number, commentId: string, body: string): Promise<{ created: true }> {
    await this.ghJson(userId, `/repos/${owner}/${repo}/pulls/${number}/comments/${commentId}/replies`, { method: 'POST', body: JSON.stringify({ body }) })
    return { created: true }
  }

  async submitReview(userId: string, owner: string, repo: string, number: number, event: string, body: string): Promise<{ submitted: true }> {
    await this.ghJson(userId, `/repos/${owner}/${repo}/pulls/${number}/reviews`, { method: 'POST', body: JSON.stringify({ event, body }) })
    return { submitted: true }
  }

  async requestedReviewers(userId: string, owner: string, repo: string, number: number, op: 'add' | 'remove', login: string): Promise<{ reviewers: string[] }> {
    const pr = await this.ghJson<{ requested_reviewers?: { login: string }[] }>(userId, `/repos/${owner}/${repo}/pulls/${number}/requested_reviewers`, {
      method: op === 'add' ? 'POST' : 'DELETE',
      body: JSON.stringify({ reviewers: [login] }),
    })
    return { reviewers: (pr.requested_reviewers ?? []).map((u) => u.login) }
  }

  async rerunFailed(userId: string, owner: string, repo: string, runId: number): Promise<{ accepted: true }> {
    await this.ghJson(userId, `/repos/${owner}/${repo}/actions/runs/${runId}/rerun-failed-jobs`, { method: 'POST' })
    return { accepted: true }
  }

  async repoLabels(userId: string, owner: string, repo: string): Promise<{ name: string; color: string | null }[]> {
    const raw = await this.ghJson<{ name: string; color: string | null }[]>(userId, `/repos/${owner}/${repo}/labels?per_page=100`)
    return raw.map((l) => ({ name: l.name, color: l.color ?? null }))
  }

  // Force-refresh the repo mirror from GitHub (consumes quota → write scope). Returns the refreshed
  // projection.
  async refreshRepos(userId: string): Promise<Repo[]> {
    const token = await this.token(userId)
    try {
      await refreshRepos(token, this.deps.db, userId)
    } catch (e) {
      throw upstreamError(500, e instanceof Error ? e.message : 'repo refresh failed')
    }
    return this.repos(userId)
  }

  async branches(userId: string, owner: string, repo: string): Promise<{ name: string }[]> {
    const raw = await this.ghJson<{ name: string }[]>(userId, `/repos/${owner}/${repo}/branches?per_page=100`)
    return raw.map((b) => ({ name: b.name }))
  }

  async mentions(userId: string, owner: string, repo: string, query?: string): Promise<string[]> {
    const raw = await this.ghJson<{ login: string }[]>(userId, `/repos/${owner}/${repo}/assignees?per_page=100`)
    const logins = raw.map((u) => u.login)
    return query ? logins.filter((l) => l.toLowerCase().includes(query.toLowerCase())) : logins
  }

  async compare(userId: string, owner: string, repo: string, base: string, head: string): Promise<z.infer<typeof CompareSchema>> {
    const r = await this.ghJson<{
      ahead_by?: number
      files?: { filename: string; status?: string; additions?: number; deletions?: number }[]
      commits?: { sha: string; commit: { message: string; author?: { name?: string } } }[]
    }>(userId, `/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`)
    return {
      aheadBy: r.ahead_by ?? 0,
      files: (r.files ?? []).map((f) => ({ path: f.filename, status: f.status ?? null, additions: f.additions ?? null, deletions: f.deletions ?? null })),
      commits: (r.commits ?? []).map((c) => ({ sha: c.sha, message: c.commit.message, author: c.commit.author?.name ?? null })),
    }
  }

  // Project a specific set of changed-file paths from the mirror (with patch bodies).
  async filesBatch(userId: string, owner: string, repo: string, number: number, paths: string[]): Promise<PullFile[]> {
    const all = await this.pullFiles(userId, owner, repo, number, true)
    const wanted = new Set(paths)
    return all.filter((f) => wanted.has(f.path))
  }

  async actionsJobs(userId: string, owner: string, repo: string, runId: number): Promise<z.infer<typeof ActionJobsSchema>> {
    const r = await this.ghJson<{ jobs?: { name: string; status?: string; conclusion?: string; steps?: { name: string; status?: string; conclusion?: string; number: number }[] }[] }>(
      userId,
      `/repos/${owner}/${repo}/actions/runs/${runId}/jobs`,
    )
    return {
      jobs: (r.jobs ?? []).map((j) => ({
        name: j.name,
        status: j.status ?? null,
        conclusion: j.conclusion ?? null,
        steps: (j.steps ?? []).map((s) => ({ name: s.name, status: s.status ?? null, conclusion: s.conclusion ?? null, number: s.number })),
      })),
    }
  }

  async jobLog(userId: string, owner: string, repo: string, jobId: number): Promise<{ text: string; truncated: boolean }> {
    const res = await gh(await this.token(userId), `/repos/${owner}/${repo}/actions/jobs/${jobId}/logs`)
    const err = ghError(res)
    if (err) throw upstreamError(err.status, err.error)
    const full = await res.text()
    const CAP = 1_048_576
    return Buffer.byteLength(full) > CAP ? { text: full.slice(0, CAP), truncated: true } : { text: full, truncated: false }
  }
}
