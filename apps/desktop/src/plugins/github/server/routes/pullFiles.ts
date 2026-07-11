import { and, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { Hono } from 'hono'
import type { PullFile, PullFilesPatchRequest } from '../../../../core/shared/api'
import { getDb, schema } from '../../../../core/server/db'
import { filesResource } from '../../../../core/server/db/resourceKeys'
import type { AppEnv } from '../../../../core/server/middleware/auth'
import { getUser } from '../../../../core/server/middleware/requireUser'
import { respondError } from '../../../../core/server/respond'
import { type Cached, type RefreshResult, serveThenRevalidate } from '../../../../core/server/sync/engine'
import { PULLS_STALE_AFTER_MS } from '../../../../core/server/sync/policy'
import { fetchFiles, mirrorFiles, readFiles } from './prMirror'
import { resolveRepoForUser } from './repoMirror'

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
  const user = getUser(c)

  const db = getDb(c.env)
  const userId = user.login
  const owner = c.req.param('owner')
  const repo = c.req.param('repo')
  const number = Number(c.req.param('number'))
  if (!owner || !repo) return respondError(c, 404, 'repo_not_found')
  if (!Number.isInteger(number)) return respondError(c, 400, 'bad_number')

  const resolved = await resolveRepoForUser(db, user.token, userId, owner, repo)
  if (!resolved.ok) return respondError(c, resolved.failure.status, resolved.failure.error)
  const { repoId } = resolved.value
  const key = { userId, repoId, number }
  const paths = options.paths?.length ? options.paths : undefined
  const includePatches = !options.summaryOnly || !!paths

  const resource = filesResource(repoId, number)
  const readCached = async () => orderedByRequest(await readFiles(c.env, db, key, { includePatches, paths }), paths)

  // Cold only when the files were never fetched (no sync row); a PR with zero changed files still
  // has a sync row → serves `{ data: [], fetchedAt }`.
  const read = async (): Promise<Cached<PullFile[]> | null> => {
    const [sync] = await db
      .select()
      .from(schema.syncState)
      .where(and(eq(schema.syncState.userId, userId), eq(schema.syncState.resource, resource)))
    if (!sync) return null
    return { data: await readCached(), fetchedAt: sync.fetchedAt }
  }

  const refresh = async (): Promise<RefreshResult> => {
    const files = await fetchFiles(user.token, owner, repo, number)
    if (!files.ok) return files
    await mirrorFiles(c.env.BLOBS, db, key, files.value)
    return { ok: true }
  }

  const result = await serveThenRevalidate({
    resource,
    userId,
    ttlMs: PULLS_STALE_AFTER_MS,
    force: c.req.query('force') === 'true',
    read,
    refresh,
  })
  if (!result.ok) return respondError(c, result.failure.status, result.failure.error, result.failure.detail)
  return c.json(result.value)
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
  if (!paths) return respondError(c, 400, 'bad_paths')
  if (paths.length > MAX_PATCH_PATHS) return respondError(c, 400, 'too_many_paths')
  if (paths.length === 0) return c.json([])
  return handleFilesRead(c, { paths })
})
