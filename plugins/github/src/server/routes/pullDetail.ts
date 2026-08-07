import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import type { PullDetail } from '../../contract/api'
import { prResource } from '../resourceKeys'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import { ownerId } from '@acorn/node-core/server/middleware/requireUser.ts'
import { respondError } from '@acorn/node-core/server/respond.ts'
import { type Cached, serveThenRevalidate } from '@acorn/node-core/server/sync/engine.ts'
import { PULLS_STALE_AFTER_MS } from '@acorn/node-core/server/sync/policy.ts'
import { readComposite } from './prMirror'
import { refreshPullDetail } from './pullRefresh'
import { resolveRepoForUser } from './repoMirror'
import { githubToken } from '../githubToken'
import { syncState } from '../../node/schema'
import type { PluginDatabase } from '@acorn/node-core/main/pluginStorage.ts'

// PR detail — the composite GraphQL read (docs/github-integration.md), the primary read for the
// PR screen: PR + reviews + comments + checks in one round-trip. GraphQL has no ETag, so
// freshness is a TTL gate in sync_state (`pr:<repoId>:<number>`); the mirror tables are the
// cache. The mirror logic is shared with the batch route — see prMirror.ts. Files live in
// pr_files, owned by /files.
// A FACTORY over this plugin's own database, not a module-scope router reading getDb(c.env). The tables
// live in <data-root>/plugins/github.sqlite now, and `c.env` deliberately carries no per-plugin handles
// (docs/data-layer.md § Plugin DBs). The handle arrives at plugin init, so no request can reach an
// unmigrated database — and a second startServiceRuntime in one process builds fresh routers over its own
// handle instead of inheriting a closed one.
export const pullDetail = (db: PluginDatabase) => new Hono<AppEnv>().get('/:owner/:repo/pulls/:number', async (c) => {
  const uid = ownerId(c)
  const token = await githubToken(c)

  const userId = uid
  const owner = c.req.param('owner')
  const repo = c.req.param('repo')
  const number = Number(c.req.param('number'))
  if (!Number.isInteger(number)) return respondError(c, 400, 'bad_number')

  const resolved = await resolveRepoForUser(db, token, userId, owner, repo)
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
      .from(syncState)
      .where(and(eq(syncState.userId, userId), eq(syncState.resource, resource)))
    if (!sync) return null
    const composite = await readComposite(db, key)
    if (!composite.pull) return null
    return { data: composite, fetchedAt: sync.fetchedAt }
  }

  const refresh = () => refreshPullDetail(token, db, { userId, repoId, owner, repo, number })

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
