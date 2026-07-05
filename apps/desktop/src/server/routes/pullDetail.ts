import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { trackBackgroundRefresh } from '../background'
import { getDb, schema } from '../db'
import { prResource } from '../db/resourceKeys'
import { ghGraphQL, ghGraphQLResult } from '../github'
import type { AppEnv } from '../middleware/auth'
import { mirrorPr, PR_FRAGMENT, readComposite, STALE_AFTER_MS, type GqlPull } from './prMirror'
import { resolveRepoForUser, type RouteResult } from './repoMirror'

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
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthenticated' }, 401)

  const db = getDb(c.env)
  const userId = user.login
  const owner = c.req.param('owner')
  const repo = c.req.param('repo')
  const number = Number(c.req.param('number'))
  if (!Number.isInteger(number)) return c.json({ error: 'bad_number' }, 400)

  const resolved = await resolveRepoForUser(db, user.token, userId, owner, repo)
  if (!resolved.ok) return c.json({ error: resolved.failure.error }, resolved.failure.status)
  const repoId = resolved.value.repoId
  const key = { userId, repoId, number }

  const [sync] = await db
    .select()
    .from(schema.syncState)
    .where(and(eq(schema.syncState.userId, userId), eq(schema.syncState.resource, prResource(repoId, number))))

  // Fresh → serve the mirror, no GraphQL call.
  if (sync && sync.fetchedAt + STALE_AFTER_MS > Date.now()) return c.json(await readComposite(db, key))

  const refresh = async (): Promise<RouteResult<Awaited<ReturnType<typeof readComposite>>>> => {
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
    return { ok: true, value: await readComposite(db, key) }
  }

  if (sync) {
    const cached = await readComposite(db, key)
    if (cached.pull) {
      trackBackgroundRefresh(`pull:${owner}/${repo}#${number}`, refresh())
      return c.json(cached)
    }
  }

  const refreshed = await refresh()
  if (!refreshed.ok) {
    const { error, status, detail } = refreshed.failure
    return c.json(detail ? { error, detail } : { error }, status)
  }
  return c.json(refreshed.value)
})
