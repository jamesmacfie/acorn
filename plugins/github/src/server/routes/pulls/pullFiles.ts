import { and, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { z } from 'zod'
import type { PullFilesPatchRequest, PullFilesResponse } from '../../../shared/api'
import { filesResource } from '../../resourceKeys'
import { type AppEnv, type Cached, ownerId, type PluginDatabase, respondError, serveThenRevalidate } from '@acorn/plugin-api/node'
import { PULLS_STALE_AFTER_MS } from '../../syncPolicy'
import { filesCompleteness, readFiles } from '../mirror/prMirror'
import { refreshPullFiles } from './pullRefresh'
import { resolveRepoForUser } from '../mirror/repoMirror'
import { githubToken } from '../../githubToken'
import { syncState } from '../../../node/schema'
import { type GithubEmit, NO_EMIT } from '../../events'

const MAX_PATCH_PATHS = 20

const orderedByRequest = <T extends { path: string }>(files: T[], paths: string[] | undefined) => {
  if (!paths) return files
  const byPath = new Map(files.map((file) => [file.path, file]))
  return paths.flatMap((path) => {
    const file = byPath.get(path)
    return file ? [file] : []
  })
}

// Shape first, then the de-duplication the caller wants. The schema answers "is this a list of
// non-empty strings"; `uniqueStringPaths` answers "in what order, with duplicates dropped", which is
// not a shape question.
const patchBody = z.object({ paths: z.array(z.string().min(1)) }) satisfies z.ZodType<PullFilesPatchRequest>

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

const handleFilesRead = async (
  db: PluginDatabase,
  c: Context<AppEnv>,
  emit: GithubEmit,
  options: { summaryOnly?: boolean; paths?: string[]; lookup?: boolean } = {},
) => {
  const uid = ownerId(c)
  const token = await githubToken(c)

  const userId = uid
  const owner = c.req.param('owner')
  const repo = c.req.param('repo')
  const number = Number(c.req.param('number'))
  if (!owner || !repo) return respondError(c, 404, 'repo_not_found')
  if (!Number.isInteger(number)) return respondError(c, 400, 'bad_number')

  const resolved = await resolveRepoForUser(db, token, userId, owner, repo, { emit })
  if (!resolved.ok) return respondError(c, resolved.failure.status, resolved.failure.error)
  const { repoId } = resolved.value
  const key = { userId, repoId, number }
  const paths = options.paths?.length ? options.paths : undefined
  const includePatches = !options.summaryOnly || !!paths

  const resource = filesResource(repoId, number)

  // Cold when the files were never fetched (no sync row); a PR with zero changed files still has a
  // sync row and serves an empty list. Also cold when an available patch's body is missing from
  // BLOBS: that is a broken cache, so the read blocks on a refresh that rewrites it rather than
  // serving the file as if it had no diff.
  const read = async (): Promise<Cached<PullFilesResponse> | null> => {
    const [sync] = await db
      .select()
      .from(syncState)
      .where(and(eq(syncState.userId, userId), eq(syncState.resource, resource)))
    if (!sync) return null
    const files = await readFiles(c.env.BLOBS, db, key, { includePatches, paths })
    if (!files.ok) return null
    return { data: { files: orderedByRequest(files.files, paths), completeness: filesCompleteness(sync) }, fetchedAt: sync.fetchedAt }
  }

  const refresh = () => refreshPullFiles(token, db, c.env.BLOBS, { userId, repoId, owner, repo, number })

  const result = await serveThenRevalidate({
    resource,
    userId,
    ttlMs: PULLS_STALE_AFTER_MS,
    force: c.req.query('force') === 'true',
    read,
    refresh,
  })
  if (!result.ok) return respondError(c, result.failure.status, result.failure.error, result.failure.detail)
  // The patches POST is a lookup by path, so it answers with the files alone.
  return c.json(options.lookup ? result.value.files : result.value)
}

// PR changed-files + patches. REST /pulls/{n}/files is the single writer of pr_files (it carries
// path/status/+/−/sha/patch in one call, richer than the GraphQL composite, which dropped files).
// Mirror logic is shared with the batch route, see prMirror.ts.
//
// GET answers with PullFilesResponse: the files in provider order and whether that is all of them.
// `?path=` narrows it to one file. The patches POST answers with the requested files alone, in
// request order; a path the pull does not have is absent, while a file GitHub sent no patch for is
// present with `patchState: 'unavailable'`.
// Factory over this plugin's own database, not a module-scope router (docs/data-layer.md § Plugin
// databases).
export const pullFiles = (db: PluginDatabase, emit: GithubEmit = NO_EMIT) => new Hono<AppEnv>().get('/:owner/:repo/pulls/:number/files', async (c) => {
  const path = c.req.query('path')
  const summaryOnly = c.req.query('summary') === '1' && !path
  return handleFilesRead(db, c, emit, { summaryOnly, paths: path ? [path] : undefined })
}).post('/:owner/:repo/pulls/:number/files/patches', async (c) => {
  const parsed = patchBody.safeParse(await c.req.json().catch(() => null))
  const paths = parsed.success ? uniqueStringPaths(parsed.data.paths) : null
  if (!paths) return respondError(c, 400, 'bad_paths')
  if (paths.length > MAX_PATCH_PATHS) return respondError(c, 400, 'too_many_paths')
  if (paths.length === 0) return c.json([])
  return handleFilesRead(db, c, emit, { paths, lookup: true })
})
