import { type DataSourceDescription, type DataSourceQuery } from '@acorn/protocol/dataSources.ts'
import { type DataField, type DataPredicate } from '@acorn/protocol/dataBindings.ts'
import { validateDataValue, type DataSchema } from '@acorn/protocol/dataSchemas.ts'
import { MISSING, parseDataPointer, readDataPointer } from '@acorn/protocol/dataValues.ts'

export type DataSourceErrorCode = 'unavailable' | 'forbidden' | 'invalid-request' | 'invalid-response' | 'unsupported-query' | 'connection-required' | 'cancelled' | 'timeout' | 'duplicate-record' | 'cursor-loop' | 'provider-failure' | 'rate-limited' | 'oversize'
  | 'input-required' | 'input-unavailable'
/** `input` names the derived-source input at fault, so a client can say which account to fix. */
export type DataSourceErrorDetail = { input?: string; reason?: string }
export class DataSourceError extends Error {
  constructor(readonly code: DataSourceErrorCode, readonly detail?: DataSourceErrorDetail) {
    super([code, detail?.input && `input ${detail.input}`, detail?.reason].filter(Boolean).join(': '))
  }
}

export function sourceFieldSchema(schema: DataSchema, pointer: string): DataSchema | undefined {
  const keys = parseDataPointer(pointer)
  if (!keys) return undefined
  let current = schema
  for (const key of keys) {
    const next = current.properties && Object.hasOwn(current.properties, key) ? current.properties[key] : undefined
    if (!next) return undefined
    current = next
  }
  return current
}

export function validateDescription(description: DataSourceDescription): void {
  if (description.operations.incremental !== !!description.incremental) throw new DataSourceError('invalid-response')
  if (description.operations.details !== !!description.detailSchema) throw new DataSourceError('invalid-response')
  if (description.projectScope) {
    const { parameter, record } = description.projectScope
    const parameterSchema = sourceFieldSchema(description.parameters, parameter)
    const recordSchema = sourceFieldSchema(description.schema, record)
    if (!/^\/[^/~]+$/.test(parameter) || recordSchema?.type !== 'string'
      || !(parameterSchema?.type === 'string' || parameterSchema?.type === 'array' && parameterSchema.items?.type === 'string')) {
      throw new DataSourceError('invalid-response')
    }
  }
  const fields = new Map(description.parameterFields.map(field => [field.pointer, field]))
  for (const [schema, metadata] of [[description.schema, description.fields], [description.parameters, description.parameterFields]] as const) {
    for (const field of metadata) {
      if (field.origin !== 'observed' && !sourceFieldSchema(schema, field.pointer)) throw new DataSourceError('invalid-response')
      if (field.choices?.kind === 'dynamic' && field.choices.dependsOn.some(pointer => !fields.has(pointer))) throw new DataSourceError('invalid-response')
    }
  }
  const active = new Set<string>()
  const complete = new Set<string>()
  function visit(field: DataField): void {
    if (active.has(field.pointer)) throw new DataSourceError('invalid-response')
    if (complete.has(field.pointer)) return
    active.add(field.pointer)
    if (field.choices?.kind === 'dynamic') for (const pointer of field.choices.dependsOn) {
      const parent = fields.get(pointer)
      if (!parent) throw new DataSourceError('invalid-response')
      visit(parent)
    }
    active.delete(field.pointer)
    complete.add(field.pointer)
  }
  description.parameterFields.forEach(visit)
}

export function validateSourceQuery(query: DataSourceQuery, description: DataSourceDescription): void {
  if (query.incremental && !description.operations.incremental) throw new DataSourceError('unsupported-query')
  try { validateDataValue(query.scope.parameters, description.parameters) } catch { throw new DataSourceError('invalid-request') }
  const fields = new Map(description.fields.map(field => [field.pointer, field]))
  function visit(predicate: DataPredicate): void {
    if (predicate.kind !== 'comparison') {
      if (!description.operations.groups.includes(predicate.kind)) throw new DataSourceError('unsupported-query')
      predicate.predicates.forEach(visit)
      return
    }
    const left = predicate.left.address
    if (left.from !== 'item' || predicate.left.conversion || predicate.left.fallback !== undefined
      || (predicate.right && (predicate.right.address.from !== 'literal' || predicate.right.conversion))) throw new DataSourceError('unsupported-query')
    if (!fields.get(left.pointer)?.query?.operators.includes(predicate.operator)) throw new DataSourceError('unsupported-query')
    const field = fields.get(left.pointer)!
    if (field.choices?.kind === 'dynamic' && field.choices.dependsOn.some(pointer => readDataPointer(query.scope.parameters, pointer) === MISSING)) throw new DataSourceError('invalid-request')
    if (predicate.right?.address.from === 'literal') {
      const operand = predicate.right.address.value
      const schema = sourceFieldSchema(description.schema, left.pointer)
      if (!schema) throw new DataSourceError('unsupported-query')
      const operands = predicate.operator === 'in' ? (Array.isArray(operand) ? operand : null) : [operand]
      if (!operands) throw new DataSourceError('invalid-request')
      for (const item of operands) {
        try { validateDataValue(item, predicate.operator === 'contains' && schema.items ? schema.items : schema) } catch { throw new DataSourceError('invalid-request') }
        if (field.choices?.kind === 'static' && !field.choices.values.some(choice => choice.id === item)) throw new DataSourceError('invalid-request')
      }
    }
  }
  if (query.predicate) visit(query.predicate)
  for (const sort of query.sort) if (!fields.get(sort.pointer)?.query?.sortable) throw new DataSourceError('unsupported-query')
}
