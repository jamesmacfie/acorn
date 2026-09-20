import { Hono } from 'hono'
import type { AppEnv } from '../middleware/auth'
import { requireProviderAccess } from '../middleware/requireUser'
import { discoverDataSources, invokeDataSource, listDataSources } from '../dataSources/runtime'
import { DataSourceError } from '../dataSources/validation'
import { respondError } from '../respond'
import { dataSourceRequestSchema, dataSourceScopeSchema, dataSourceDiscoveryRequestSchema } from '@acorn/protocol/dataSources.ts'

export const dataSources = new Hono<AppEnv>()
  .use('*', requireProviderAccess)
  .post('/:operation', async c => {
    const input: unknown = await c.req.json().catch(() => null)
    const invocation = { principal: c.get('principal')!, signal: c.req.raw.signal }
    try {
      const operation = c.req.param('operation')
      const parsed = (operation === 'list' ? dataSourceScopeSchema : operation === 'discover' ? dataSourceDiscoveryRequestSchema : dataSourceRequestSchema).safeParse(input)
      if (!parsed.success) return respondError(c, 400, 'invalid-request')
      if (operation === 'list') return c.json(await listDataSources(c.env, input, invocation))
      if (operation === 'discover') return c.json(await discoverDataSources(c.env, input, invocation))
      if (!input || typeof input !== 'object' || !('operation' in input) || input.operation !== operation) return respondError(c, 400, 'invalid-request')
      return c.json(await invokeDataSource(c.env, input, invocation))
    } catch (error) {
      if (!(error instanceof DataSourceError)) return respondError(c, 500, 'source-error')
      const status = error.code === 'forbidden' ? 403 : error.code === 'unavailable' ? 404 : error.code === 'timeout' ? 504 : 400
      return respondError(c, status, error.code)
    }
  })
