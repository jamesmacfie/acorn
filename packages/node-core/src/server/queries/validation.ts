import type { QueryContent } from '@acorn/protocol/dataQueries.ts'
import type { DataBinding, DataPredicate } from '@acorn/protocol/dataBindings.ts'
import { resolveDataBinding } from '@acorn/protocol/dataQueryResolution.ts'
import type { DataSourceDescription, DataSourceQuery } from '@acorn/protocol/dataSources.ts'
import { type DataSchema, validateDataValue } from '@acorn/protocol/dataSchemas.ts'
import { MISSING, readDataPointer } from '@acorn/protocol/dataValues.ts'
import { sourceFieldSchema, validateSourceQuery } from '../dataSources/validation'
import { invokeDataSource } from '../dataSources/runtime'
import type { Env } from '../bindings'
import type { DataSourceInvocation } from '../dataSources/authority'

function assignable(source: DataSchema, target: DataSchema): boolean {
  const sourceTypes = Array.isArray(source.type) ? source.type : [source.type]
  const targetTypes = Array.isArray(target.type) ? target.type : [target.type]
  if (sourceTypes.some(type => !targetTypes.includes(type) && !(type === 'integer' && targetTypes.includes('number')))) return false
  if (target.enum && (!source.enum || source.enum.some(value => !target.enum!.includes(value)))) return false
  if (target.items && (!source.items || !assignable(source.items, target.items))) return false
  if (target.properties) {
    if ((target.required ?? []).some(key => !source.required?.includes(key))) return false
    for (const [key, property] of Object.entries(source.properties ?? {})) {
      if (Object.hasOwn(target.properties, key)) { if (!assignable(property, target.properties[key]!)) return false }
      else if (target.additionalProperties === false) return false
    }
    if (target.additionalProperties === false && source.additionalProperties !== false) return false
  }
  return true
}
/** Validate declared input types independently of the values used to discover dynamic metadata. */
export function validateQueryTemplate(content: QueryContent, description: DataSourceDescription): void {
  function binding(value: DataBinding, expected: DataSchema): void {
    const address = value.address
    if (address.from === 'literal') {
      validateDataValue(resolveDataBinding(value, {}), expected)
      return
    }
    if (address.from === 'context') {
      if (address.name === 'viewer') {
        if (!description.operations.identity || !description.fields.some(field => field.viewerMatch === address.pointer)) throw new Error('Source does not declare this viewer identity field')
      } else if (address.name === 'workspaceLinks') {
        if (expected.type !== 'array' || expected.items?.type !== 'string') throw new Error('Workspace links require a string-list parameter')
      } else if (expected.type !== 'number' && expected.type !== 'string') throw new Error('Time context requires a datetime field')
      return
    }
    if (address.from !== 'input' || !Object.hasOwn(content.parameters.properties ?? {}, address.name)) throw new Error('Undeclared query parameter')
    const declaration = content.parameters.properties![address.name]!
    const selected = sourceFieldSchema(declaration, address.pointer)
    if (!selected) throw new Error('Unavailable parameter field')
    const output: DataSchema = value.conversion ? { type: 'string' } : selected
    if (value.conversion === 'scalar-to-text' && (selected.type === 'object' || selected.type === 'array' || Array.isArray(selected.type) && selected.type.some(type => type === 'object' || type === 'array'))) throw new Error('Invalid scalar conversion')
    if (!assignable(output, expected)) throw new Error('Query parameter type is incompatible')
    if (value.fallback !== undefined) validateDataValue(value.fallback, expected)
  }
  if (content.connection) binding(content.connection, { type: 'string' })
  for (const [key, value] of Object.entries(content.sourceParameters)) {
    const expected = Object.hasOwn(description.parameters.properties ?? {}, key) ? description.parameters.properties![key] : undefined
    if (!expected) throw new Error('Unavailable source parameter')
    binding(value, expected)
  }
  function predicate(value: DataPredicate): void {
    if (value.kind !== 'comparison') { value.predicates.forEach(predicate); return }
    if (value.left.address.from !== 'item' || value.left.conversion || value.left.fallback !== undefined) throw new Error('Invalid query field binding')
    const expected = sourceFieldSchema(description.schema, value.left.address.pointer)
    if (!expected) throw new Error('Unavailable query field')
    if (value.right) binding(value.right, value.operator === 'in' ? { type: 'array', items: expected }
      : value.operator === 'contains' && expected.items ? expected.items : expected)
  }
  if (content.query.predicate) predicate(content.query.predicate)
}

/** Metadata-only membership checks; never fetch records to decide whether publication is valid. */
export async function validateQueryChoices(env: Env, query: DataSourceQuery, description: DataSourceDescription, invocation: DataSourceInvocation): Promise<void> {
  validateSourceQuery(query, description)
  const selections: { target: 'field' | 'parameter'; pointer: string; values: unknown[] }[] = []
  for (const field of description.parameterFields) {
    const value = readDataPointer(query.scope.parameters, field.pointer)
    if (value === MISSING) continue
    // A list parameter holds several choices. Each one is checked, not the array as a whole.
    const values = Array.isArray(value) ? value : [value]
    const choices = field.choices
    if (choices?.kind === 'static' && values.some(entry => !choices.values.some(choice => choice.id === entry))) throw new Error('Unavailable parameter choice')
    if (choices?.kind === 'dynamic') selections.push({ target: 'parameter', pointer: field.pointer, values })
  }
  function predicate(value: DataPredicate): void {
    if (value.kind !== 'comparison') { value.predicates.forEach(predicate); return }
    if (value.left.address.from !== 'item' || value.right?.address.from !== 'literal') return
    const field = description.fields.find(field => field.pointer === (value.left.address as { pointer: string }).pointer)
    if (field?.choices?.kind === 'dynamic') selections.push({ target: 'field', pointer: field.pointer, values: value.operator === 'in' && Array.isArray(value.right.address.value) ? value.right.address.value : [value.right.address.value] })
  }
  if (query.predicate) predicate(query.predicate)
  for (const selection of selections) {
    const remaining = new Set(selection.values)
    let cursor: string | undefined
    const seen = new Set<string>()
    for (let page = 0; remaining.size && page < 100; page++) {
      const options = await invokeDataSource(env, { operation: 'options', source: query.source, scope: query.scope, target: selection.target, pointer: selection.pointer, search: '', pageSize: 100, ...(cursor ? { cursor } : {}) }, invocation)
      for (const option of options.options) remaining.delete(option.id)
      if (!remaining.size) break
      if (options.exhausted || !options.nextCursor || seen.has(options.nextCursor)) break
      seen.add(options.nextCursor)
      cursor = options.nextCursor
    }
    if (remaining.size) throw new Error('Selected choice is unavailable or could not be validated')
  }
}
