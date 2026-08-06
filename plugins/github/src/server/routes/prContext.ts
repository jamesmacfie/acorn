import { and, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { prResource } from '../resourceKeys'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import { ownerId } from '@acorn/node-core/server/middleware/requireUser.ts'
import { githubToken } from '../githubToken'
import { pullRequests, repos, syncState } from '../../node/schema'
import type { PluginDatabase } from '@acorn/node-core/main/pluginStorage.ts'

// The write paths reach the mirror through the handle resolvePr was given, which is what keeps prActions
// and friends from needing one of their own.
type Db = PluginDatabase
type PrFailure = { error: 'bad_number'; status: 400 } | { error: 'repo_not_found'; status: 404 }
type PrContext = {
  // The two things every write path actually needs, instead of a whole SessionUser: the GitHub
  // credential (now a stored integration, not a field on the principal) and the row-ownership scope.
  // Splitting them is what let all 14 `r.user.token` reads in prActions.ts move at once.
  token: string
  userId: string
  db: Db
  owner: string
  repo: string
  number: number
  repoId: number
  nodeId: string | null
  headSha: string | null
}

// Write-path PR resolution — MIRROR-ONLY, deliberately stricter than the read path's
// resolveRepoForUser (repoMirror.ts), which falls through to a live GitHub fetch on a miss.
// Every PR write targets a PR the user is looking at, so its repo (and usually the PR row) is
// already mirrored; a miss here means the client skipped the read path, and 404 is the honest
// answer rather than lazily mirroring on a write.
export async function resolvePr(db: PluginDatabase, c: Context<AppEnv>): Promise<PrFailure | PrContext> {
  const userId = ownerId(c) // auth is enforced by requireUser upstream
  const owner = c.req.param('owner')!
  const repo = c.req.param('repo')!
  const number = Number(c.req.param('number'))
  if (!Number.isInteger(number)) return { error: 'bad_number' as const, status: 400 as const }
  const [repoRow] = await db
    .select({ id: repos.id })
    .from(repos)
    .where(and(eq(repos.userId, userId), eq(repos.owner, owner), eq(repos.name, repo)))
  if (!repoRow) return { error: 'repo_not_found' as const, status: 404 as const }
  const [pr] = await db
    .select({ nodeId: pullRequests.nodeId, headSha: pullRequests.headSha })
    .from(pullRequests)
    .where(
      and(
        eq(pullRequests.userId, userId),
        eq(pullRequests.repoId, repoRow.id),
        eq(pullRequests.number, number),
      ),
    )
  return {
    token: await githubToken(c),
    userId,
    db,
    owner,
    repo,
    number,
    repoId: repoRow.id,
    nodeId: pr?.nodeId ?? null,
    headSha: pr?.headSha ?? null,
  }
}

export const bustPrSync = (db: PluginDatabase, userId: string, repoId: number, number: number) =>
  db
    .delete(syncState)
    .where(and(eq(syncState.userId, userId), eq(syncState.resource, prResource(repoId, number))))

export const setPrState = (db: PluginDatabase, userId: string, repoId: number, number: number, state: string) =>
  db
    .update(pullRequests)
    .set({ state })
    .where(and(eq(pullRequests.userId, userId), eq(pullRequests.repoId, repoId), eq(pullRequests.number, number)))
