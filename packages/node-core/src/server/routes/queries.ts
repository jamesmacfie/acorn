import { Hono, type Context } from 'hono'
import { queryLibraryRequestSchema } from '@acorn/protocol/dataQueries.ts'
import type { AppEnv } from '../middleware/auth'
import { requireProviderAccess } from '../middleware/requireUser'
import { respondError } from '../respond'
import { getDb } from '../db'
import { DataSourceError } from '../dataSources/validation'
import { queryStore, QueryLibraryError } from '../queries/store'
import { authorizeQueryScope, publishQuery, queryInScope, resolveQuery } from '../queries/runtime'

export const queries = new Hono<AppEnv>()
  .use('*', requireProviderAccess)
  .post('/:operation', handleQuery)

export async function handleQuery(c: Context<AppEnv>) {
    try {
      const parsed = queryLibraryRequestSchema.safeParse(await c.req.json())
      if (!parsed.success) return respondError(c, 400, 'invalid-request')
      const input = parsed.data
      if (input.operation !== c.req.param('operation')) return respondError(c, 400, 'invalid-request')
      const invocation = { principal: c.get('principal')!, signal: c.req.raw.signal }
      await authorizeQueryScope(c.env, input.scope, invocation)
      const store = queryStore(getDb(c.env))
      switch (input.operation) {
        case 'list': return c.json(store.list(input.scope))
        case 'get': return c.json(store.get(input.scope, input.id))
        case 'published': return c.json(store.published(input.scope, input.id, input.revision))
        case 'create':
          queryInScope(input.content, input.scope)
          return c.json(store.create(input.scope, input.content))
        case 'save': {
          const current = store.get(input.scope, input.id)
          queryInScope(input.content, { workspaceId: current.workspaceId, projectId: current.projectId })
          return c.json(store.save(input.scope, input.id, input.expectedRevision, input.content))
        }
        case 'publish': return c.json(await publishQuery(c.env, input.scope, input.id, input.expectedRevision, input.validationParameters, invocation))
        case 'delete': store.delete(input.scope, input.id, input.expectedRevision); return c.json({ ok: true })
        case 'consumers': return c.json(store.consumers(input.scope, input.id))
        case 'consumer':
          if (invocation.principal.kind !== 'device') return respondError(c, 403, 'interactive_user_required')
          store.setConsumer(input.scope, input.id, input.consumer, input.remove)
          return c.json({ ok: true })
        case 'resolve': return c.json(await resolveQuery(c.env, input.scope, input.reference, { inputs: input.inputs }, invocation))
      }
    } catch (error) {
      if (error instanceof QueryLibraryError) return respondError(c, error.code === 'not-found' ? 404 : error.code === 'invalid-query' ? 400 : 409, error.code)
      if (error instanceof DataSourceError) return respondError(c, error.code === 'forbidden' ? 403 : error.code === 'unavailable' ? 404 : 400, error.code)
      return respondError(c, 400, 'invalid-query')
    }
}
