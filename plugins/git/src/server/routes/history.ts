import { Hono } from 'hono'
import { BridgeError, requireDevice, type AppEnv, type CoreServices } from '@acorn/plugin-api/node'
import { history } from '../history'
import { fileText, revisionFor, search, segments } from '../revision'
import { readGate } from '../readGate'
import type { HistoryFilter } from '../../shared/api'
import { z } from 'zod'

type Core = Pick<CoreServices, 'git' | 'projects'>
const ID = /^[0-9a-f]{40,64}$/
const baseOf = (value: unknown): string | null | undefined => value === undefined ? undefined : value === '' ? null : typeof value === 'string' && ID.test(value) ? value : invalid()
const invalid = (): never => { throw new BridgeError(400, 'bad_request', 'Invalid revision request.') }
const segmentBody = z.object({ base: z.string().regex(ID).nullable(), requests: z.array(z.object({ path: z.string(), patchKey: z.string(), ordinal: z.number().int().min(0) })).max(32) })
const searchBody = z.object({ base: z.string().regex(ID).nullable(), query: z.string().max(256), caseSensitive: z.boolean(), cursor: z.string().nullable() })
const fileBody = z.object({ base: z.string().regex(ID).nullable(), path: z.string(), sha: z.string().regex(ID) })
const body = async <T extends z.ZodTypeAny>(read: () => Promise<unknown>, schema: T): Promise<z.infer<T>> => {
  const parsed = schema.safeParse(await read().catch(invalid))
  return parsed.success ? parsed.data : invalid()
}

export function historyRoutes(core: Core) {
  const limited = readGate()
  return new Hono<AppEnv>()
    .use('/projects/:projectId/history', requireDevice)
    .use('/projects/:projectId/revisions/*', requireDevice)
    .get('/projects/:projectId/history', async (c) => {
      const field = c.req.query('field') ?? 'message'
      if (field !== 'message' && field !== 'author' && field !== 'hash') invalid()
      const filter: HistoryFilter = { ref: c.req.query('ref') || null, field: field as HistoryFilter['field'], query: c.req.query('query') ?? '' }
      return c.json(await limited(c.req.raw.signal, () => history(core, c.req.param('projectId'), filter, c.req.query('cursor') ?? null, c.req.raw.signal)))
    })
    .get('/projects/:projectId/revisions/:id', async (c) => c.json(await limited(c.req.raw.signal, () => revisionFor(core, c.req.param('projectId'), c.req.param('id'), baseOf(c.req.query('base')), c.req.raw.signal))))
    .post('/projects/:projectId/revisions/:id/segments', async (c) => {
      const value = await body(() => c.req.json(), segmentBody)
      return c.json(await limited(c.req.raw.signal, () => segments(core, c.req.param('projectId'), c.req.param('id'), value.base, value.requests, c.req.raw.signal)))
    })
    .post('/projects/:projectId/revisions/:id/search', async (c) => {
      const value = await body(() => c.req.json(), searchBody)
      return c.json(await limited(c.req.raw.signal, () => search(core, c.req.param('projectId'), c.req.param('id'), value.base,
        { query: value.query, caseSensitive: value.caseSensitive, cursor: value.cursor }, c.req.raw.signal)))
    })
    .post('/projects/:projectId/revisions/:id/file', async (c) => {
      const value = await body(() => c.req.json(), fileBody)
      return c.json(await limited(c.req.raw.signal, () => fileText(core, c.req.param('projectId'), c.req.param('id'), value.base, value.path, value.sha, c.req.raw.signal)))
    })
}
