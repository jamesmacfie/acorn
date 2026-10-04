import {
  AUTHORING_LIMITS,
  boundedAuthoringSample,
  type AuthoringMetadataRequest,
  type AuthoringTurnRequest,
} from '@acorn/protocol/authoring.ts'
import { DATA_SOURCE_PREVIEW_MODE, type DataSourceScope } from '@acorn/protocol/dataSources.ts'
import type { Env } from '../bindings'
import type { DataSourceInvocation } from '../dataSources/authority'
import { discoverDataSources, invokeDataSource, listDataSources } from '../dataSources/runtime'
import { listConnections } from '../integrations/connections'
import { getDb } from '../db'

const sameScope = (expected: AuthoringTurnRequest['scope'], actual: DataSourceScope): boolean =>
  actual.workspaceId === expected.workspaceId && actual.projectId === expected.projectId

function assertScope(expected: AuthoringTurnRequest['scope'], actual: DataSourceScope): void {
  if (!sameScope(expected, actual)) throw new Error('The metadata request is outside the selected workspace or project.')
}

/** Execute only the read operations the authoring protocol declares, under the caller's principal. */
export async function authoringMetadata(args: {
  env: Env
  turn: AuthoringTurnRequest
  request: AuthoringMetadataRequest
  invocation: DataSourceInvocation
  validate(candidate: unknown): Promise<{ candidate?: unknown; problems: string[] }>
  workflows?: () => unknown
}): Promise<unknown> {
  const { request } = args
  if (request.operation === 'validate-candidate') return args.validate(request.candidate)
  if (request.operation === 'list-workflows') return args.workflows?.() ?? { unavailable: true, reason: 'This authoring target has no child workflows.' }
  if (request.operation === 'list-sources') {
    return listDataSources(args.env, { ...args.turn.scope, parameters: {} }, args.invocation)
  }
  if (request.operation === 'list-accounts') {
    const accounts = await listConnections(getDb(args.env), args.invocation.principal.userId)
    const catalog = await listDataSources(args.env, { ...args.turn.scope, parameters: {} }, args.invocation)
    return Promise.all(accounts.filter(account => !['disabled', 'needs-auth'].includes(account.status)).slice(0, 50)
      .map(async account => {
        const source = catalog.sources.find(entry => entry.providerId === account.provider)
        const basic = { id: account.id, providerId: account.provider, name: account.name ?? account.label }
        if (!source) return basic
        const scope = { ...args.turn.scope, connectionId: account.id, parameters: {} }
        try {
          const description = await invokeDataSource(args.env, { operation: 'describe', source, scope }, args.invocation)
          return description.operations.identity ? { ...basic, identity: await invokeDataSource(args.env, { operation: 'identity', source, scope }, args.invocation) } : basic
        } catch { return basic }
      }))
  }
  if (request.operation === 'discover-sources') {
    assertScope(args.turn.scope, request.scope)
    return discoverDataSources(args.env, request, args.invocation)
  }
  if (request.operation === 'preview-sample') {
    if (!args.turn.samplesEnabled) return { unavailable: true, reason: 'Preview samples are disabled for this conversation.' }
    assertScope(args.turn.scope, request.query.scope)
    const result = await invokeDataSource(args.env, {
      operation: 'query', query: request.query, mode: DATA_SOURCE_PREVIEW_MODE, evaluationTime: Date.now(),
      pageSize: AUTHORING_LIMITS.sampleRecords,
    }, args.invocation)
    return boundedAuthoringSample(request.query, request.fields, result.records)
  }
  assertScope(args.turn.scope, request.scope)
  if (request.operation === 'describe-source') {
    return invokeDataSource(args.env, { operation: 'describe', source: request.source, scope: request.scope }, args.invocation)
  }
  return invokeDataSource(args.env, request, args.invocation)
}
