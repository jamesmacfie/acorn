import type { NodePlugin, PluginFetchHandler } from '@acorn/plugin-api/node'
import { dataSourceRequestSchema, type DataSourceDescription } from '@acorn/protocol/dataSources.ts'
import { parseDataValue } from '@acorn/protocol/dataValues.ts'
import { GITLAB_PROVIDER } from '../gitlabApi'

// Core's local branches with the relation to their merge requests, the way GitHub's branch source
// relates them to pull requests (plugins/github/src/server/data/branchSourceHandler.ts). Core owns the
// scoped local Git read; this adds the account and the relation.

const localSource = { pluginId: 'core', sourceId: 'local-branches' }
type SourceInvoker = Parameters<NodePlugin['init']>[0]['dataSources']['invoke']

function branchDescription(base: DataSourceDescription): DataSourceDescription {
  return {
    ...base,
    revision: `${base.revision}.gitlab.1`,
    schema: {
      ...base.schema,
      properties: { ...base.schema.properties, gitlabConnectionId: { type: 'string' } },
      required: [...(base.schema.required ?? []), 'gitlabConnectionId'],
    },
    fields: [
      ...base.fields,
      { pointer: '/gitlabConnectionId', label: 'GitLab account connection', origin: 'declared' },
    ],
    relations: [
      {
        id: 'branch-merge-request',
        label: 'Merge request for this branch',
        target: { pluginId: GITLAB_PROVIDER, sourceId: 'merge-requests' },
        kind: 'references',
        cardinality: 'many-to-one',
        keys: [
          { from: '/gitlabConnectionId', to: '/gitlabConnectionId', scope: 'account' },
          { from: '/remoteRepository', to: '/remoteRepository', scope: 'container' },
          { from: '/name', to: '/sourceBranch', scope: 'identity' },
        ],
        requiredScopes: ['account', 'container'],
      },
    ],
    consistency: `${base.consistency} Merge requests use the selected GitLab account. Unmatched branches remain; multiple matches produce a cardinality warning.`,
  }
}

export function createBranchSourceHandler(invoke: SourceInvoker): PluginFetchHandler {
  return async (request, context) => {
    try {
      if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 })
      if (
        context.principal.kind !== 'device' &&
        !(context.principal.kind === 'internal' && context.principal.scope === 'service')
      )
        return Response.json({ error: 'forbidden' }, { status: 403 })
      const input = dataSourceRequestSchema.parse(await request.json())
      if (input.operation !== 'describe' && input.operation !== 'options' && input.operation !== 'query')
        return Response.json({ error: 'unsupported_operation' }, { status: 400 })
      const source = input.operation === 'query' ? input.query.source : input.source
      if (source.pluginId !== GITLAB_PROVIDER || source.sourceId !== 'local-branches') throw new Error('invalid_source')
      const scope = input.operation === 'query' ? input.query.scope : input.scope
      const { connectionId, ...localScope } = scope
      if (
        !connectionId ||
        !(await context.providers.connections(GITLAB_PROVIDER)).some(
          (connection) => connection.id === connectionId && connection.status === 'connected',
        )
      )
        return Response.json({ error: 'connection_unavailable' }, { status: 403 })
      const invocation = { principal: context.principal, signal: request.signal }
      const description = branchDescription(
        await invoke({ operation: 'describe', source: localSource, scope: localScope }, invocation),
      )
      if (input.operation === 'describe') return Response.json(description)
      if (input.operation === 'options')
        return Response.json(await invoke({ ...input, source: localSource, scope: localScope }, invocation))
      const result = await invoke(
        { ...input, query: { ...input.query, source: localSource, scope: localScope } },
        invocation,
      )
      const { mode: _mode, evaluationTime: _evaluationTime, records, ...page } = result
      return Response.json({
        ...page,
        revision: description.revision,
        records: records.map(({ ref, data, ...record }) => {
          if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('invalid_local_record')
          return {
            ...record,
            recordId: ref.recordId,
            data: parseDataValue({ ...data, gitlabConnectionId: connectionId }),
          }
        }),
      })
    } catch {
      return Response.json({ error: 'gitlab_branch_source_failed' }, { status: 502 })
    }
  }
}
