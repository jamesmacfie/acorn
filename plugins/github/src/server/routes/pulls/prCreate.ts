import { Hono } from 'hono'
import { z } from 'zod'
import { gh, ghError, ghGraphQL, ghGraphQLResult } from '../../githubApi'
import type { Branch, Compare } from '../../../shared/api'
import { type AppEnv, ownerId, type PluginDatabase, respondError } from '@acorn/plugin-api/node'
import { githubToken } from '../../githubToken'
import { createPullRequest } from '../../createPull'
import { type GithubEmit, NO_EMIT } from '../../events'

// Open-a-PR support: branch list + base..head compare (both read-only proxies, no local mirror,
// branches/compare change too often and are cheap to fetch) and the create POST. Creating busts
// the open-pulls sync_state so the list refetches the new PR; the PR detail mirror fills on
// navigation via the existing pullDetail route.

// `base` and `head` become branch names in a GitHub API body, so they are required and non-empty
// here rather than checked afterwards. `title` keeps its own trim check below, which is what
// rejects a title of spaces.
const createBody = z.object({
  title: z.string(),
  body: z.string().optional(),
  base: z.string().min(1),
  head: z.string().min(1),
  draft: z.boolean().optional(),
})

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

// Factory over this plugin's own database, not a module-scope router (docs/data-layer.md § Plugin
// databases).
export const prCreate = (db: PluginDatabase, emit: GithubEmit = NO_EMIT) => new Hono<AppEnv>()
  .get('/:owner/:repo/branches', async (c) => {
    ownerId(c) // gate on auth; the credential itself comes from the stored integration
    const token = await githubToken(c)
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
      const res = await ghGraphQL(token, query, { owner, repo, after })
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
    ownerId(c) // gate on auth; the credential itself comes from the stored integration
    const token = await githubToken(c)
    const owner = c.req.param('owner')
    const repo = c.req.param('repo')
    const base = c.req.query('base')
    const head = c.req.query('head')
    if (!base || !head) return respondError(c, 400, 'bad_request')
    const res = await gh(token, `/repos/${owner}/${repo}/compare/${base}...${head}?per_page=100`)
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
  // Create the PR. 422 (PR exists / no commits / bad branch) carries GitHub's message, so surface it
  // verbatim instead of letting ghError flatten it to github_unavailable.
  .post('/:owner/:repo/pulls', async (c) => {
    const uid = ownerId(c)
    const owner = c.req.param('owner')
    const repo = c.req.param('repo')
    const parsed = createBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    const { title, body, base, head, draft } = parsed.data
    if (!title.trim()) return respondError(c, 400, 'bad_request')
    // Resolved after validation: a request we are about to reject should not cost a credential read.
    const token = await githubToken(c)
    const result = await createPullRequest(token, db, uid, owner, repo, { title, body, base, head, draft }, emit)
    return result.ok
      ? c.json({ number: result.number })
      : respondError(c, result.failure.status, result.failure.error, result.failure.detail)
  })
