import { z } from 'zod'

// Bounds for manifest-carried schemas. These are protocol constants because an authoring tool, the
// node parser and the runtime validator must all describe the same accepted language.
export const PLUGIN_TOOL_SCHEMA_MAX_BYTES = 64 * 1024
export const PLUGIN_TOOL_SCHEMA_MAX_DEPTH = 8
export const PLUGIN_TOOL_SCHEMA_MAX_PROPERTIES = 64
export const PLUGIN_TOOL_SCHEMA_MAX_ENUM_VALUES = 64
export const PLUGIN_TOOL_TIMEOUT_MAX_MS = 30_000
export const PLUGIN_TOOL_OUTPUT_MAX_BYTES = 256 * 1024
export const PLUGIN_CONTEXT_TIMEOUT_MAX_MS = 15_000
export const PLUGIN_CONTEXT_SECTION_MAX_BYTES = 64 * 1024
export const PLUGIN_CONTEXT_SECTION_MAX_TOKENS = 16_384

const SUPPORTED_SCHEMA_KEYS = new Set([
  'type', 'description', 'properties', 'required', 'additionalProperties', 'items', 'enum',
  'minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems',
])
const TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])

const jsonBytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength

const nonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0
const finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function inspectSchema(value: unknown, path: (string | number)[], depth: number, issue: (path: (string | number)[], message: string) => void): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    issue(path, 'must be a JSON Schema object')
    return
  }
  if (depth > PLUGIN_TOOL_SCHEMA_MAX_DEPTH) {
    issue(path, `exceeds the maximum nesting depth of ${PLUGIN_TOOL_SCHEMA_MAX_DEPTH}`)
    return
  }
  const schema = value as Record<string, unknown>
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED_SCHEMA_KEYS.has(key)) issue([...path, key], `unsupported JSON Schema keyword '${key}'`)
  }
  if (typeof schema.type !== 'string' || !TYPES.has(schema.type)) {
    issue([...path, 'type'], 'must be one supported scalar, object, or array type')
  }
  if (schema.description !== undefined && typeof schema.description !== 'string') {
    issue([...path, 'description'], 'must be a string')
  }
  if (schema.enum !== undefined) {
    if (!Array.isArray(schema.enum) || schema.enum.length === 0 || schema.enum.length > PLUGIN_TOOL_SCHEMA_MAX_ENUM_VALUES) {
      issue([...path, 'enum'], `must contain 1-${PLUGIN_TOOL_SCHEMA_MAX_ENUM_VALUES} JSON values`)
    } else if (schema.enum.some((entry) => entry !== null && !['string', 'number', 'boolean'].includes(typeof entry))) {
      issue([...path, 'enum'], 'values must be JSON scalars')
    }
  }
  if (schema.type === 'object') {
    if (schema.properties !== undefined && (!schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties))) {
      issue([...path, 'properties'], 'must be an object')
    } else {
      const properties = Object.entries((schema.properties ?? {}) as Record<string, unknown>)
      if (properties.length > PLUGIN_TOOL_SCHEMA_MAX_PROPERTIES) {
        issue([...path, 'properties'], `may declare at most ${PLUGIN_TOOL_SCHEMA_MAX_PROPERTIES} properties`)
      }
      for (const [name, child] of properties) inspectSchema(child, [...path, 'properties', name], depth + 1, issue)
    }
    if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some((entry) => typeof entry !== 'string'))) {
      issue([...path, 'required'], 'must be an array of property names')
    } else if (Array.isArray(schema.required)) {
      const required = schema.required as string[]
      const properties = (schema.properties ?? {}) as Record<string, unknown>
      if (new Set(required).size !== required.length) issue([...path, 'required'], 'must not repeat a property name')
      for (const name of required) if (!(name in properties)) issue([...path, 'required'], `names unknown property '${name}'`)
    }
    if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') {
      issue([...path, 'additionalProperties'], 'must be a boolean')
    }
  }
  if (schema.type === 'array') {
    if (schema.items === undefined) issue([...path, 'items'], 'is required for an array schema')
    else inspectSchema(schema.items, [...path, 'items'], depth + 1, issue)
  }
  for (const key of ['minLength', 'maxLength', 'minItems', 'maxItems'] as const) {
    if (schema[key] !== undefined && !nonNegativeInteger(schema[key])) issue([...path, key], 'must be a non-negative integer')
  }
  for (const key of ['minimum', 'maximum'] as const) {
    if (schema[key] !== undefined && !finiteNumber(schema[key])) issue([...path, key], 'must be a finite number')
  }
  if (nonNegativeInteger(schema.minLength) && nonNegativeInteger(schema.maxLength) && schema.minLength > schema.maxLength) {
    issue(path, 'minLength must not exceed maxLength')
  }
  if (nonNegativeInteger(schema.minItems) && nonNegativeInteger(schema.maxItems) && schema.minItems > schema.maxItems) {
    issue(path, 'minItems must not exceed maxItems')
  }
  if (finiteNumber(schema.minimum) && finiteNumber(schema.maximum) && schema.minimum > schema.maximum) {
    issue(path, 'minimum must not exceed maximum')
  }
}

export const boundedPluginToolSchema = z.record(z.string(), z.unknown()).superRefine((value, ctx) => {
  if (jsonBytes(value) > PLUGIN_TOOL_SCHEMA_MAX_BYTES) {
    ctx.addIssue({ code: 'custom', message: `JSON Schema exceeds ${PLUGIN_TOOL_SCHEMA_MAX_BYTES} bytes` })
    return
  }
  inspectSchema(value, [], 1, (path, message) => ctx.addIssue({ code: 'custom', path, message }))
  if (value.type !== 'object') ctx.addIssue({ code: 'custom', path: ['type'], message: 'an agent tool input schema must have type object' })
})

const localId = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, 'id must be lowercase snake_case and start with a letter')
const pluginRoute = z.string().min(1).max(256)

export const pluginAgentToolDescriptorSchema = z.object({
  id: localId,
  description: z.string().min(1).max(500),
  inputSchema: boundedPluginToolSchema,
  risk: z.enum(['read', 'write', 'execute']),
  scope: z.literal('task').default('task'),
  handler: pluginRoute,
  requiresSession: z.boolean().default(false),
  timeoutMs: z.number().int().min(100).max(PLUGIN_TOOL_TIMEOUT_MAX_MS).default(10_000),
  maxOutputBytes: z.number().int().min(1_024).max(PLUGIN_TOOL_OUTPUT_MAX_BYTES).default(64 * 1024),
})

export const pluginContextSectionDescriptorSchema = z.object({
  id: localId,
  label: z.string().min(1).max(80),
  scope: z.literal('task').default('task'),
  order: z.number().int().min(0).max(100_000),
  read: pluginRoute,
  defaultIncluded: z.boolean().default(false),
  timeoutMs: z.number().int().min(100).max(PLUGIN_CONTEXT_TIMEOUT_MAX_MS).default(5_000),
  maxBytes: z.number().int().min(1_024).max(PLUGIN_CONTEXT_SECTION_MAX_BYTES),
  maxTokens: z.number().int().min(256).max(PLUGIN_CONTEXT_SECTION_MAX_TOKENS),
})

export type PluginAgentToolDescriptor = z.infer<typeof pluginAgentToolDescriptorSchema>
export type PluginContextSectionDescriptor = z.infer<typeof pluginContextSectionDescriptorSchema>

export const qualifiedPluginToolName = (pluginId: string, localId: string): string => `${pluginId}_${localId}`
// A section id is persisted in inclusion preferences. Keep the established `<pluginId>` spelling when
// a plugin's local id repeats its owner (findings does this); otherwise qualify the local namespace.
export const qualifiedPluginContextSectionId = (pluginId: string, localId: string): string =>
  pluginId === localId ? pluginId : `${pluginId}:${localId}`
