import { createHash, randomUUID } from 'node:crypto'
import type { PluginFetchHandler } from '@acorn/plugin-api/node'
import { dataSourceRequestSchema, type DataSourcePage } from '@acorn/protocol/dataSources.ts'
import { DATA_LIMITS } from '@acorn/protocol/dataValues.ts'
import { pullSourceDescription } from '../../shared/pullSource'
import { pullSearch, selectPulls } from './pullQuery'
import { readPullSelection, readRepositoryOptions } from './pullRead'

type Selection = { key: string; page: DataSourcePage; expires: number; bytes: number }

/** Disposable continuation storage, never a durable workflow selection or a cross-query cache. */
export function createPullSourceHandler(): PluginFetchHandler {
  const selections = new Map<string, Selection>()
  const sweep = () => {
    for (const [id, selection] of selections) if (selection.expires <= Date.now()) selections.delete(id)
  }
  return async (request, context) => {
    try {
      if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 })
      if (context.principal.kind !== 'device' && !(context.principal.kind === 'internal' && context.principal.scope === 'service')) {
        return Response.json({ error: 'forbidden' }, { status: 403 })
      }
      const input = dataSourceRequestSchema.parse(await request.json())
      if (input.operation === 'describe') return Response.json(pullSourceDescription)
      if (input.operation === 'details') return Response.json({ error: 'unsupported_operation' }, { status: 400 })
      const scope = input.operation === 'query' ? input.query.scope : input.scope
      if (!scope.connectionId) throw new Error('connection_required')
      if (!(await context.providers.connections('github')).some(connection => connection.id === scope.connectionId && connection.status === 'connected')) {
        throw new Error('connection_unavailable')
      }
      if (input.operation === 'options' && (input.target !== 'parameter' || input.pointer !== '/repository')) throw new Error('unsupported_options')
      sweep()
      const key = createHash('sha256').update(JSON.stringify({ owner: context.userId, scope,
        ...(input.operation === 'query' ? { query: input.query, evaluationTime: input.evaluationTime, mode: input.mode } : {}),
      })).digest('hex')
      let selection: Selection | undefined
      let id = ''
      let offset = 0
      if (input.operation === 'query' && input.cursor) {
        const match = /^([\w-]+):(\d+)$/.exec(input.cursor)
        if (!match) throw new Error('invalid_cursor')
        id = match[1]!
        offset = Number(match[2])
        selection = selections.get(id)
        if (!selection || selection.key !== key || !Number.isSafeInteger(offset) || offset >= selection.page.records.length) throw new Error('expired_or_invalid_cursor')
      }
      // Use the portable credential callback: the host has confined it to the selected connection.
      // Also check the ID here for direct plugin-route callers outside source dispatch.
      if (!selection) {
        const responses = await context.providers.withConnections('github', async (connection, token) => {
          if (connection.id !== scope.connectionId) return undefined
          if (input.operation === 'options') return { options: await readRepositoryOptions(token, input, request.signal) }
          const q = pullSearch(input.query)
          const page = await readPullSelection(token, q, request.signal)
          if (page.completeness.kind === 'incomplete') return { page: { ...page, records: [] } }
          const records = selectPulls(page.records, input.query)
          const take = input.query.take
          return { page: { ...page, records: take ? records.slice(0, take) : records,
            completeness: take && records.length >= take ? { kind: 'bounded' as const } : { kind: 'complete' as const } } }
        })
        const response = responses[0]
        if (!response) throw new Error('connection_unavailable')
        if ('options' in response) return Response.json(response.options)
        if (!response.page) throw new Error('github_unavailable')
        if (response.page.completeness.kind === 'incomplete') return Response.json(response.page)
        selection = { key, page: response.page, expires: Date.now() + DATA_LIMITS.queryMs, bytes: Buffer.byteLength(JSON.stringify(response.page)) }
        id = randomUUID()
      }
      if (input.operation !== 'query') throw new Error('invalid_operation')
      const records = selection.page.records.slice(offset, offset + input.pageSize)
      const more = offset + records.length < selection.page.records.length
      if (more && !selections.has(id)) {
        const bytes = [...selections.values()].reduce((sum, entry) => sum + entry.bytes, selection.bytes)
        if (selections.size >= 16 || bytes > DATA_LIMITS.selectionBytes) {
          return Response.json({ ...selection.page, records: [], completeness: { kind: 'incomplete', cause: 'host-budget' } })
        }
        selections.set(id, selection)
      }
      return Response.json({ ...selection.page, records, completeness: more
        ? { kind: 'more', cursor: `${id}:${offset + records.length}` } : selection.page.completeness })
    } catch {
      // Provider bodies and credentials never become source error details.
      return Response.json({ error: 'github_source_failed' }, { status: 502 })
    }
  }
}
