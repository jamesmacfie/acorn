import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import type { PullDetail } from '../../shared/api'
import { getDb, schema } from '../db'
import { prResource } from '../db/resourceKeys'
import { ghGraphQL, ghGraphQLResult } from '../github'
import type { AppEnv } from '../middleware/auth'
import { getUser } from '../middleware/requireUser'
import { respondError } from '../respond'
import { type Cached, type RefreshResult, serveThenRevalidate } from '../sync/engine'
import { PULLS_STALE_AFTER_MS } from '../sync/policy'
import { mirrorPr, PR_FRAGMENT, readComposite, type GqlPull } from './prMirror'
import { resolveRepoForUser } from './repoMirror'

// PR detail — the composite GraphQL read (docs/github-integration.md), the primary read for the
// PR screen: PR + reviews + comments + checks in one round-trip. GraphQL has no ETag, so
// freshness is a TTL gate in sync_state (`pr:<repoId>:<number>`); the mirror tables are the
// cache. The mirror logic is shared with the batch route — see prMirror.ts. Files live in
// pr_files, owned by /files.
const COMPOSITE_QUERY = `
query PR($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) { ...PrFields }
  }
}${PR_FRAGMENT}`

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

  const refresh = async (): Promise<RefreshResult> => {
    const res = await ghGraphQL(user.token, COMPOSITE_QUERY, { owner, repo, number })
    const result = await ghGraphQLResult<{ repository?: { pullRequest?: GqlPull | null } }>(res)
    if (!result.ok) {
      // A GraphQL error (200 + errors, data null) must not masquerade as a 404 — surface it.
      if (result.kind === 'graphql') {
        console.error('pullDetail GraphQL errors', JSON.stringify(result.messages))
        return { ok: false, failure: { error: 'graphql', status: 502, detail: result.messages } }
      }
      return { ok: false, failure: result.failure }
    }
    const pr = result.data?.repository?.pullRequest
    if (!pr) return { ok: false, failure: { error: 'pull_not_found', status: 404 } }

    await mirrorPr(db, key, pr, Date.now())
    return { ok: true }
  }

  const result = await serveThenRevalidate({ resource, userId, ttlMs: PULLS_STALE_AFTER_MS, read, refresh })
  if (!result.ok) return respondError(c, result.failure.status, result.failure.error, result.failure.detail)
  return c.json(result.value)
})
