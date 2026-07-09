import { and, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import type { PullBatchFilesMode, PullBatchItem, PullBatchRequest } from '../../shared/api'
import { getDb, schema } from '../db'
import { filesResource, prResource } from '../db/resourceKeys'
import { ghError, ghGraphQL } from '../github'
import type { AppEnv } from '../middleware/auth'
import { getUser } from '../middleware/requireUser'
import { respondError } from '../respond'
import { fetchFiles, mirrorFiles, mirrorPr, PR_FRAGMENT, readComposite, readFiles, STALE_AFTER_MS, type GqlPull } from './prMirror'
import { resolveRepoForUser } from './repoMirror'

// Batch prefetch — warm the mirror for several open PRs at once so client navigation is instant.
// Detail is one multi-alias GraphQL call for all stale PRs (one GitHub round-trip); files stay N
// parallel REST calls (REST can't be aliased). Per-PR TTL skip means already-fresh PRs cost no
// GitHub calls. Reuses the same mirror tables/logic as the single-PR routes (prMirror.ts).
const MAX_BATCH = 10 // bounds the GraphQL query size; the client sends ~5
const isFilesMode = (value: unknown): value is PullBatchFilesMode =>
  value === 'full' || value === 'summary' || value === 'none'

export const pullsBatch = new Hono<AppEnv>().post('/:owner/:repo/pulls/batch', async (c) => {
  const user = getUser(c)

  const owner = c.req.param('owner')
  const repo = c.req.param('repo')
  const body = await c.req.json<Partial<PullBatchRequest> & { numbers?: unknown; files?: unknown }>().catch(() => null)
  const raw = body?.numbers
  if (!Array.isArray(raw) || raw.some((n) => !Number.isInteger(n))) return respondError(c, 400, 'bad_numbers')
  const numbers = [...new Set(raw as number[])]
  if (numbers.length === 0 || numbers.length > MAX_BATCH) return respondError(c, 400, 'bad_numbers')
  const filesMode = body?.files ?? 'full'
  if (!isFilesMode(filesMode)) return respondError(c, 400, 'bad_files_mode')

  const db = getDb(c.env)
  const userId = user.login
  const resolved = await resolveRepoForUser(db, user.token, userId, owner, repo)
  if (!resolved.ok) return respondError(c, resolved.failure.status, resolved.failure.error)
  const { repoId } = resolved.value

  // Per-PR TTL: only stale resources go to GitHub; fresh ones serve straight from the mirror.
  const resources = numbers.flatMap((n) => [prResource(repoId, n), filesResource(repoId, n)])
  const syncRows = await db
    .select({ resource: schema.syncState.resource, fetchedAt: schema.syncState.fetchedAt })
    .from(schema.syncState)
    .where(and(eq(schema.syncState.userId, userId), inArray(schema.syncState.resource, resources)))
  const now = Date.now()
  const freshAt = new Map(syncRows.map((s) => [s.resource, s.fetchedAt]))
  const isFresh = (resource: string) => {
    const f = freshAt.get(resource)
    return f != null && f + STALE_AFTER_MS > now
  }
  const staleDetail = numbers.filter((n) => !isFresh(prResource(repoId, n)))
  const staleFiles = filesMode === 'none' ? [] : numbers.filter((n) => !isFresh(filesResource(repoId, n)))

  // Detail: one multi-alias GraphQL query for all stale PRs. A whole-response error (auth/rate
  // limit) fails the batch — the client treats prefetch as best-effort and falls back to on-demand.
  if (staleDetail.length) {
    const varDecls = staleDetail.map((_, i) => `$n${i}: Int!`).join(', ')
    const aliases = staleDetail.map((n, i) => `pr_${n}: pullRequest(number: $n${i}) { ...PrFields }`).join('\n    ')
    const query = `
query Batch($owner: String!, $repo: String!, ${varDecls}) {
  repository(owner: $owner, name: $repo) {
    ${aliases}
  }
}${PR_FRAGMENT}`
    const variables: Record<string, unknown> = { owner, repo }
    staleDetail.forEach((n, i) => (variables[`n${i}`] = n))

    const res = await ghGraphQL(user.token, query, variables)
    const err = ghError(res)
    if (err) return respondError(c, err.status, err.error)
    const json = (await res.json()) as {
      data?: { repository?: Record<string, GqlPull | null> | null }
      errors?: { message: string }[]
    }
    // Partial alias errors are tolerated (mirror the PRs that did resolve); a fully-missing
    // repository payload is a hard failure.
    if (json.errors?.length) console.error('pullsBatch GraphQL errors', JSON.stringify(json.errors))
    const repository = json.data?.repository
    if (!repository) return respondError(c, 502, 'graphql', json.errors?.map((e) => e.message))
    await Promise.all(
      staleDetail.map((n) => {
        const pr = repository[`pr_${n}`]
        return pr ? mirrorPr(db, { userId, repoId, number: n }, pr, now) : undefined
      }),
    )
  }

  // Files: parallel REST (can't be aliased); a single failed fetch just omits that PR's files.
  if (staleFiles.length) {
    const fetched = await Promise.allSettled(staleFiles.map((n) => fetchFiles(user.token, owner, repo, n)))
    await Promise.all(
      fetched.map((r, i) => {
        if (r.status !== 'fulfilled' || !r.value.ok) return undefined
        return mirrorFiles(c.env, db, { userId, repoId, number: staleFiles[i]! }, r.value.value)
      }),
    )
  }

  // Read every requested PR back out of the (now-warm) mirror.
  const items = await Promise.all(
    numbers.map(async (number): Promise<PullBatchItem> => {
      const key = { userId, repoId, number }
      const [detail, files] = await Promise.all([
        readComposite(db, key),
        filesMode === 'none' ? [] : readFiles(c.env, db, key, { includePatches: filesMode === 'full' }),
      ])
      return { number, detail, files }
    }),
  )
  return c.json(items)
})
