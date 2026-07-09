import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb, schema } from '../db'
import { pullsResource } from '../db/resourceKeys'
import { gh, ghError, ghGraphQL, ghGraphQLResult } from '../github'
import type { Branch, Compare } from '../../shared/api'
import type { AppEnv } from '../middleware/auth'
import { getUser } from '../middleware/requireUser'
import { respondError } from '../respond'

// Open-a-PR support: branch list + base..head compare (both read-only proxies, no local mirror —
// branches/compare change too often and are cheap to fetch) and the create POST. Creating busts
// the open-pulls sync_state so the list refetches the new PR; the PR detail mirror fills on
// navigation via the existing pullDetail route.

type GitHubCompareFile = {
  filename: string
  status: string
  additions: number
  deletions: number
  sha: string
  patch?: string
}
type GitHubCompare = {
  ahead_by: number
  files?: GitHubCompareFile[]
  commits?: { sha: string; commit: { message: string } }[]
}

export const prCreate = new Hono<AppEnv>()
  // Branch names for the head/base pickers, newest-first. GitHub can't sort branches by date
  // (RefOrderField.TAG_COMMIT_DATE only applies to refs/tags/ — on branches it falls back to
  // alphabetical), so page through the branch refs with each tip's committedDate, sort here, and
  // return the 100 most-recent. The client gets a small, relevant list to filter rather than every
  // branch. ponytail: scans up to 30 pages (3000 branches) — raise the cap if a repo overflows it.
  .get('/:owner/:repo/branches', async (c) => {
    const user = getUser(c)
    const owner = c.req.param('owner')
    const repo = c.req.param('repo')
    const query = `query($owner:String!,$repo:String!,$after:String){
      repository(owner:$owner,name:$repo){
        refs(refPrefix:"refs/heads/",first:100,after:$after,orderBy:{field:ALPHABETICAL,direction:ASC}){
          pageInfo{ hasNextPage endCursor }
          nodes{ name target{ ... on Commit { committedDate } } }
        }
      }
    }`
    const collected: { name: string; date: number }[] = []
    let after: string | null = null
    for (let page = 0; page < 30; page++) {
      const res = await ghGraphQL(user.token, query, { owner, repo, after })
      const result = await ghGraphQLResult<{
        repository?: {
          refs?: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null }
            nodes: { name: string; target: { committedDate?: string } | null }[]
          }
        }
      }>(res)
      if (!result.ok) {
        if (result.kind === 'graphql') return respondError(c, 502, 'github_unavailable')
        return respondError(c, result.failure.status, result.failure.error)
      }
      const refs = result.data?.repository?.refs
      if (!refs) break
      for (const n of refs.nodes)
        collected.push({ name: n.name, date: n.target?.committedDate ? Date.parse(n.target.committedDate) : 0 })
      if (!refs.pageInfo.hasNextPage || !refs.pageInfo.endCursor) break
      after = refs.pageInfo.endCursor
    }
    collected.sort((a, b) => b.date - a.date)
    return c.json(collected.slice(0, 100).map((b) => ({ name: b.name }) satisfies Branch))
  })
  // Compare base..head → diff preview (PullFile[]) + commits (for title prefill) + aheadBy.
  // Branch names with slashes go straight into the path (GitHub accepts them literally).
  .get('/:owner/:repo/compare', async (c) => {
    const user = getUser(c)
    const owner = c.req.param('owner')
    const repo = c.req.param('repo')
    const base = c.req.query('base')
    const head = c.req.query('head')
    if (!base || !head) return respondError(c, 400, 'bad_request')
    const res = await gh(user.token, `/repos/${owner}/${repo}/compare/${base}...${head}?per_page=100`)
    const err = ghError(res)
    if (err) return respondError(c, err.status, err.error)
    const data = (await res.json()) as GitHubCompare
    return c.json({
      aheadBy: data.ahead_by ?? 0,
      files: (data.files ?? []).map((f) => ({
        path: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        sha: f.sha,
        viewed: false,
        patch: f.patch ?? null,
      })),
      commits: (data.commits ?? []).map((c) => ({ sha: c.sha, message: c.commit.message })),
    } satisfies Compare)
  })
  // Create the PR. 422 (PR exists / no commits / bad branch) carries GitHub's message — surface it
  // verbatim instead of letting ghError flatten it to github_unavailable.
  .post('/:owner/:repo/pulls', async (c) => {
    const user = getUser(c)
    const owner = c.req.param('owner')
    const repo = c.req.param('repo')
    const { title, body, base, head, draft } = (await c.req.json().catch(() => ({}))) as {
      title?: string
      body?: string
      base?: string
      head?: string
      draft?: boolean
    }
    if (!title?.trim() || !base || !head) return respondError(c, 400, 'bad_request')
    const res = await gh(user.token, `/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.trim(), body: body ?? '', base, head, draft: !!draft }),
    })
    if (res.status === 422) {
      // GitHub's 422 prose (PR exists / no commits / bad branch) moves to `detail`; the machine
      // code is always `validation_failed` so the client branches on a stable value.
      const detail = (await res.json().catch(() => ({}))) as { message?: string; errors?: { message?: string }[] }
      const message = detail.errors?.[0]?.message ?? detail.message
      return respondError(c, 422, 'validation_failed', message ? [message] : undefined)
    }
    const err = ghError(res)
    if (err) return respondError(c, err.status, err.error)
    const created = (await res.json()) as { number: number }

    // Bust the open-PR list cache so it refetches with the new PR on navigation.
    const db = getDb(c.env)
    const [repoRow] = await db
      .select({ id: schema.repos.id })
      .from(schema.repos)
      .where(and(eq(schema.repos.userId, user.login), eq(schema.repos.owner, owner), eq(schema.repos.name, repo)))
    if (repoRow)
      await db
        .delete(schema.syncState)
        .where(and(eq(schema.syncState.userId, user.login), eq(schema.syncState.resource, pullsResource(repoRow.id, 'open'))))

    return c.json({ number: created.number })
  })
