import { and, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { Hono } from 'hono'
import type { PullFilesPatchRequest } from '../../shared/api'
import { getDb, schema } from '../db'
import { filesResource } from '../db/resourceKeys'
import { ghError } from '../github'
import type { AppEnv } from '../middleware/auth'
import { fetchFiles, mirrorFiles, readFiles, STALE_AFTER_MS } from './prMirror'
import { resolveRepoForUser, waitUntilLogged, type RouteResult } from './repoMirror'

const MAX_PATCH_PATHS = 20

const orderedByRequest = <T extends { path: string }>(files: T[], paths: string[] | undefined) => {
  if (!paths) return files
  const byPath = new Map(files.map((file) => [file.path, file]))
  return paths.flatMap((path) => {
    const file = byPath.get(path)
    return file ? [file] : []
  })
}

const uniqueStringPaths = (paths: unknown): string[] | null => {
  if (!Array.isArray(paths)) return null
  const out: string[] = []
  const seen = new Set<string>()
  for (const path of paths) {
    if (typeof path !== 'string' || !path) return null
    if (seen.has(path)) continue
    seen.add(path)
    out.push(path)
  }
  return out
}

const handleFilesRead = async (c: Context<AppEnv>, options: { summaryOnly?: boolean; paths?: string[] } = {}) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthenticated' }, 401)

  const db = getDb(c.env)
  const userId = user.login
  const owner = c.req.param('owner')
  const repo = c.req.param('repo')
  const number = Number(c.req.param('number'))
  if (!owner || !repo) return c.json({ error: 'repo_not_found' }, 404)
  if (!Number.isInteger(number)) return c.json({ error: 'bad_number' }, 400)

  const resolved = await resolveRepoForUser(db, user.token, userId, owner, repo)
  if (!resolved.ok) return c.json({ error: resolved.failure.error }, resolved.failure.status)
  const { repoId } = resolved.value
  const key = { userId, repoId, number }
  const paths = options.paths?.length ? options.paths : undefined
  const includePatches = !options.summaryOnly || !!paths

  const [sync] = await db
    .select()
    .from(schema.syncState)
    .where(and(eq(schema.syncState.userId, userId), eq(schema.syncState.resource, filesResource(repoId, number))))
  const readCached = async () => orderedByRequest(await readFiles(c.env, db, key, { includePatches, paths }), paths)
  if (sync && sync.fetchedAt + STALE_AFTER_MS > Date.now()) return c.json(await readCached())

  const refresh = async (): Promise<RouteResult<Awaited<ReturnType<typeof readCached>>>> => {
    const { res, body } = await fetchFiles(user.token, owner, repo, number)
    const err = ghError(res)
    if (err) return { ok: false, failure: err }
    await mirrorFiles(c.env, db, key, body ?? [])
    return { ok: true, value: await readCached() }
  }

  if (sync) {
    const cached = await readCached()
    waitUntilLogged(`files:${owner}/${repo}#${number}`, refresh())
    return c.json(cached)
  }

  const refreshed = await refresh()
  if (!refreshed.ok) return c.json({ error: refreshed.failure.error }, refreshed.failure.status)
  return c.json(refreshed.value)
}

// PR changed-files + patches. REST /pulls/{n}/files is the single writer of pr_files (it carries
// path/status/+/−/sha/patch in one call — richer than the GraphQL composite, which dropped files).
// Mirror logic is shared with the batch route — see prMirror.ts.
export const pullFiles = new Hono<AppEnv>().get('/:owner/:repo/pulls/:number/files', async (c) => {
  const path = c.req.query('path')
  const summaryOnly = c.req.query('summary') === '1' && !path
  return handleFilesRead(c, { summaryOnly, paths: path ? [path] : undefined })
}).post('/:owner/:repo/pulls/:number/files/patches', async (c) => {
  const body = (await c.req.json().catch(() => null)) as PullFilesPatchRequest | null
  const paths = uniqueStringPaths(body?.paths)
  if (!paths) return c.json({ error: 'bad_paths' }, 400)
  if (paths.length > MAX_PATCH_PATHS) return c.json({ error: 'too_many_paths' }, 400)
  if (paths.length === 0) return c.json([])
  return handleFilesRead(c, { paths })
})
