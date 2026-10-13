import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import type { PullDetail } from '../../../shared/api'
import { prResource } from '../../resourceKeys'
import {
  type AppEnv,
  type Cached,
  ownerId,
  type PluginDatabase,
  respondError,
  serveThenRevalidate,
} from '@acorn/plugin-api/node'
import { PULLS_STALE_AFTER_MS } from '../../syncPolicy'
import { readComposite } from '../mirror/prMirror'
import { refreshPullDetail } from './pullRefresh'
import { type GithubEmit, NO_EMIT } from '../../events'
import { resolveRepoForUser } from '../mirror/repoMirror'
import { githubToken } from '../../githubToken'
import { syncState } from '../../../node/schema'

// PR detail: the composite GraphQL read (docs/github-integration.md), the primary read for the
// PR screen: PR + reviews + comments + checks, with every connection walked to its end. GraphQL has
// no ETag, so freshness is a TTL gate in sync_state (`pr:<repoId>:<number>`); the mirror tables are
// the cache. The mirror logic is shared with the batch route (`mirrorPr`). Files live in pr_files,
// owned by /files.
// Factory over this plugin's own database, not a module-scope router (docs/data-layer/plugin-databases.md § Plugin
// databases).
export const pullDetail = (db: PluginDatabase, emit: GithubEmit = NO_EMIT) =>
  new Hono<AppEnv>().get('/:owner/:repo/pulls/:number', async (c) => {
    const number = Number(c.req.param('number'))
    if (!Number.isInteger(number)) return respondError(c, 400, 'bad_number')
    const result = await readPullDetail(
      db,
      {
        token: await githubToken(c),
        userId: ownerId(c),
        owner: c.req.param('owner'),
        repo: c.req.param('repo'),
        number,
        force: c.req.query('force') === 'true',
      },
      emit,
    )
    if (!result.ok) return respondError(c, result.failure.status, result.failure.error, result.failure.detail)
    return c.json(result.value)
  })

// The composite read itself, for this route and for any other reader of one pull request, such as the
// browser handoff. `repoId` is the mirror's row, from which a caller reads GitHub's own spelling.
export async function readPullDetail(
  db: PluginDatabase,
  request: { token: string; userId: string; owner: string; repo: string; number: number; force?: boolean },
  emit: GithubEmit = NO_EMIT,
) {
  const { token, userId, owner, repo, number } = request
  const resolved = await resolveRepoForUser(db, token, userId, owner, repo, { emit })
  if (!resolved.ok) return resolved
  const repoId = resolved.value.repoId
  const key = { userId, repoId, number }
  const resource = prResource(repoId, number)

  // Cold when never fetched (no sync row) or the composite has no pull yet, both meaning "nothing
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

  const refresh = () => refreshPullDetail(token, db, { userId, repoId, owner, repo, number }, emit)

  return serveThenRevalidate({
    resource,
    userId,
    ttlMs: PULLS_STALE_AFTER_MS,
    force: request.force === true,
    read,
    refresh,
  })
}
