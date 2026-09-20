import { describe, expect, it } from 'vitest'
import { objectSchema, removeObjectField, schemaForType, setObjectField, uniqueFieldName } from './schemaFields'

describe('structured output fields', () => {
  it('renames a required field without changing its position', () => {
    const schema = { type: 'object' as const, properties: { verdict: { type: 'boolean' as const }, note: { type: 'string' as const } }, required: ['verdict'] }
    expect(setObjectField(schema, 'verdict', 'requiresWork', schemaForType('boolean'), true)).toEqual({
      type: 'object', properties: { requiresWork: { type: 'boolean' }, note: { type: 'string' } }, required: ['requiresWork'],
    })
  })

  it('supports nested objects and lists without schema text', () => {
    const nested = setObjectField(objectSchema(undefined), '', 'items', {
      type: 'array', items: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    }, true)
    expect(nested.properties?.items?.items?.properties?.id).toEqual({ type: 'string' })
    expect(removeObjectField(nested, 'items').properties).toEqual({})
    expect(uniqueFieldName({ type: 'object', properties: { field: { type: 'string' } } })).toBe('field2')
  })
})
