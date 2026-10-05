import type { NodePlugin, PluginFetchHandler } from '@acorn/plugin-api/node'
import { dataSourceRequestSchema, type DataSourceDescription } from '@acorn/protocol/dataSources.ts'
import { parseDataValue } from '@acorn/protocol/dataValues.ts'

const localSource = { pluginId: 'core', sourceId: 'local-branches' }
type SourceInvoker = Parameters<NodePlugin['init']>[0]['dataSources']['invoke']

export function branchDescription(base: DataSourceDescription): DataSourceDescription {
  return {
    ...base,
    revision: `${base.revision}.github.1`,
    schema: { ...base.schema, properties: { ...base.schema.properties,
      githubProvider: { type: 'string' }, githubConnectionId: { type: 'string' },
    }, required: [...base.schema.required ?? [], 'githubProvider', 'githubConnectionId'] },
    fields: [...base.fields,
      { pointer: '/githubProvider', label: 'Provider', origin: 'declared' },
      { pointer: '/githubConnectionId', label: 'GitHub account connection', origin: 'declared' },
    ],
    relations: [{ id: 'branch-pull-request', label: 'Pull request for this branch',
      target: { pluginId: 'github', sourceId: 'pull-requests' }, kind: 'references', cardinality: 'many-to-one',
      keys: [
        { from: '/githubProvider', to: '/githubProvider', scope: 'provider' },
        { from: '/githubConnectionId', to: '/githubConnectionId', scope: 'account' },
        { from: '/githubRepository', to: '/headRepository', scope: 'container' },
        { from: '/name', to: '/headBranch', scope: 'identity' },
      ], requiredScopes: ['provider', 'account', 'container'] }],
    consistency: `${base.consistency} Pull requests use the selected GitHub account. Unmatched branches remain; multiple matches produce a cardinality warning.`,
  }
}

/** The plugin owns the provider relation; core owns the scoped local Git read. */
export function createBranchSourceHandler(invoke: SourceInvoker): PluginFetchHandler {
  return async (request, context) => {
    try {
      if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 })
      if (context.principal.kind !== 'device' && !(context.principal.kind === 'internal' && context.principal.scope === 'service')) {
        return Response.json({ error: 'forbidden' }, { status: 403 })
      }
      const input = dataSourceRequestSchema.parse(await request.json())
      if (input.operation !== 'describe' && input.operation !== 'options' && input.operation !== 'query') {
        return Response.json({ error: 'unsupported_operation' }, { status: 400 })
      }
      const source = input.operation === 'query' ? input.query.source : input.source
      if (source.pluginId !== 'github' || source.sourceId !== 'local-branches') throw new Error('invalid_source')
      const scope = input.operation === 'query' ? input.query.scope : input.scope
      const { connectionId, ...localScope } = scope
      if (!connectionId || !(await context.providers.connections('github'))
        .some(connection => connection.id === connectionId && connection.status === 'connected')) {
        return Response.json({ error: 'connection_unavailable' }, { status: 403 })
      }
      const invocation = { principal: context.principal, signal: request.signal }
      const description = branchDescription(await invoke({ operation: 'describe', source: localSource, scope: localScope }, invocation))
      if (input.operation === 'describe') return Response.json(description)
      if (input.operation === 'options') {
        return Response.json(await invoke({ ...input, source: localSource, scope: localScope }, invocation))
      }
      const result = await invoke({ ...input, query: { ...input.query, source: localSource, scope: localScope } }, invocation)
      const { mode: _mode, evaluationTime: _evaluationTime, records, ...page } = result
      return Response.json({ ...page, revision: description.revision, records: records.map(({ ref, data, ...record }) => {
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('invalid_local_record')
        return { ...record, recordId: ref.recordId,
          data: parseDataValue({ ...data, githubProvider: 'github', githubConnectionId: connectionId }) }
      }) })
    } catch {
      return Response.json({ error: 'github_branch_source_failed' }, { status: 502 })
    }
  }
}
