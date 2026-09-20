import { expect, it } from 'vitest'
import { compareDataValues, dataBindingSchema, dataFieldsSchema, parseDataPredicate, type DataPredicate } from './dataBindings'
import { DATA_LIMITS, MISSING } from './dataValues'

it('keeps field presentation, query support, and observed information separate', () => {
  const field = { pointer: '/owner', label: 'Owner', origin: 'declared', display: { kind: 'person' }, choices: { kind: 'dynamic', dependsOn: ['/project'] } }
  expect(dataFieldsSchema.parse([field])[0]?.query).toBeUndefined()
  expect(dataFieldsSchema.safeParse([{ ...field, origin: 'observed' }]).success).toBe(false)
  expect(dataFieldsSchema.safeParse([{ ...field, description: 'a'.repeat(DATA_LIMITS.descriptionChars) }]).success).toBe(true)
  expect(dataFieldsSchema.safeParse([{ ...field, description: 'a'.repeat(DATA_LIMITS.descriptionChars + 1) }]).success).toBe(false)
  expect(dataFieldsSchema.safeParse([field, field]).success).toBe(false)
  expect(dataFieldsSchema.safeParse([{ ...field, label: 'a'.repeat(DATA_LIMITS.labelChars + 1) }]).success).toBe(false)
})

it('accepts typed bindings and explicit fallback and rejects unsafe addresses', () => {
  expect(dataBindingSchema.parse({ address: { from: 'item', pointer: '' }, fallback: null })).toEqual({ address: { from: 'item', pointer: '' }, fallback: null })
  expect(dataBindingSchema.safeParse({ address: { from: 'step', stepId: 'stable', pointer: '/constructor' } }).success).toBe(false)
  expect(dataBindingSchema.safeParse({ address: { from: 'literal', value: { ok: true } }, conversion: 'json-to-text' }).success).toBe(true)
})

it('bounds predicates and validates presence operand counts', () => {
  const comparison: DataPredicate = { kind: 'comparison', left: { address: { from: 'item', pointer: '/x' } }, operator: 'present' }
  let predicate: DataPredicate = comparison
  for (let i = 0; i < DATA_LIMITS.predicateDepth; i++) predicate = { kind: 'all', predicates: [predicate] }
  expect(parseDataPredicate(predicate)).toEqual(predicate)
  expect(() => parseDataPredicate({ kind: 'any', predicates: [predicate] })).toThrow()
  expect(parseDataPredicate({ kind: 'all', predicates: Array(DATA_LIMITS.comparisons).fill(comparison) })).toBeDefined()
  expect(() => parseDataPredicate({ kind: 'all', predicates: Array(DATA_LIMITS.comparisons + 1).fill(comparison) })).toThrow()
  expect(() => parseDataPredicate({ ...comparison, operator: 'eq' })).toThrow()
  expect(() => parseDataPredicate({ ...comparison, right: { address: { from: 'literal', value: null } } })).toThrow()
})

it('compares primitives without coercion or missing/null ambiguity', () => {
  expect(compareDataValues(MISSING, 'missing')).toBe(true)
  expect(compareDataValues(null, 'present')).toBe(true)
  expect(compareDataValues(1, 'eq', '1')).toBe(false)
  expect(compareDataValues(1, 'ne', '1')).toBe(true)
  expect(compareDataValues(1, 'lt', 2)).toBe(true)
  expect(compareDataValues(2, 'lte', 2)).toBe(true)
  expect(compareDataValues('b', 'gt', 'a')).toBe(true)
  expect(compareDataValues(2, 'gte', 2)).toBe(true)
  expect(compareDataValues('abc', 'contains', 'b')).toBe(true)
  expect(compareDataValues([1, 2], 'contains', 2)).toBe(true)
  expect(compareDataValues(1, 'in', ['1', 1])).toBe(true)
  for (const values of [[MISSING, 1], [1, '2'], [null, 2]] as const) expect(() => compareDataValues(values[0], 'gt', values[1])).toThrow()
  expect(() => compareDataValues({}, 'eq', {})).toThrow()
})
