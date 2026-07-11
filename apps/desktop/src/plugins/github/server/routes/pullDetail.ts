import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import type { PullDetail } from '../../../../core/shared/api'
import { getDb, schema } from '../../../../core/server/db'
import { prResource } from '../../../../core/server/db/resourceKeys'
import type { AppEnv } from '../../../../core/server/middleware/auth'
import { getUser } from '../../../../core/server/middleware/requireUser'
import { respondError } from '../../../../core/server/respond'
import { type Cached, serveThenRevalidate } from '../../../../core/server/sync/engine'
import { PULLS_STALE_AFTER_MS } from '../../../../core/server/sync/policy'
import { readComposite } from './prMirror'
import { refreshPullDetail } from './pullRefresh'
import { resolveRepoForUser } from './repoMirror'

// PR detail — the composite GraphQL read (docs/github-integration.md), the primary read for the
// PR screen: PR + reviews + comments + checks in one round-trip. GraphQL has no ETag, so
// freshness is a TTL gate in sync_state (`pr:<repoId>:<number>`); the mirror tables are the
// cache. The mirror logic is shared with the batch route — see prMirror.ts. Files live in
// pr_files, owned by /files.
export const pullDetail = new Hono<AppEnv>().get('/:owner/:repo/pulls/:number', async (c) => {
  const user = getUser(c)

  const db = getDb(c.env)
  const userId = user.login
  const owner = c.req.param('owner')
  const repo = c.req.param('repo')
  const number = Number(c.req.param('number'))
  if (!Number.isInteger(number)) return respondError(c, 400, 'bad_number')

  const resolved = await resolveRepoForUser(db, user.token, userId, owner, repo)
  if (!resolved.ok) return respondError(c, resolved.failure.status, resolved.failure.error)
  const repoId = resolved.value.repoId
  const key = { userId, repoId, number }
  const resource = prResource(repoId, number)

  // Cold when never fetched (no sync row) OR the composite has no pull yet — both mean "nothing
  // usable to serve, block on a refresh". `pull` is written atomically with the sync row by
  // mirrorPr, so a fresh sync row always carries a pull; the null-pull case is the stale-empty one.
  const read = async (): Promise<Cached<PullDetail> | null> => {
    const [sync] = await db
      .select()
      .from(schema.syncState)
      .where(and(eq(schema.syncState.userId, userId), eq(schema.syncState.resource, resource)))
    if (!sync) return null
    const composite = await readComposite(db, key)
    if (!composite.pull) return null
    return { data: composite, fetchedAt: sync.fetchedAt }
  }

  const refresh = () => refreshPullDetail(user.token, db, { userId, repoId, owner, repo, number })

  const result = await serveThenRevalidate({
    resource,
    userId,
    ttlMs: PULLS_STALE_AFTER_MS,
    force: c.req.query('force') === 'true',
    read,
    refresh,
  })
  if (!result.ok) return respondError(c, result.failure.status, result.failure.error, result.failure.detail)
  return c.json(result.value)
})
