import { and, desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { type AppEnv, ownerId, type PluginDatabase } from '@acorn/plugin-api/node'
import { MAX_COLLECTION_ROWS, type PluginCollectionResponse } from '@acorn/protocol/collections.ts'
import { PULLS_COLLECTION_ID, pullsCollectionPage } from '../../contract/collections'
import { pullRequests, repos } from '../../node/schema'

// The collection half of the PR mirror (@acorn/protocol/collections.ts). One route, one question: the
// open pull requests this user has mirrored, across every repository, newest first.
//
// It READS the mirror and never drives it, which is the one decision in this file worth arguing. The
// repo-scoped list route owns freshness — `serveThenRevalidate` at `PULLS_STALE_AFTER_MS`
// (server/routes/pulls.ts) — because it is looking at ONE repository the person is looking at too. A
// panel is the opposite shape: it polls on a timer, unattended, across every repo at once, and a
// revalidate here would multiply one dashboard by the user's repository count against a rate limit the
// whole plugin shares. So the mirror's freshness stays owned by the read that a person is waiting on,
// and this one serves whatever that read last wrote.
//
// No refresh of its own. The ceiling is a panel showing rows as old as the last time the PR
// list was opened for that repo. The upgrade, when a dashboard is somebody's home page rather than a
// second view of a list they already have open, is a single cross-repo refresh through the engine —
// `resource: 'pulls:mine'`, one GitHub search query, one TTL — not one revalidate per repository.
export const collections = (db: PluginDatabase) => new Hono<AppEnv>().get(`/${PULLS_COLLECTION_ID}`, async (c) => {
  const userId = ownerId(c)
  // The one declared param. Plugin-owned meaning, passed through opaquely by the host: here it is
  // `owner/name`, and anything that does not look like one simply matches nothing.
  const [owner, name] = (c.req.query('repo') ?? '').split('/')

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
      ...(owner && name ? [eq(repos.owner, owner), eq(repos.name, name)] : []),
    ))
    .orderBy(desc(pullRequests.updatedAt))
    .limit(MAX_COLLECTION_ROWS)

  // The projection lives in contract/ beside the schema it fills, so the column a row writes and the
  // column the client declares cannot drift (contract/collections.ts).
  return c.json(pullsCollectionPage(rows) satisfies PluginCollectionResponse)
})
