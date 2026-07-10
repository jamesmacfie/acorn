import { and, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { getDb, schema } from '../../../../core/server/db'
import { prResource } from '../../../../core/server/db/resourceKeys'
import type { AppEnv, SessionUser } from '../../../../core/server/middleware/auth'
import { getUser } from '../../../../core/server/middleware/requireUser'

type Db = ReturnType<typeof getDb>
type PrFailure = { error: 'bad_number'; status: 400 } | { error: 'repo_not_found'; status: 404 }
type PrContext = {
  user: SessionUser
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
export async function resolvePr(c: Context<AppEnv>): Promise<PrFailure | PrContext> {
  const user = getUser(c) // auth is enforced by requireUser upstream
  const db = getDb(c.env)
  const owner = c.req.param('owner')!
  const repo = c.req.param('repo')!
  const number = Number(c.req.param('number'))
  if (!Number.isInteger(number)) return { error: 'bad_number' as const, status: 400 as const }
  const [repoRow] = await db
    .select({ id: schema.repos.id })
    .from(schema.repos)
    .where(and(eq(schema.repos.userId, user.login), eq(schema.repos.owner, owner), eq(schema.repos.name, repo)))
  if (!repoRow) return { error: 'repo_not_found' as const, status: 404 as const }
  const [pr] = await db
    .select({ nodeId: schema.pullRequests.nodeId, headSha: schema.pullRequests.headSha })
    .from(schema.pullRequests)
    .where(
      and(
        eq(schema.pullRequests.userId, user.login),
        eq(schema.pullRequests.repoId, repoRow.id),
        eq(schema.pullRequests.number, number),
      ),
    )
  return { user, db, owner, repo, number, repoId: repoRow.id, nodeId: pr?.nodeId ?? null, headSha: pr?.headSha ?? null }
}

export const bustPrSync = (db: ReturnType<typeof getDb>, userId: string, repoId: number, number: number) =>
  db
    .delete(schema.syncState)
    .where(and(eq(schema.syncState.userId, userId), eq(schema.syncState.resource, prResource(repoId, number))))

export const setPrState = (db: ReturnType<typeof getDb>, userId: string, repoId: number, number: number, state: string) =>
  db
    .update(schema.pullRequests)
    .set({ state })
    .where(and(eq(schema.pullRequests.userId, userId), eq(schema.pullRequests.repoId, repoId), eq(schema.pullRequests.number, number)))
