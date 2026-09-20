import type { DataSchema, DataType } from '@acorn/protocol/dataSchemas.ts'

export const FIELD_TYPES = ['string', 'number', 'integer', 'boolean', 'object', 'array'] as const
export type EditableFieldType = typeof FIELD_TYPES[number]

export const objectSchema = (schema: unknown): DataSchema => {
  if (schema && typeof schema === 'object' && !Array.isArray(schema) && (schema as DataSchema).type === 'object') {
    const value = schema as DataSchema
    return { ...value, properties: { ...value.properties }, required: [...(value.required ?? [])] }
  }
  return { type: 'object', properties: {}, required: [] }
}

export function schemaForType(type: EditableFieldType): DataSchema {
  if (type === 'object') return { type, properties: {}, required: [] }
  if (type === 'array') return { type, items: { type: 'string' } }
  return { type }
}

export function schemaPrimaryType(schema: DataSchema): DataType {
  return Array.isArray(schema.type) ? schema.type.find(type => type !== 'null')! : schema.type
}

export function uniqueFieldName(schema: DataSchema): string {
  const taken = new Set(Object.keys(schema.properties ?? {}))
  let name = 'field'
  for (let suffix = 2; taken.has(name); suffix += 1) name = `field${suffix}`
  return name
}

export function setObjectField(
  schema: DataSchema,
  oldName: string,
  nextName: string,
  value: DataSchema,
  required: boolean,
): DataSchema {
  const root = objectSchema(schema)
  const properties: Record<string, DataSchema> = {}
  for (const [name, field] of Object.entries(root.properties ?? {})) {
    if (name === oldName) properties[nextName] = value
    else properties[name] = field
  }
  if (!Object.hasOwn(root.properties ?? {}, oldName)) properties[nextName] = value
  const requiredFields = new Set((root.required ?? []).filter(name => name !== oldName))
  if (required) requiredFields.add(nextName)
  return { ...root, properties, required: [...requiredFields] }
}

export function removeObjectField(schema: DataSchema, name: string): DataSchema {
  const root = objectSchema(schema)
  const properties = { ...root.properties }
  delete properties[name]
  return { ...root, properties, required: (root.required ?? []).filter(field => field !== name) }
}
