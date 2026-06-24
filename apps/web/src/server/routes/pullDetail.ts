import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb, schema } from '../db'
import { prResource } from '../db/resourceKeys'
import { ghError, ghGraphQL } from '../github'
import type { AppEnv } from '../middleware/auth'
import { mirrorPr, PR_FRAGMENT, readComposite, STALE_AFTER_MS, type GqlPull } from './prMirror'

// PR detail — the composite GraphQL read (docs/github-api.md "primary read for the PR screen").
// PR + reviews + comments + checks in one round-trip. GraphQL has no ETag, so freshness is a TTL
// gate in sync_state (`pr:<repoId>:<number>`); the mirror tables are the cache. The mirror logic
// is shared with the batch route — see prMirror.ts. Files live in pr_files, owned by /files.
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

  const [repoRow] = await db
    .select({ id: schema.repos.id })
    .from(schema.repos)
    .where(and(eq(schema.repos.userId, userId), eq(schema.repos.owner, owner), eq(schema.repos.name, repo)))
  if (!repoRow) return c.json({ error: 'repo_not_found' }, 404)
  const repoId = repoRow.id
  const key = { userId, repoId, number }

  const [sync] = await db
    .select()
    .from(schema.syncState)
    .where(and(eq(schema.syncState.userId, userId), eq(schema.syncState.resource, prResource(repoId, number))))

  // Fresh → serve the mirror, no GraphQL call.
  if (sync && sync.fetchedAt + STALE_AFTER_MS > Date.now()) return c.json(await readComposite(db, key))

  const res = await ghGraphQL(user.token, COMPOSITE_QUERY, { owner, repo, number })
  const err = ghError(res)
  if (err) return c.json({ error: err.error }, err.status)
  const json = (await res.json()) as {
    data?: { repository?: { pullRequest?: GqlPull | null } }
    errors?: { message: string; type?: string }[]
  }
  // A GraphQL error (200 + errors, data null) must not masquerade as a 404 — surface it.
  if (json.errors?.length) {
    console.error('pullDetail GraphQL errors', JSON.stringify(json.errors))
    return c.json({ error: 'graphql', detail: json.errors.map((e) => e.message) }, 502)
  }
  const pr = json.data?.repository?.pullRequest
  if (!pr) return c.json({ error: 'pull_not_found' }, 404)

  await mirrorPr(db, key, pr, Date.now())
  return c.json(await readComposite(db, key))
})
