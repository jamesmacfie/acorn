import type { Context } from 'hono'
import { Hono } from 'hono'
import { z } from 'zod'
import { type AppEnv, ownerId, type PluginDatabase, respondError } from '@acorn/plugin-api/node'
import { MAX_DOCUMENT_FILES, MAX_SEGMENTS_PER_REQUEST, SEARCH_MAX_QUERY } from '@acorn/diff-document/document'
import type { DiffSearchBody, DiffSegmentsBody } from '../../../shared/api'
import { searchPatches, segmentsOf } from '../mirror/prDocument'
import { resolveRepoForUser } from '../mirror/repoMirror'
import { githubToken } from '../../githubToken'
import { type GithubEmit, NO_EMIT } from '../../events'

// The two reads a diff document makes after its topology: a batch of segments, and a page of search
// matches. Repository-level rather than per pull, because a segment is addressed by its patch's
// digest and a pull request and a compare preview both store their patches the same way
// (../mirror/prDocument.ts). Access is the repository's, resolved as the blob route resolves it.
//
// The digest is checked to be one this plugin could have written before it becomes part of a blob
// key, so a request cannot address any other kind of blob.

const patchKey = z.string().regex(/^sha256:[0-9a-f]{64}$/)
// Longer than any path a file system accepts, so not a file GitHub listed.
const path = z.string().min(1).max(4096)

const segmentsBody = z.object({
  requests: z.array(z.object({ path, patchKey, ordinal: z.number().int().min(0) })).min(1).max(MAX_SEGMENTS_PER_REQUEST),
}) satisfies z.ZodType<DiffSegmentsBody>

// The query is never logged or counted anywhere: it is a piece of somebody's source.
const searchBody = z.object({
  query: z.string().min(1).max(SEARCH_MAX_QUERY),
  caseSensitive: z.boolean(),
  cursor: z.string().max(64).nullable(),
  files: z.array(z.object({ path, patchKey })).max(MAX_DOCUMENT_FILES),
}) satisfies z.ZodType<DiffSearchBody>

const resolveRepo = async (db: PluginDatabase, c: Context<AppEnv>, emit: GithubEmit) => {
  const resolved = await resolveRepoForUser(db, await githubToken(c), ownerId(c), c.req.param('owner') ?? '', c.req.param('repo') ?? '', { emit })
  return resolved.ok ? null : respondError(c, resolved.failure.status, resolved.failure.error)
}

// Factory over this plugin's own database, not a module-scope router (docs/data-layer.md § Plugin
// databases).
export const diffDocument = (db: PluginDatabase, emit: GithubEmit = NO_EMIT) => new Hono<AppEnv>()
  .post('/:owner/:repo/diff/segments', async (c) => {
    const parsed = segmentsBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    const refused = await resolveRepo(db, c, emit)
    if (refused) return refused
    const result = await segmentsOf(c.env.BLOBS, parsed.data.requests)
    return result.ok ? c.json(result.segments) : respondError(c, result.status, result.error)
  })
  .post('/:owner/:repo/diff/search', async (c) => {
    const parsed = searchBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    const refused = await resolveRepo(db, c, emit)
    if (refused) return refused
    const { files, ...request } = parsed.data
    const page = await searchPatches(c.env.BLOBS, files, request)
    return page ? c.json(page) : respondError(c, 400, 'bad_cursor')
  })
