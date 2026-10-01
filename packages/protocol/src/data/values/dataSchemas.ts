import { DATA_LIMITS, canonicalDataEncoding, parseDataPointer, parseDataValue, type DataPrimitive, type DataValue } from './dataValues'

export type DataType = 'string' | 'number' | 'integer' | 'boolean' | 'null' | 'object' | 'array'
export type DataSchema = {
  type: DataType | [Exclude<DataType, 'null'>, 'null']
  properties?: Record<string, DataSchema>
  required?: string[]
  items?: DataSchema
  enum?: DataPrimitive[]
  additionalProperties?: boolean
}

/** Deliberately small JSON Schema subset. Unknown keywords are errors, not ignored promises. */
export function parseDataSchema(input: unknown): DataSchema {
  const raw = parseDataValue(input, DATA_LIMITS.detailBytes, DATA_LIMITS.depth * 3)
  let fields = 0
  function visit(value: DataValue, depth: number): DataSchema {
    if (depth > DATA_LIMITS.depth) throw new Error('Schema nesting exceeds limit')
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected structural schema')
    const keywords = ['type', 'properties', 'required', 'items', 'enum', 'additionalProperties']
    if (Object.keys(value).some(key => !keywords.includes(key))) {
      throw new Error('Unsupported schema keyword')
    }
    const types = Array.isArray(value.type) ? value.type : [value.type]
    const allowed = ['string', 'number', 'integer', 'boolean', 'null', 'object', 'array']
    if (
      types.length < 1 || types.length > 2
      || types.some(type => typeof type !== 'string' || !allowed.includes(type))
      || new Set(types).size !== types.length
      || (types.length === 2 && !types.includes('null'))
    ) throw new Error('Unsupported schema type')
    const primary = types.find(type => type !== 'null') ?? 'null'
    const schema: DataSchema = {
      type: types.length === 2 ? [primary as Exclude<DataType, 'null'>, 'null'] : primary as DataType,
    }
    const hasObjectKeywords = value.properties !== undefined
      || value.required !== undefined || value.additionalProperties !== undefined
    if (primary !== 'object' && hasObjectKeywords) throw new Error('Object keywords require object type')
    if (primary !== 'array' && value.items !== undefined) throw new Error('items requires array type')
    if (primary === 'array') {
      if (value.items === undefined) throw new Error('Array schema requires items')
      schema.items = visit(value.items, depth + 1)
    }
    if (primary === 'object') {
      const properties = value.properties ?? {}
      if (!properties || typeof properties !== 'object' || Array.isArray(properties)) throw new Error('Expected schema properties')
      schema.properties = {}
      for (const [key, property] of Object.entries(properties)) {
        if (!parseDataPointer(`/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`)) throw new Error('Unsafe schema property')
        if (++fields > DATA_LIMITS.fields) throw new Error('Too many schema fields')
        schema.properties[key] = visit(property, depth + 1)
      }
      if (value.required !== undefined) {
        if (
          !Array.isArray(value.required)
          || value.required.some(key => typeof key !== 'string' || !Object.hasOwn(properties, key))
          || new Set(value.required).size !== value.required.length
        ) throw new Error('Invalid required fields')
        schema.required = value.required as string[]
      }
      if (value.additionalProperties !== undefined) {
        if (typeof value.additionalProperties !== 'boolean') throw new Error('additionalProperties must be boolean')
        schema.additionalProperties = value.additionalProperties
      }
    }
    if (value.enum !== undefined) {
      if (
        !Array.isArray(value.enum) || !value.enum.length
        || value.enum.length > DATA_LIMITS.options
        || value.enum.some(item => item !== null && typeof item === 'object')
      ) throw new Error('Invalid primitive enum')
      schema.enum = value.enum as DataPrimitive[]
      for (const item of schema.enum) validateNode(item, { ...schema, enum: undefined })
      if (new Set(schema.enum.map(canonicalDataEncoding)).size !== schema.enum.length) throw new Error('Duplicate enum values')
    }
    return schema
  }
  return visit(raw, 0)
}

function validateNode(value: DataValue, schema: DataSchema): void {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type]
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
  const matchesType = types.some(expected => expected === type
    || (expected === 'integer' && typeof value === 'number' && Number.isInteger(value)))
  if (!matchesType) throw new Error(`Value does not match ${types.join(' or ')}`)
  if (schema.enum && !schema.enum.some(item => item === value)) throw new Error('Value is outside enum')
  if (value === null) return
  if (Array.isArray(value)) {
    for (const item of value) validateNode(item, schema.items!)
    return
  }
  if (typeof value !== 'object') return
  for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) throw new Error(`Missing required field: ${key}`)
  for (const [key, item] of Object.entries(value)) {
    const property = Object.hasOwn(schema.properties ?? {}, key) ? schema.properties![key] : undefined
    if (property) validateNode(item, property)
    else if (schema.additionalProperties === false) throw new Error(`Unexpected field: ${key}`)
  }
}

export function validateDataValue(value: unknown, schema: DataSchema, maxBytes: number = DATA_LIMITS.recordBytes): DataValue {
  const parsedSchema = parseDataSchema(schema)
  const parsed = parseDataValue(value, maxBytes)
  validateNode(parsed, parsedSchema)
  return parsed
}
