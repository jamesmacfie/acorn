import { and, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { Hono } from 'hono'
import type { PullDiffResponse, PullFilesResponse } from '../../../shared/api'
import { filesResource } from '../../resourceKeys'
import { type AppEnv, type Cached, ownerId, type PluginDatabase, respondError, serveThenRevalidate } from '@acorn/plugin-api/node'
import { PULLS_STALE_AFTER_MS } from '../../syncPolicy'
import { filesCompleteness, readFiles } from '../mirror/prMirror'
import { topologyOf } from '../mirror/prDocument'
import { refreshPullFiles } from './pullRefresh'
import { resolveRepoForUser } from '../mirror/repoMirror'
import { githubToken } from '../../githubToken'
import { syncState } from '../../../node/schema'
import { type GithubEmit, NO_EMIT } from '../../events'

const orderedByRequest = <T extends { path: string }>(files: T[], paths: string[] | undefined) => {
  if (!paths) return files
  const byPath = new Map(files.map((file) => [file.path, file]))
  return paths.flatMap((path) => {
    const file = byPath.get(path)
    return file ? [file] : []
  })
}

type FilesRead<T> = (sync: typeof syncState.$inferSelect, key: { userId: string; repoId: number; number: number }) => Promise<T | null>

// The files resource behind both the files route and the diff route: resolve the pull, then serve the
// mirror, refreshing it first when it is cold or stale. `read` answers null for a mirror that cannot
// serve, which the engine treats as cold.
const serveFiles = async <T,>(db: PluginDatabase, c: Context<AppEnv>, emit: GithubEmit, read: FilesRead<T>) => {
  const userId = ownerId(c)
  const token = await githubToken(c)
  const owner = c.req.param('owner')
  const repo = c.req.param('repo')
  const number = Number(c.req.param('number'))
  if (!owner || !repo) return respondError(c, 404, 'repo_not_found')
  if (!Number.isInteger(number)) return respondError(c, 400, 'bad_number')

  const resolved = await resolveRepoForUser(db, token, userId, owner, repo, { emit })
  if (!resolved.ok) return respondError(c, resolved.failure.status, resolved.failure.error)
  const { repoId } = resolved.value
  const key = { userId, repoId, number }
  const resource = filesResource(repoId, number)

  // Cold when the files were never fetched (no sync row); a PR with zero changed files still has a
  // sync row and serves an empty list.
  const cached = async (): Promise<Cached<T> | null> => {
    const [sync] = await db
      .select()
      .from(syncState)
      .where(and(eq(syncState.userId, userId), eq(syncState.resource, resource)))
    if (!sync) return null
    const data = await read(sync, key)
    return data == null ? null : { data, fetchedAt: sync.fetchedAt }
  }

  const result = await serveThenRevalidate({
    resource,
    userId,
    ttlMs: PULLS_STALE_AFTER_MS,
    force: c.req.query('force') === 'true',
    read: cached,
    refresh: () => refreshPullFiles(token, db, c.env.BLOBS, { userId, repoId, owner, repo, number }),
  })
  if (!result.ok) return respondError(c, result.failure.status, result.failure.error, result.failure.detail)
  return result.value
}

const handleFilesRead = async (
  db: PluginDatabase,
  c: Context<AppEnv>,
  emit: GithubEmit,
  options: { summaryOnly?: boolean; paths?: string[] } = {},
) => {
  const paths = options.paths?.length ? options.paths : undefined
  const includePatches = !options.summaryOnly || !!paths
  // Also cold when an available patch's body is missing from BLOBS: that is a broken cache, so the
  // read blocks on a refresh that rewrites it rather than serving the file as if it had no diff.
  const served = await serveFiles<PullFilesResponse>(db, c, emit, async (sync, key) => {
    const files = await readFiles(c.env.BLOBS, db, key, { includePatches, paths })
    return files.ok ? { files: orderedByRequest(files.files, paths), completeness: filesCompleteness(sync) } : null
  })
  return served instanceof Response ? served : c.json(served)
}

// PR changed-files + patches. REST /pulls/{n}/files is the single writer of pr_files (it carries
// path/status/+/−/sha/patch in one call, richer than the GraphQL composite, which dropped files).
// Mirror logic is shared with the batch route, see prMirror.ts.
//
// GET answers with PullFilesResponse: the files in provider order and whether that is all of them.
// `?path=` narrows it to one file. GET `/diff` answers with the same files as a segmented document
// (PullDiffResponse) for the diff viewer, whose segments come from ./diffDocument.ts. There is no
// batch patch read any more: the viewer reads segments, never whole patches.
// Factory over this plugin's own database, not a module-scope router (docs/data-layer/plugin-databases.md § Plugin
// databases).
export const pullFiles = (db: PluginDatabase, emit: GithubEmit = NO_EMIT) => new Hono<AppEnv>().get('/:owner/:repo/pulls/:number/files', async (c) => {
  const path = c.req.query('path')
  const summaryOnly = c.req.query('summary') === '1' && !path
  return handleFilesRead(db, c, emit, { summaryOnly, paths: path ? [path] : undefined })
}).get('/:owner/:repo/pulls/:number/diff', async (c) => {
  // The document: every file in provider order with its segment descriptors and no patch text. A
  // missing patch body is the same integrity failure the files read repairs, and repairs the same way.
  const served = await serveFiles<PullDiffResponse>(db, c, emit, async (sync, key) => {
    const files = await readFiles(c.env.BLOBS, db, key, { includePatches: false })
    if (!files.ok) return null
    const topology = await topologyOf(c.env.BLOBS, files.files)
    return topology.ok ? { document: topology.document, completeness: filesCompleteness(sync) } : null
  })
  return served instanceof Response ? served : c.json(served)
})
