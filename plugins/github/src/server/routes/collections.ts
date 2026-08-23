import { and, desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { type AppEnv, ownerId, type PluginDatabase, respondError } from '@acorn/plugin-api/node'
import { MAX_COLLECTION_ROWS, type PluginCollectionResponse } from '@acorn/protocol/collections.ts'
import { ghGraphQL, ghGraphQLResult } from '..'
import { githubToken } from '../githubToken'
import {
  parsePullInvolvement,
  type PullCollectionSource,
  PULLS_COLLECTION_ID,
  pullsCollectionPage,
  pullsSearchQuery,
} from '../../contract/collections'
import { pullRequests, repos } from '../../node/schema'
import { repoMatches } from '../repoMatch'

// The collection half of the PR mirror (@acorn/protocol/collections.ts). One route, one question:
// the open pull requests this user has mirrored, across every repository, newest first.
//
// Reads the mirror and never drives it. Freshness belongs to the repo-scoped list route a person is
// waiting on (docs/dashboards.md § Freshness), so a panel shows rows as old as the last time that
// repo's PR list was opened. The upgrade is one cross-repo refresh through the engine
// (`resource: 'pulls:mine'`, one search query, one TTL) rather than one revalidate per repository.
//
// The `involves` param spends a GitHub request the mirror read does not, because a mirror-side answer
// to "asked me to review" would be wrong rather than stale (docs/github-integration.md § Reads and
// writes). It is one search whatever the repository count.
//
// The selection set is the mirror's list columns and no more. PR_FRAGMENT exists for a PR someone has
// open in front of them, and pulling reviews, threads, and commits for fifty unclicked rows would
// spend rate limit on columns this collection does not declare.
const SEARCH_QUERY = `
query PullsInvolvingMe($q: String!, $first: Int!) {
  search(query: $q, type: ISSUE, first: $first) {
    nodes {
      ... on PullRequest {
        number title isDraft updatedAt mergeable mergeStateStatus
        author { login }
        autoMergeRequest { mergeMethod }
        repository { name owner { login } }
      }
    }
  }
}`

// GitHub caps a search page at 100 whatever we ask for. MAX_COLLECTION_ROWS is five times higher.
const SEARCH_PAGE = 100

type GqlSearchPull = {
  number?: number
  title?: string
  isDraft?: boolean
  updatedAt?: string | null
  mergeable?: string | null
  mergeStateStatus?: string | null
  author?: { login: string } | null
  autoMergeRequest?: { mergeMethod: string } | null
  repository?: { name: string; owner: { login: string } } | null
}

/** Search nodes to the same source shape the mirror select produces. `type: ISSUE` can return issues
 *  as well as pull requests, and an inline fragment that does not match answers `{}`, so a node with
 *  no number is dropped rather than rendered as PR #NaN. */
const toSource = (nodes: readonly GqlSearchPull[]): PullCollectionSource[] =>
  nodes.flatMap((node) =>
    node.number && node.repository
      ? [{
          owner: node.repository.owner.login,
          repo: node.repository.name,
          number: node.number,
          title: node.title ?? '',
          draft: node.isDraft ?? false,
          author: node.author?.login ?? null,
          updatedAt: node.updatedAt ? Date.parse(node.updatedAt) : null,
          mergeable: node.mergeable ?? null,
          mergeStateStatus: node.mergeStateStatus ?? null,
          autoMergeEnabled: node.autoMergeRequest != null,
        }]
      : [],
  )

export const collections = (db: PluginDatabase) => new Hono<AppEnv>().get(`/${PULLS_COLLECTION_ID}`, async (c) => {
  const userId = ownerId(c)
  // Declared params. Plugin-owned meaning, passed through opaquely by the host: `repo` is `owner/name`,
  // and anything that does not look like one simply matches nothing.
  const repo = c.req.query('repo') ?? ''
  const [owner, name] = repo.split('/')
  const involvements = parsePullInvolvement(c.req.query('involves') ?? '')

  // "involving me" leaves the mirror entirely (contract/collections.ts § involvement). An
  // unrecognised value falls through to the mirror read rather than erroring, because a param is
  // opaque to the host and a stale saved panel can arrive here.
  if (involvements.length) {
    const token = await githubToken(c)
    // One search each, in parallel, unioned: GitHub's qualifiers only AND, so "assigned to me or
    // waiting on my review" is two questions. Three involvements, so three calls per poll at most.
    const results = await Promise.all(involvements.map((involvement) =>
      ghGraphQL(token, SEARCH_QUERY, { q: pullsSearchQuery(involvement, repo), first: SEARCH_PAGE })
        .then((res) => ghGraphQLResult<{ search?: { nodes?: GqlSearchPull[] } }>(res)),
    ))
    // Any failure fails the panel. A partial union under-reports what is waiting on you, which is
    // the one wrong answer this collection must not give.
    const failed = results.find((result) => !result.ok)
    if (failed && !failed.ok) {
      return failed.kind === 'http'
        ? respondError(c, failed.failure.status, failed.failure.error)
        : respondError(c, 502, 'github_unavailable', failed.messages)
    }
    // A PR you were assigned and asked to review is one row. Deduped here rather than left to the
    // host, because a collection answering the same record twice is wrong whoever reads it.
    const found = new Map<string, PullCollectionSource>()
    for (const result of results) {
      if (!result.ok) continue
      for (const row of toSource(result.data.search?.nodes ?? [])) {
        found.set(`${row.owner}/${row.repo}#${row.number}`, row)
      }
    }
    const union = [...found.values()].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    return c.json(pullsCollectionPage(union) satisfies PluginCollectionResponse)
  }

  const rows = await db
    .select({
      number: pullRequests.number,
      title: pullRequests.title,
      draft: pullRequests.draft,
      author: pullRequests.author,
      updatedAt: pullRequests.updatedAt,
      mergeable: pullRequests.mergeable,
      mergeStateStatus: pullRequests.mergeStateStatus,
      autoMergeEnabled: pullRequests.autoMergeEnabled,
      owner: repos.owner,
      repo: repos.name,
    })
    .from(pullRequests)
    .innerJoin(repos, and(eq(repos.userId, pullRequests.userId), eq(repos.id, pullRequests.repoId)))
    .where(and(
      eq(pullRequests.userId, userId),
      eq(pullRequests.state, 'open'),
      ...(owner && name ? [repoMatches(owner, name)] : []),
    ))
    .orderBy(desc(pullRequests.updatedAt))
    .limit(MAX_COLLECTION_ROWS)

  // The projection lives in contract/ beside the schema it fills, so the column a row writes and the
  // column the client declares cannot drift (contract/collections.ts).
  return c.json(pullsCollectionPage(rows) satisfies PluginCollectionResponse)
})
