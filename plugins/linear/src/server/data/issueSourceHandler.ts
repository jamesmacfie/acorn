import { createDataSelectionPager, type PluginFetchHandler } from '@acorn/plugin-api/node'
import { dataSourceRequestSchema } from '@acorn/protocol/dataSources.ts'
import { issueSourceDescription } from '../../shared/issueSource'
import { readIssueOptions, readIssues } from './issueRead'

export function createIssueSourceHandler(): PluginFetchHandler {
  const page = createDataSelectionPager()
  return async (request, context) => {
    if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 })
    if (context.principal.kind !== 'device' && !(context.principal.kind === 'internal' && context.principal.scope === 'service')) return Response.json({ error: 'forbidden' }, { status: 403 })
    try {
      const input = dataSourceRequestSchema.parse(await request.json())
      request.signal.throwIfAborted()
      if (input.operation === 'describe') return Response.json(issueSourceDescription)
      if (input.operation === 'details' || input.operation === 'actions' || input.operation === 'identity') {
        return Response.json({ error: 'unsupported_operation' }, { status: 400 })
      }
      const scope = input.operation === 'query' ? input.query.scope : input.scope
      if (!scope.connectionId || !(await context.providers.connections('linear')).some(connection => connection.id === scope.connectionId && connection.status === 'connected')) throw new Error('connection_unavailable')
      const read = async () => {
        const results = await context.providers.withConnections('linear', async (connection, token) => {
          if (connection.id !== scope.connectionId) return undefined
          return input.operation === 'options' ? readIssueOptions(token, input, request.signal) : readIssues(token, input.query, request.signal)
        })
        if (!results[0]) throw new Error('connection_unavailable')
        return results[0]
      }
      if (input.operation === 'options') return Response.json(await read())
      return Response.json(await page(context.userId, input, async () => {
        const result = await read()
        if (!('records' in result)) throw new Error('invalid_result')
        return result
      }))
    } catch { return Response.json({ error: 'linear_source_failed' }, { status: 502 }) }
  }
}
