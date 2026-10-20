import { createDataSelectionPager, type PluginFetchHandler } from '@acorn/plugin-api/node'
import {
  dataSourceRequestSchema,
  type DataSourceDescription,
  type DataSourceOptions,
  type DataSourcePage,
  type DataSourceQuery,
  type DataSourceRequest,
} from '@acorn/protocol/dataSources.ts'

type ReadRecords = (token: string, query: DataSourceQuery, signal: AbortSignal) => Promise<DataSourcePage>
type ReadOptions = (
  token: string,
  input: Extract<DataSourceRequest, { operation: 'options' }>,
  signal: AbortSignal,
) => Promise<DataSourceOptions>

/** One Linear source's route: it checks the caller and the selected connection before every read. */
export function createLinearSourceHandler(
  description: DataSourceDescription,
  readRecords: ReadRecords,
  readOptions?: ReadOptions,
): PluginFetchHandler {
  const page = createDataSelectionPager()
  return async (request, context) => {
    if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 })
    if (
      context.principal.kind !== 'device' &&
      !(context.principal.kind === 'internal' && context.principal.scope === 'service')
    )
      return Response.json({ error: 'forbidden' }, { status: 403 })
    try {
      const input = dataSourceRequestSchema.parse(await request.json())
      request.signal.throwIfAborted()
      if (input.operation === 'describe') return Response.json(description)
      if (
        input.operation === 'details' ||
        input.operation === 'actions' ||
        input.operation === 'identity' ||
        (input.operation === 'options' && !readOptions)
      ) {
        return Response.json({ error: 'unsupported_operation' }, { status: 400 })
      }
      const scope = input.operation === 'query' ? input.query.scope : input.scope
      if (
        !scope.connectionId ||
        !(await context.providers.connections('linear')).some(
          (connection) => connection.id === scope.connectionId && connection.status === 'connected',
        )
      )
        throw new Error('connection_unavailable')
      const read = async () => {
        const results = await context.providers.withConnections('linear', async (connection, token) => {
          if (connection.id !== scope.connectionId) return undefined
          return input.operation === 'options'
            ? readOptions!(token, input, request.signal)
            : readRecords(token, input.query, request.signal)
        })
        if (!results[0]) throw new Error('connection_unavailable')
        return results[0]
      }
      if (input.operation === 'options') return Response.json(await read())
      return Response.json(
        await page(context.userId, input, async () => {
          const result = await read()
          if (!('records' in result)) throw new Error('invalid_result')
          return result
        }),
      )
    } catch {
      return Response.json({ error: 'linear_source_failed' }, { status: 502 })
    }
  }
}
