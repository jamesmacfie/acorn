import { and, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { getDb, schema } from '../db'
import { prResource } from '../db/resourceKeys'
import type { AppEnv } from '../middleware/auth'

export async function resolvePr(c: Context<AppEnv>) {
  const user = c.get('user')
  if (!user) return { error: 'unauthenticated' as const, status: 401 as const }
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
