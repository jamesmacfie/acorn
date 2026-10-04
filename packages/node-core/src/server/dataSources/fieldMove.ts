import type { DataRecordRef, DataSourceDescription } from '@acorn/protocol/dataSources.ts'
import { DATA_LIMITS, MISSING, canonicalDataEncoding, readDataPointer, type DataValue } from '@acorn/protocol/dataValues.ts'
import type { Env } from '../bindings'
import { authorizeDataSource, type DataSourceInvocation } from './authority'
import { dispatchSource } from './dispatch'
import { dataSourceAvailableInScope, registeredDataSource } from './registry'
import { DataSourceError } from './validation'
import { sourceFieldSchema } from './validation'
import { validateDataValue } from '@acorn/protocol/dataSchemas.ts'
import { confinePluginPath } from '../pluginHost/dispatch'
import { invokeDataSource } from './runtime'

type FieldMove = { ref: DataRecordRef; field: string; expected: DataValue; target: DataValue;
  confirmedRisk: 'read' | 'write' | 'execute'; idempotencyKey: string }

export function validateWritableDescription(description: DataSourceDescription, pluginId: string): void {
  if (!description.operations.details || pluginId === 'core'
    || new Set(description.writable?.map(field => field.field)).size !== (description.writable?.length ?? 0)) throw new DataSourceError('invalid-response')
  for (const writable of description.writable ?? []) {
    const field = description.fields.find(candidate => candidate.pointer === writable.field)
    const schema = sourceFieldSchema(description.schema, writable.field)
    if (!field || !schema || writable.risk === 'read') throw new DataSourceError('invalid-response')
    try { confinePluginPath(pluginId, writable.path) } catch { throw new DataSourceError('invalid-response') }
    for (const value of writable.values) {
      try { validateDataValue(value, schema) } catch { throw new DataSourceError('invalid-response') }
      if (value !== null && field.choices?.kind === 'static'
        && !field.choices.values.some(choice => canonicalDataEncoding(choice.id) === canonicalDataEncoding(value))) throw new DataSourceError('invalid-response')
    }
  }
}

/** A fresh detail read and declaration check precede every field mutation. */
export async function moveDataRecordField(env: Env, request: FieldMove, invocation: DataSourceInvocation): Promise<{
  outcome: 'done' | 'stale' | 'not-writable' | 'invalid-target'
}> {
  if (invocation.principal.kind !== 'device') throw new DataSourceError('forbidden')
  const scope = request.ref.scope
  if (!scope || request.ref.connectionId !== scope.connectionId) throw new DataSourceError('invalid-request')
  const source = registeredDataSource(request.ref)
  if (!source || !dataSourceAvailableInScope(source, scope)) throw new DataSourceError('unavailable')
  invocation = { ...invocation, signal: AbortSignal.any([invocation.signal, AbortSignal.timeout(DATA_LIMITS.queryMs)]) }
  await authorizeDataSource(env, invocation, scope, source.pluginId, source.providerId)
  const description = await invokeDataSource(env, { operation: 'describe', source: { pluginId: source.pluginId, sourceId: source.sourceId }, scope }, invocation)
  const writable = description.writable?.find(field => field.field === request.field)
  if (!writable || !description.operations.details || writable.risk !== request.confirmedRisk) return { outcome: 'not-writable' }
  if (!writable.values.some(value => canonicalDataEncoding(value) === canonicalDataEncoding(request.target))) return { outcome: 'invalid-target' }
  const detail = await invokeDataSource(env, { operation: 'details', ref: request.ref, scope, projection: [request.field] }, invocation)
  if (detail.kind !== 'found') return { outcome: 'stale' }
  if (detail.writableFields && !detail.writableFields.includes(request.field)) return { outcome: 'not-writable' }
  const current = readDataPointer(detail.data, request.field)
  if (current === MISSING || canonicalDataEncoding(current) !== canonicalDataEncoding(request.expected)
    || canonicalDataEncoding(current) === canonicalDataEncoding(request.target)) return { outcome: 'stale' }
  if (registeredDataSource(request.ref) !== source) return { outcome: 'not-writable' }
  await authorizeDataSource(env, invocation, scope, source.pluginId, source.providerId)
  const response = await dispatchSource(env, source.pluginId, writable.path,
    { ref: request.ref, field: request.field, expected: request.expected, target: request.target, idempotencyKey: request.idempotencyKey }, invocation,
    DATA_LIMITS.detailBytes, { providerId: source.providerId, connectionId: scope.connectionId })
  if (typeof response !== 'object' || response === null || !('outcome' in response)
    || !['done', 'stale', 'not-writable', 'invalid-target'].includes(String(response.outcome))) throw new DataSourceError('invalid-response')
  return { outcome: response.outcome as 'done' | 'stale' | 'not-writable' | 'invalid-target' }
}
