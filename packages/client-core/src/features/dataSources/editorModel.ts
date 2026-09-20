import type { DataField, DataOperator, DataPredicate } from '@acorn/protocol/dataBindings.ts'
import type { DataSourceDescription, DataSourceQuery, DataSourceResult } from '@acorn/protocol/dataSources.ts'
import type { DataSchema } from '@acorn/protocol/dataSchemas.ts'
import { MISSING, canonicalDataEncoding, parseDataPointer, readDataPointer, type DataValue } from '@acorn/protocol/dataValues.ts'

export type QueryEditResult = { query: DataSourceQuery; invalidated: string[] }

const encodePointerPart = (value: string) => value.replace(/~/g, '~0').replace(/\//g, '~1')

export function schemaAtPointer(schema: DataSchema, pointer: string): DataSchema | undefined {
  const parts = parseDataPointer(pointer)
  if (!parts) return undefined
  let current = schema
  for (const part of parts) {
    const type = Array.isArray(current.type) ? current.type.find(value => value !== 'null') : current.type
    if (type !== 'object' || !current.properties || !Object.hasOwn(current.properties, part)) return undefined
    current = current.properties[part]!
  }
  return current
}

function writePointer(root: Record<string, DataValue>, pointer: string, value: DataValue | typeof MISSING): Record<string, DataValue> {
  const parts = parseDataPointer(pointer)
  if (!parts?.length) return value === MISSING || !value || typeof value !== 'object' || Array.isArray(value) ? {} : value
  const next = structuredClone(root)
  let cursor: Record<string, DataValue> = next
  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      if (value === MISSING) delete cursor[part]
      else cursor[part] = value
      return
    }
    const existing = cursor[part]
    const child = existing && typeof existing === 'object' && !Array.isArray(existing) ? structuredClone(existing) : {}
    cursor[part] = child
    cursor = child
  })
  return next
}

function removeComparisons(predicate: DataPredicate | undefined, pointers: ReadonlySet<string>): DataPredicate | undefined {
  if (!predicate) return undefined
  if (predicate.kind === 'comparison') {
    return predicate.left.address.from === 'item' && pointers.has(predicate.left.address.pointer) ? undefined : predicate
  }
  const predicates = predicate.predicates.map(child => removeComparisons(child, pointers)).filter((child): child is DataPredicate => !!child)
  return predicates.length ? { ...predicate, predicates } : undefined
}

/** Change one declared scope parameter and clear every dependent parameter/filter transitively. */
export function setScopeParameter(
  query: DataSourceQuery,
  description: DataSourceDescription,
  pointer: string,
  value: DataValue | typeof MISSING,
): QueryEditResult {
  const changed = canonicalDataEncoding(query.scope.parameters) !== canonicalDataEncoding(writePointer(query.scope.parameters, pointer, value))
  if (!changed) return { query, invalidated: [] }
  const invalidated = new Set<string>()
  let advanced = true
  while (advanced) {
    advanced = false
    for (const field of [...description.parameterFields, ...description.fields]) {
      if (field.choices?.kind !== 'dynamic' || invalidated.has(field.pointer) || field.pointer === pointer) continue
      if (field.choices.dependsOn.some(parent => parent === pointer || invalidated.has(parent))) {
        invalidated.add(field.pointer)
        advanced = true
      }
    }
  }
  let parameters = writePointer(query.scope.parameters, pointer, value)
  for (const field of description.parameterFields) if (invalidated.has(field.pointer)) {
    parameters = writePointer(parameters, field.pointer, MISSING)
  }
  const predicate = removeComparisons(query.predicate, invalidated)
  const { predicate: _oldPredicate, ...rest } = query
  return {
    query: { ...rest, scope: { ...query.scope, parameters }, ...(predicate ? { predicate } : {}) },
    invalidated: [...invalidated],
  }
}

export const literalBinding = (value: DataValue) => ({ address: { from: 'literal' as const, value } })
export const itemBinding = (pointer: string) => ({ address: { from: 'item' as const, pointer } })

export function initialComparison(field: DataField, schema: DataSchema): DataPredicate {
  const operator = field.query?.operators[0] ?? 'eq'
  const type = Array.isArray(schema.type) ? schema.type.find(value => value !== 'null') : schema.type
  const value: DataValue = field.choices?.kind === 'static' && field.choices.values[0]
    ? field.choices.values[0].id
    : type === 'boolean' ? false : type === 'number' || type === 'integer' ? 0 : type === 'array' ? [] : ''
  return {
    kind: 'comparison', left: itemBinding(field.pointer), operator,
    ...(['missing', 'present'].includes(operator) ? {} : { right: literalBinding(operator === 'in' ? [value] : value) }),
  }
}

export function replaceComparisonField(predicate: Extract<DataPredicate, { kind: 'comparison' }>, field: DataField, schema: DataSchema): DataPredicate {
  const next = initialComparison(field, schema) as Extract<DataPredicate, { kind: 'comparison' }>
  return { ...next, operator: field.query?.operators.includes(predicate.operator) ? predicate.operator : next.operator }
}

export function replaceComparisonOperator(predicate: Extract<DataPredicate, { kind: 'comparison' }>, operator: DataOperator, schema: DataSchema): DataPredicate {
  if (['missing', 'present'].includes(operator)) return { ...predicate, operator, right: undefined }
  if (predicate.right) return { ...predicate, operator }
  const type = Array.isArray(schema.type) ? schema.type.find(value => value !== 'null') : schema.type
  const value: DataValue = type === 'boolean' ? false : type === 'number' || type === 'integer' ? 0 : ''
  return { ...predicate, operator, right: literalBinding(operator === 'in' ? [value] : value) }
}

export type PreviewToken = { generation: number; digest: string }
export type PreviewState = {
  generation: number
  currentDigest: string
  requestedDigest?: string
  result?: DataSourceResult
  error?: string
  loading: boolean
}

export const initialPreviewState = (digest: string): PreviewState => ({ generation: 0, currentDigest: digest, loading: false })
export const editPreview = (state: PreviewState, digest: string): PreviewState => ({ ...state, currentDigest: digest })
export function beginPreview(state: PreviewState): { state: PreviewState; token: PreviewToken } {
  const token = { generation: state.generation + 1, digest: state.currentDigest }
  return { token, state: { ...state, generation: token.generation, requestedDigest: token.digest, loading: true, error: undefined } }
}
export function resolvePreview(state: PreviewState, token: PreviewToken, result: DataSourceResult): PreviewState {
  return token.generation === state.generation
    ? { ...state, requestedDigest: token.digest, result, loading: false, error: undefined }
    : state
}
export function failPreview(state: PreviewState, token: PreviewToken, error: string): PreviewState {
  return token.generation === state.generation ? { ...state, requestedDigest: token.digest, loading: false, error } : state
}
export const previewIsStale = (state: PreviewState): boolean => !!state.result && state.requestedDigest !== state.currentDigest

export function observedFields(records: readonly { data: DataValue }[], described: readonly DataField[]): DataField[] {
  const known = new Set(described.map(field => field.pointer))
  const observed = new Map<string, DataField>()
  const visit = (value: DataValue, pointer: string): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    for (const [key, child] of Object.entries(value)) {
      const childPointer = `${pointer}/${encodePointerPart(key)}`
      if (!known.has(childPointer) && !observed.has(childPointer)) {
        observed.set(childPointer, { pointer: childPointer, label: key, origin: 'observed' })
      }
      visit(child, childPointer)
    }
  }
  records.forEach(record => visit(record.data, ''))
  return [...observed.values()]
}

export function valueAt(value: DataValue, pointer: string): DataValue | undefined {
  const selected = readDataPointer(value, pointer)
  return selected === MISSING ? undefined : selected
}
