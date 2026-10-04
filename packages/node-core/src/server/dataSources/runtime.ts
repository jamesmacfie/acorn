import {
  dataSourceCatalogSchema, dataSourceDescriptionSchema, dataSourceDetailsSchema, dataSourceDiscoveryPageSchema, dataSourceDiscoveryRequestSchema,
  dataSourceOptionsSchema, dataSourcePageSchema, dataSourceRequestSchema, dataSourceScopeSchema, dataSourceActionsSchema, dataSourceActSchema,
  type DataSourceDescription, type DataSourceDiscoveryPage, type DataSourceRequest, type DataSourceResult, type DataSourceScope, type DataSourceResponse,
} from '@acorn/protocol/dataSources.ts'
import { DATA_LIMITS, canonicalDataEncoding, parseDataValue } from '@acorn/protocol/dataValues.ts'
import { validateDataValue } from '@acorn/protocol/dataSchemas.ts'
import type { Env } from '../bindings'
import { authorizeDataSource, type DataSourceInvocation } from './authority'
import { dispatchSource } from './dispatch'
import {
  registeredDataSource, registeredDataSources, registeredDataSourceDiscovery,
  registeredDataSourceDiscoveries, registerDiscoveredSource, dataSourceAvailableInScope,
  type RegisteredDataSource,
} from './registry'
import { confinePluginPath } from '../pluginHost/dispatch'
import { DataSourceError, validateDescription, validateSourceQuery } from './validation'
import { ProviderRequestScheduler } from '../integrations/budgetRuntime'
import { connectionProviderRegistry } from '../integrations/connectionProviders/registry'
import type { DataRecordAction } from '@acorn/protocol/dataActions.ts'
import { getDb } from '../db'

function parse<T>(schema: { parse(value: unknown): T }, input: unknown, response = true): T {
  try { return schema.parse(input) } catch { throw new DataSourceError(response ? 'invalid-response' : 'invalid-request') }
}
const bounded = (invocation: DataSourceInvocation, timeoutMs: number = DATA_LIMITS.queryMs): DataSourceInvocation => ({
  ...invocation, signal: AbortSignal.any([invocation.signal, AbortSignal.timeout(timeoutMs)]),
})
const publicSource = ({ handler: _handler, coreHandler: _coreHandler, ...source }: RegisteredDataSource) => source

const sourceRequestScheduler = new ProviderRequestScheduler()

const dispatchRegistered = async (
  env: Env,
  source: RegisteredDataSource,
  request: DataSourceRequest,
  invocation: DataSourceInvocation,
  maxBytes?: number,
) => {
  const execute = () => source.coreHandler
    ? source.coreHandler(request, env, invocation.signal)
    : dispatchSource(env, source.pluginId, source.handler, request, invocation, maxBytes, {
      providerId: source.providerId,
      connectionId: request.operation === 'query' ? request.query.scope.connectionId : request.scope.connectionId,
    })
  const connectionId = request.operation === 'query' ? request.query.scope.connectionId : request.scope.connectionId
  const provider = source.providerId ? connectionProviderRegistry.get(source.providerId) : undefined
  if (request.operation !== 'query' || !provider || !connectionId) return execute()
  return sourceRequestScheduler.run(provider.id, connectionId, provider.budgets, async () => {
    for (let attempt = 0; ; attempt++) {
      try { return await execute() }
      catch (error) {
        if (!(error instanceof DataSourceError) || error.code !== 'rate-limited' || attempt >= 2) throw error
        await new Promise<void>((resolve, reject) => {
          if (invocation.signal.aborted) { reject(new DataSourceError('cancelled')); return }
          const onAbort = () => { clearTimeout(timer); reject(new DataSourceError('cancelled')) }
          const timer = setTimeout(() => { invocation.signal.removeEventListener('abort', onAbort); resolve() }, 500 * 2 ** attempt)
          invocation.signal.addEventListener('abort', onAbort, { once: true })
        })
      }
    }
  })
}

export async function listDataSources(env: Env, input: unknown, invocation: DataSourceInvocation) {
  const scope = parse(dataSourceScopeSchema, input, false)
  await authorizeDataSource(env, invocation, scope)
  const { datasetIdFromSource, datasetSourcesInScope } = await import('../datasets/source')
  const visibleDatasets = datasetSourcesInScope(getDb(env), scope)
  const sources = []
  for (const source of registeredDataSources()) {
    if (datasetIdFromSource(source.sourceId) && source.pluginId === 'core' && !visibleDatasets.has(source.sourceId)) continue
    if (!dataSourceAvailableInScope(source, scope)) continue
    // Metadata is available before choosing a connection; an explicit connection filters to its owner.
    if (scope.connectionId) {
      try { await authorizeDataSource(env, invocation, scope, source.pluginId, source.providerId) } catch { continue }
    }
    sources.push(publicSource(source))
  }
  return parse(dataSourceCatalogSchema, {
    sources,
    discoveries: registeredDataSourceDiscoveries().map(({ handler: _handler, ...discovery }) => discovery),
  })
}

export async function discoverDataSources(env: Env, input: unknown, invocation: DataSourceInvocation): Promise<DataSourceDiscoveryPage> {
  const request = parse(dataSourceDiscoveryRequestSchema, input, false)
  const discovery = registeredDataSourceDiscovery(request.pluginId, request.discoveryId)
  if (!discovery) throw new DataSourceError('unavailable')
  invocation = bounded(invocation)
  await authorizeDataSource(env, invocation, request.scope, discovery.pluginId, discovery.providerId)
  const page = parse(dataSourceDiscoveryPageSchema, await dispatchSource(
    env, discovery.pluginId, discovery.handler, { operation: 'discover', ...request }, invocation,
    DATA_LIMITS.detailBytes, { providerId: discovery.providerId, connectionId: request.scope.connectionId },
  ))
  if (page.sources.length > request.pageSize || page.exhausted === !!page.nextCursor) throw new DataSourceError('invalid-response')
  if (page.nextCursor && page.nextCursor === request.cursor) throw new DataSourceError('cursor-loop')
  if (new Set(page.sources.map(source => source.sourceId)).size !== page.sources.length) throw new DataSourceError('invalid-response')
  if (registeredDataSourceDiscovery(request.pluginId, request.discoveryId) !== discovery) throw new DataSourceError('unavailable')
  for (const source of page.sources) {
    if (source.providerId !== discovery.providerId) throw new DataSourceError('invalid-response')
    registerDiscoveredSource(discovery.pluginId, { ...source, handler: discovery.handler }, request.scope)
  }
  return { ...page, sources: page.sources.map(source => ({ ...source, pluginId: discovery.pluginId })) }
}

async function describe(
  env: Env,
  source: RegisteredDataSource,
  scope: DataSourceScope,
  invocation: DataSourceInvocation,
): Promise<DataSourceDescription> {
  const result = parse(dataSourceDescriptionSchema, await dispatchRegistered(env, source, {
    operation: 'describe', source: { pluginId: source.pluginId, sourceId: source.sourceId }, scope,
  }, invocation, DATA_LIMITS.detailBytes))
  validateDescription(result)
  if (result.writable?.length) (await import('./fieldMove')).validateWritableDescription(result, source.pluginId)
  if (result.targets?.some(target => !target.kind.startsWith(`${source.pluginId}.`))) throw new DataSourceError('invalid-response')
  if (new Set(result.actions?.map(action => action.id)).size !== (result.actions?.length ?? 0)) throw new DataSourceError('invalid-response')
  return result
}

export function invokeDataSource<R extends DataSourceRequest>(env: Env, input: R, invocation: DataSourceInvocation): Promise<DataSourceResponse<R>>
export function invokeDataSource(env: Env, input: unknown, invocation: DataSourceInvocation): Promise<DataSourceResponse<DataSourceRequest>>
export async function invokeDataSource(env: Env, input: unknown, invocation: DataSourceInvocation): Promise<DataSourceResponse<DataSourceRequest>> {
  const request = parse(dataSourceRequestSchema, input, false)
  const ref = request.operation === 'query' ? request.query.source : request.operation === 'details' || request.operation === 'actions' ? request.ref : request.source
  const scope = request.operation === 'query' ? request.query.scope : request.scope
  const datasetId = ref.pluginId === 'core' && ref.sourceId.startsWith('dataset:') ? ref.sourceId.slice(8) : null
  if (datasetId) {
    await authorizeDataSource(env, invocation, scope)
    const { ensureDatasetSource } = await import('../datasets/source')
    ensureDatasetSource(getDb(env), datasetId, scope)
  }
  const source = registeredDataSource(ref)
  if (!source || !dataSourceAvailableInScope(source, scope)) throw new DataSourceError('unavailable')
  invocation = bounded(invocation, request.operation === 'query' ? request.timeoutMs : undefined)
  await authorizeDataSource(env, invocation, scope, source.pluginId, source.providerId)
  const description = await describe(env, source, scope, invocation)
  if (registeredDataSource(ref) !== source) throw new DataSourceError('unavailable')
  if (request.operation === 'describe') return description
  if (request.operation === 'query') return querySource(env, source, request, description, invocation)
  if (request.operation === 'options') {
    const fields = request.target === 'field' ? description.fields : description.parameterFields
    if (!description.operations.options
      || !fields.some(field => field.pointer === request.pointer && field.choices?.kind === 'dynamic')) {
      throw new DataSourceError('unsupported-query')
    }
    const page = parse(dataSourceOptionsSchema, await dispatchRegistered(env, source, request, invocation, DATA_LIMITS.detailBytes))
    if (page.options.length > request.pageSize || page.exhausted === !!page.nextCursor
      || new Set(page.options.map(option => option.id)).size !== page.options.length) {
      throw new DataSourceError('invalid-response')
    }
    if (page.nextCursor && page.nextCursor === request.cursor) throw new DataSourceError('cursor-loop')
    return page
  }
  if (request.operation === 'actions') {
    validateRecordReference(request.ref, scope, true)
    if (!description.actions?.length) return { actions: [] }
    const result = parse(dataSourceActionsSchema, await dispatchRegistered(env, source, request, invocation, DATA_LIMITS.detailBytes))
    if (registeredDataSource(ref) !== source) throw new DataSourceError('unavailable')
    await authorizeDataSource(env, invocation, scope, source.pluginId, source.providerId)
    for (const item of result.actions) if (item.action.verb === 'runNodeAction') {
      try { confinePluginPath(source.pluginId, item.action.path) } catch { throw new DataSourceError('invalid-response') }
    }
    if (result.actions.some(item => item.action.risk && item.action.risk !== item.risk
      || !description.actions?.some(declared => declared.id === item.id && declared.risk === item.risk))) throw new DataSourceError('invalid-response')
    return result
  }
  if (!description.operations.details || !description.detailSchema) throw new DataSourceError('unsupported-query')
  validateRecordReference(request.ref, scope)
  const details = parse(dataSourceDetailsSchema, await dispatchRegistered(env, source, request, invocation, DATA_LIMITS.detailBytes))
  if (registeredDataSource(ref) !== source) throw new DataSourceError('unavailable')
  await authorizeDataSource(env, invocation, scope, source.pluginId, source.providerId)
  if (details.kind === 'found') {
    try { validateDataValue(details.data, description.detailSchema, DATA_LIMITS.detailBytes) } catch { throw new DataSourceError('invalid-response') }
    return { ...details, schema: description.detailSchema }
  }
  return details
}

function validateRecordReference(ref: { connectionId?: string; scope?: DataSourceScope }, scope: DataSourceScope, requireScope = false): void {
  if (ref.connectionId !== scope.connectionId) throw new DataSourceError('invalid-request')
  if (requireScope && !ref.scope) throw new DataSourceError('invalid-request')
  if (ref.scope && (ref.scope.connectionId !== ref.connectionId
    || canonicalDataEncoding(ref.scope) !== canonicalDataEncoding(scope))) throw new DataSourceError('invalid-request')
}

/** Resolve an action at press time. The idempotency middleware stores the final response by device and key. */
export async function actOnDataRecord(env: Env, input: unknown, key: string | undefined, invocation: DataSourceInvocation): Promise<{ outcome: 'done' | 'no-longer-available' | 'stale' | 'not-writable' | 'invalid-target' } | { outcome: 'ready'; action: DataRecordAction }> {
  const request = parse(dataSourceActSchema, { ...(typeof input === 'object' && input ? input : {}), idempotencyKey: key }, false)
  const scope = request.ref.scope
  if (!scope) throw new DataSourceError('invalid-request')
  if ('field' in request) {
    return (await import('./fieldMove')).moveDataRecordField(env, request, invocation)
  }
  const current = await invokeDataSource(env, { operation: 'actions', ref: request.ref, scope }, invocation)
  const selected = current.actions.find(item => item.id === request.actionId)
  if (!selected) return { outcome: 'no-longer-available' }
  if (selected.risk !== request.confirmedRisk) return { outcome: 'no-longer-available' }
  if (selected.action.verb !== 'runNodeAction') return { outcome: 'ready', action: selected.action }
  const source = registeredDataSource(request.ref)
  if (!source) throw new DataSourceError('unavailable')
  await authorizeDataSource(env, invocation, scope, source.pluginId, source.providerId)
  await dispatchSource(env, source.pluginId, selected.action.path,
    { ref: request.ref, actionId: request.actionId, idempotencyKey: request.idempotencyKey }, invocation,
    DATA_LIMITS.detailBytes, { providerId: source.providerId, connectionId: scope.connectionId })
  return { outcome: 'done' }
}

async function querySource(
  env: Env,
  source: RegisteredDataSource,
  request: Extract<DataSourceRequest, { operation: 'query' }>,
  description: DataSourceDescription,
  invocation: DataSourceInvocation,
): Promise<DataSourceResult> {
  validateSourceQuery(request.query, description)
  if (request.mode === 'execution' && request.cursor) throw new DataSourceError('invalid-request')
  let cursor = request.cursor
  const cursors = new Set<string>(cursor ? [cursor] : [])
  const identities = new Set<string>()
  const result: DataSourceResult = {
    records: [],
    revision: description.revision,
    readTime: request.evaluationTime,
    completeness: { kind: 'incomplete', cause: 'host-budget' },
    mode: request.mode,
    evaluationTime: request.evaluationTime,
  }
  let bytes = 0
  for (let index = 0; index < DATA_LIMITS.queryPages; index++) {
    await authorizeDataSource(env, invocation, request.query.scope, source.pluginId, source.providerId)
    if (registeredDataSource(source) !== source) throw new DataSourceError('unavailable')
    const pageSize = Math.min(request.pageSize, request.mode === 'preview' ? DATA_LIMITS.previewRecords : DATA_LIMITS.options)
    const page = parse(dataSourcePageSchema, await dispatchRegistered(
      env, source, { ...request, cursor, pageSize }, invocation, DATA_LIMITS.selectionBytes,
    ))
    if (registeredDataSource(source) !== source) throw new DataSourceError('unavailable')
    if (page.records.length > pageSize || page.revision !== description.revision) throw new DataSourceError('invalid-response')
    for (const record of page.records) {
      if (identities.has(record.recordId)) throw new DataSourceError('duplicate-record')
      identities.add(record.recordId)
      try { parseDataValue(record.data, DATA_LIMITS.recordBytes) } catch { throw new DataSourceError('oversize') }
      try { validateDataValue(record.data, description.schema) } catch { throw new DataSourceError('invalid-response') }
      bytes += new TextEncoder().encode(JSON.stringify(record)).byteLength
      if (bytes > DATA_LIMITS.selectionBytes || result.records.length >= DATA_LIMITS.selectionRecords) return result
      if (record.action?.verb === 'runNodeAction' && source.pluginId !== 'core') {
        try { confinePluginPath(source.pluginId, record.action.path) } catch { throw new DataSourceError('invalid-response') }
      }
      if (record.action?.verb === 'openUrl' && !['http:', 'https:'].includes(new URL(record.action.url).protocol)) {
        throw new DataSourceError('invalid-response')
      }
      if (record.target && !record.target.kind.startsWith(`${source.pluginId}.`)) throw new DataSourceError('invalid-response')
      if (new Set(record.actions?.map(action => action.id)).size !== (record.actions?.length ?? 0)) throw new DataSourceError('invalid-response')
      for (const named of record.actions ?? []) if (named.action.verb === 'runNodeAction') {
        try { confinePluginPath(source.pluginId, named.action.path) } catch { throw new DataSourceError('invalid-response') }
      }
      if (record.actions?.some(named => named.action.risk && named.action.risk !== named.risk
        || !description.actions?.some(declared => declared.id === named.id && declared.risk === named.risk))) throw new DataSourceError('invalid-response')
      if (record.writableFields?.some(field => !description.writable?.some(declared => declared.field === field))) throw new DataSourceError('invalid-response')
      const { recordId, ...contents } = record
      result.records.push({
        ...contents,
        ref: {
          pluginId: source.pluginId,
          sourceId: source.sourceId,
          ...(request.query.scope.connectionId ? { connectionId: request.query.scope.connectionId } : {}),
          recordId,
          scope: request.query.scope,
        },
      })
    }
    result.readTime = page.readTime
    if (page.eventCoverage?.length) result.eventCoverage = [...result.eventCoverage ?? [], ...page.eventCoverage].slice(0, 32)
    if (page.completeness.kind === 'more' && cursors.has(page.completeness.cursor)) throw new DataSourceError('cursor-loop')
    if (page.incrementalBoundary !== undefined && (!description.operations.incremental
      || !request.query.incremental || request.mode !== 'execution' || page.completeness.kind !== 'complete')) {
      throw new DataSourceError('invalid-response')
    }
    if (page.completeness.kind === 'bounded' && (!request.query.take
      || (request.mode === 'execution' && result.records.length !== request.query.take))) {
      throw new DataSourceError('invalid-response')
    }
    if (request.query.take && result.records.length > request.query.take) throw new DataSourceError('invalid-response')
    if (page.completeness.kind !== 'more' || request.mode === 'preview') {
      if (request.query.incremental && request.mode === 'execution' && page.completeness.kind === 'complete' && page.incrementalBoundary === undefined) throw new DataSourceError('invalid-response')
      result.completeness = page.completeness
      if (page.incrementalBoundary !== undefined) {
        result.incrementalBoundary = page.incrementalBoundary
      }
      return result
    }
    cursor = page.completeness.cursor
    if (cursors.has(cursor)) throw new DataSourceError('cursor-loop')
    cursors.add(cursor)
  }
  return result
}
