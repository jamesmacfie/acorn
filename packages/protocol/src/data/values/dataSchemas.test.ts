import { expect, it } from 'vitest'
import { DATA_LIMITS } from './dataValues'
import { parseDataSchema, validateDataValue, type DataSchema } from './dataSchemas'

it('validates nested records with optional, nullable, and additional fields', () => {
  const schema = parseDataSchema({
    type: 'object',
    properties: {
      id: { type: 'string' },
      owner: { type: ['null', 'object'], properties: { name: { type: 'string' } } },
      items: { type: 'array', items: { type: 'integer' } },
    },
    required: ['id'],
  })
  const record = { id: '1', owner: null, items: [1, 2], observed: true }
  expect(validateDataValue(record, schema)).toEqual(record)
  expect(validateDataValue({ id: '1' }, schema)).toEqual({ id: '1' })
  expect(() => validateDataValue({ id: null }, schema)).toThrow()
  expect(() => validateDataValue({}, schema)).toThrow()
  expect(() => validateDataValue({ id: '1', items: [1.1] }, schema)).toThrow()
})

it('rejects unsupported constructs and inconsistent schema declarations', () => {
  const invalidSchemas = [
    { type: 'string', default: 'x' }, { $ref: 'remote' }, { type: ['string', 'number'] },
    { type: 'string', items: { type: 'string' } }, { type: 'array' },
    { type: 'object', required: ['undeclared'] }, { type: 'object', additionalProperties: { type: 'string' } },
    { type: 'string', enum: [1] }, { type: 'string', enum: ['x', 'x'] },
    { type: 'object', properties: { constructor: { type: 'string' } } },
  ]
  for (const schema of invalidSchemas) expect(() => parseDataSchema(schema)).toThrow()
  expect(() => validateDataValue({ extra: true }, { type: 'object', additionalProperties: false })).toThrow()
})

it('enforces structural depth, described fields, enums, and value bytes at their boundaries', () => {
  let schema: DataSchema = { type: 'string' }
  for (let depth = 0; depth < DATA_LIMITS.depth; depth++) schema = { type: 'object', properties: { child: schema } }
  expect(parseDataSchema(schema)).toEqual(schema)
  expect(() => parseDataSchema({ type: 'array', items: schema })).toThrow()
  const properties = Object.fromEntries(Array.from({ length: DATA_LIMITS.fields }, (_, i) => [`f${i}`, { type: 'string' }]))
  expect(parseDataSchema({ type: 'object', properties }).properties).toEqual(properties)
  expect(() => parseDataSchema({ type: 'object', properties: { ...properties, extra: { type: 'string' } } })).toThrow()
  const choices = Array.from({ length: DATA_LIMITS.options }, (_, i) => i)
  expect(parseDataSchema({ type: 'number', enum: choices }).enum).toEqual(choices)
  expect(() => parseDataSchema({ type: 'number', enum: [...choices, 100] })).toThrow()
  expect(validateDataValue('x'.repeat(DATA_LIMITS.recordBytes - 2), { type: 'string' })).toHaveLength(DATA_LIMITS.recordBytes - 2)
  expect(() => validateDataValue('x'.repeat(DATA_LIMITS.recordBytes - 1), { type: 'string' })).toThrow()
})

it('names the field a value fails at', () => {
  const schema = parseDataSchema({ type: 'object', properties: { status: { type: 'string', enum: ['ready', 'blocked'] },
    'a/b': { type: 'array', items: { type: 'number' } } }, required: ['status'] })
  const failure = (value: unknown) => { try { validateDataValue(value, schema) } catch (error) { return error } }
  expect(failure({ status: 'needs-qa' })).toMatchObject({ pointer: '/status', message: '"needs-qa" isn\'t a declared choice' })
  expect(failure({ status: 'ready', 'a/b': [1, 'x'] })).toMatchObject({ pointer: '/a~1b/1' })
  expect(failure({})).toMatchObject({ pointer: '/status', message: 'Missing required field: status' })
  expect(failure({ status: 'ready' })).toBeUndefined()
})
