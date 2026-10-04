import { createDataSelectionPager, type PluginFetchHandler } from '@acorn/plugin-api/node'
import { dataSourceRequestSchema } from '@acorn/protocol/dataSources.ts'
import { errorSourceDescription } from '../../shared/errorSource'
import { readErrorDetails, readErrors } from './errorRead'

export function createErrorSourceHandler(): PluginFetchHandler {
  const page = createDataSelectionPager()
  return async (request, context) => {
    if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 })
    if (context.principal.kind !== 'device' && !(context.principal.kind === 'internal' && context.principal.scope === 'service')) return Response.json({ error: 'forbidden' }, { status: 403 })
    try {
      const input = dataSourceRequestSchema.parse(await request.json())
      request.signal.throwIfAborted()
      if (input.operation === 'describe') return Response.json(errorSourceDescription)
      if (input.operation === 'options' || input.operation === 'actions' || input.operation === 'identity') {
        return Response.json({ error: 'unsupported_operation' }, { status: 400 })
      }
      const scope = input.operation === 'query' ? input.query.scope : input.scope
      const connectionId = scope.connectionId
      if (!connectionId || !(await context.providers.connections('rollbar')).some(connection => connection.id === connectionId && connection.status === 'connected')) throw new Error('connection_unavailable')
      if (input.operation === 'details') {
        if (input.ref.connectionId !== connectionId || input.ref.pluginId !== 'rollbar' || input.ref.sourceId !== 'error-groups') throw new Error('invalid_ref')
        return Response.json(await readErrorDetails(context, connectionId, input.ref.recordId, request.signal))
      }
      return Response.json(await page(context.userId, input, async () => {
        const results = await context.providers.withConnections('rollbar', async (connection, token) => {
          if (connection.id !== connectionId) return undefined
          return readErrors(token, connectionId, input.query, request.signal)
        })
        if (!results[0]) throw new Error('connection_unavailable')
        return results[0]
      }))
    } catch { return Response.json({ error: 'rollbar_source_failed' }, { status: 502 }) }
  }
}
