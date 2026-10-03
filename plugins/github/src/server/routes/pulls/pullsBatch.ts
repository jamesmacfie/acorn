import { and, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import type { PullBatchFilesMode, PullBatchItem, PullBatchRequest } from '../../../shared/api'
import { filesResource, prResource } from '../../resourceKeys'
import { type AppEnv, createLogger, ownerId, type PluginDatabase, respondError } from '@acorn/plugin-api/node'
import { PULLS_STALE_AFTER_MS } from '../../syncPolicy'
import { filesCompleteness, readComposite, readFiles } from '../mirror/prMirror'
import { refreshPullDetail, refreshPullFiles } from './pullRefresh'
import { mapLimited } from '../../mapLimited'
import { type GithubEmit, NO_EMIT } from '../../events'
import { resolveRepoForUser } from '../mirror/repoMirror'
import { githubToken } from '../../githubToken'
import { syncState } from '../../../node/schema'

// Batch prefetch: warm the mirror for several open PRs at once so client navigation is instant.
// Each stale PR goes through the same complete refresh as the single-PR routes (pullRefresh.ts), a
// few PRs at a time. There is no batch-only query: a multi-alias query would have to stop at each
// connection's first page, which is the truncation the single-PR path no longer allows. Per-PR TTL
// skip means already-fresh PRs cost no GitHub calls.
//
// Not on the serve-then-revalidate engine (docs/caching.md). A multi-item prefetch has no single
// response resource to hand back stale, so this always blocks. It shares the engine's TTL
// (PULLS_STALE_AFTER_MS) and owns the per-item freshness gate below.
// A route module with no `ctx` in reach, so the owner is stated here rather than bound by the host
// (docs/plugin-authoring.md § Telemetry and logging).
const log = createLogger('github', 'github')

const MAX_BATCH = 10 // the client sends ~5
// PRs refreshed at once. Each walks its own connections, so this bounds the GitHub requests in flight.
const REFRESH_CONCURRENCY = 3
const isFilesMode = (value: unknown): value is PullBatchFilesMode =>
  value === 'full' || value === 'summary' || value === 'none'

// Factory over this plugin's own database, not a module-scope router (docs/data-layer/plugin-databases.md § Plugin
// databases).
export const pullsBatch = (db: PluginDatabase, emit: GithubEmit = NO_EMIT) => new Hono<AppEnv>().post('/:owner/:repo/pulls/batch', async (c) => {
  const uid = ownerId(c)
  const token = await githubToken(c)

  const owner = c.req.param('owner')
  const repo = c.req.param('repo')
  const body = await c.req.json<Partial<PullBatchRequest> & { numbers?: unknown; files?: unknown }>().catch(() => null)
  const raw = body?.numbers
  if (!Array.isArray(raw) || raw.some((n) => !Number.isInteger(n))) return respondError(c, 400, 'bad_numbers')
  const numbers = [...new Set(raw as number[])]
  if (numbers.length === 0 || numbers.length > MAX_BATCH) return respondError(c, 400, 'bad_numbers')
  const filesMode = body?.files ?? 'full'
  if (!isFilesMode(filesMode)) return respondError(c, 400, 'bad_files_mode')

  const userId = uid
  const resolved = await resolveRepoForUser(db, token, userId, owner, repo, { emit })
  if (!resolved.ok) return respondError(c, resolved.failure.status, resolved.failure.error)
  const { repoId } = resolved.value

  // Per-PR TTL: only stale resources go to GitHub; fresh ones serve straight from the mirror.
  const resources = numbers.flatMap((n) => [prResource(repoId, n), filesResource(repoId, n)])
  const syncRows = await db
    .select({ resource: syncState.resource, fetchedAt: syncState.fetchedAt })
    .from(syncState)
    .where(and(eq(syncState.userId, userId), inArray(syncState.resource, resources)))
  const now = Date.now()
  const freshAt = new Map(syncRows.map((s) => [s.resource, s.fetchedAt]))
  const isFresh = (resource: string) => {
    const f = freshAt.get(resource)
    return f != null && f + PULLS_STALE_AFTER_MS > now
  }
  const staleDetail = numbers.filter((n) => !isFresh(prResource(repoId, n)))
  const staleFiles = filesMode === 'none' ? [] : numbers.filter((n) => !isFresh(filesResource(repoId, n)))

  // A failed refresh leaves that PR's previous mirror, or nothing, and the batch carries on: prefetch
  // is best-effort, and the client falls back to the on-demand routes. An account-level failure
  // (reauth, SSO, rate limit) fails the batch, as it would fail every PR in it.
  const key = (number: number) => ({ userId, repoId, owner, repo, number })
  const [details, files] = await Promise.all([
    mapLimited(staleDetail, REFRESH_CONCURRENCY, (n) => refreshPullDetail(token, db, key(n), emit)),
    mapLimited(staleFiles, REFRESH_CONCURRENCY, (n) => refreshPullFiles(token, db, c.env.BLOBS, key(n))),
  ])
  for (const result of [...details, ...files]) {
    if (result.ok) continue
    if (result.failure.status !== 404 && result.failure.status !== 502) return respondError(c, result.failure.status, result.failure.error)
    log.warn(`pullsBatch refresh failed: ${result.failure.error}`)
  }

  // Read every requested PR back out of the (now-warm) mirror.
  const fileSyncs = new Map(
    (await db.select().from(syncState).where(and(eq(syncState.userId, userId), inArray(syncState.resource, numbers.map((n) => filesResource(repoId, n))))))
      .map((row) => [row.resource, row]),
  )
  const items = await Promise.all(
    numbers.map(async (number): Promise<PullBatchItem> => {
      const key = { userId, repoId, number }
      const sync = fileSyncs.get(filesResource(repoId, number))
      const [detail, files] = await Promise.all([
        readComposite(db, key),
        filesMode === 'none' || !sync ? null : readFiles(c.env.BLOBS, db, key, { includePatches: filesMode === 'full' }),
      ])
      return { number, detail, ...(sync && files?.ok ? { files: { files: files.files, completeness: filesCompleteness(sync) } } : {}) }
    }),
  )
  return c.json(items)
})
