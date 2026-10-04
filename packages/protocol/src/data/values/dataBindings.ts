import { z } from 'zod'
import { DATA_LIMITS, MISSING, parseDataPointer, parseDataValue, type DataRead, type DataValue } from './dataValues'

export const dataPointerSchema = z.string().refine(value => parseDataPointer(value) !== null, 'Invalid data pointer')
const valueSchema = z.unknown().transform((value, ctx): DataValue => {
  try {
    return parseDataValue(value)
  } catch {
    ctx.addIssue({ code: 'custom', message: 'Invalid bounded JSON value' })
    return z.NEVER
  }
})
const id = z.string().min(1).max(200)
const addressSchema = z.union([
  z.object({ from: z.literal('literal'), value: valueSchema }).strict(),
  z.object({ from: z.literal('input'), name: id, pointer: dataPointerSchema }).strict(),
  z.object({ from: z.literal('step'), stepId: id, pointer: dataPointerSchema }).strict(),
  z.object({ from: z.literal('item'), pointer: dataPointerSchema }).strict(),
  z.object({ from: z.literal('context'), name: z.literal('viewer'), pointer: dataPointerSchema }).strict(),
  z.object({ from: z.literal('context'), name: z.literal('workspaceLinks') }).strict(),
  z.object({ from: z.literal('context'), name: z.literal('now'), offset: z.string().regex(/^[+-]P\d+[DW]$/).optional() }).strict(),
  z.object({ from: z.literal('context'), name: z.literal('calendar'), boundary: z.enum(['startOfDay', 'startOfWeek', 'startOfMonth']), offset: z.string().regex(/^[+-]P\d+[DWM]$/).optional() }).strict(),
])
export const dataBindingSchema = z.object({
  address: addressSchema,
  fallback: valueSchema.optional(),
  conversion: z.enum(['scalar-to-text', 'json-to-text']).optional(),
}).strict()
export type DataBindingAddress = z.infer<typeof addressSchema>
export type DataBinding = z.infer<typeof dataBindingSchema>
export const DATA_OPERATORS = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'contains', 'in', 'missing', 'present'] as const
export type DataOperator = typeof DATA_OPERATORS[number]
export const dataFieldSchema = z.object({
  pointer: dataPointerSchema,
  label: z.string().min(1).max(DATA_LIMITS.labelChars),
  description: z.string().max(DATA_LIMITS.descriptionChars).optional(),
  origin: z.enum(['declared', 'dynamic', 'observed']),
  display: z.object({
    kind: z.enum(['text', 'number', 'boolean', 'datetime', 'enum', 'status', 'person', 'link']),
    precision: z.literal('day').optional(),
    list: z.boolean().optional(),
    unit: z.string().max(16).optional(),
    role: z.enum(['title', 'status', 'assignee', 'url', 'updated']).optional(),
  }).strict().optional(),
  query: z.object({ operators: z.array(z.enum(DATA_OPERATORS)).max(DATA_OPERATORS.length), sortable: z.boolean() }).strict().optional(),
  choices: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('static'), values: z.array(z.object({
      id, label: z.string().min(1).max(DATA_LIMITS.labelChars),
      tone: z.enum(['ok', 'warn', 'bad', 'muted', 'accent']).optional(),
      rank: z.number().finite().optional(),
    }).strict()).max(DATA_LIMITS.options) }).strict(),
    z.object({ kind: z.literal('dynamic'), dependsOn: z.array(dataPointerSchema).max(DATA_LIMITS.fields) }).strict(),
  ]).optional(),
  viewerMatch: dataPointerSchema.optional(),
}).strict().superRefine((field, ctx) => {
  if (field.origin === 'observed' && (field.query || field.choices)) {
    ctx.addIssue({ code: 'custom', message: 'Observed fields cannot declare query support or choices' })
  }
})
export type DataField = z.infer<typeof dataFieldSchema>
export const dataFieldsSchema = z.array(dataFieldSchema).max(DATA_LIMITS.fields).refine(fields => new Set(fields.map(field => field.pointer)).size === fields.length, 'Duplicate field pointer')

export type DataPredicate =
  | { kind: 'all' | 'any'; predicates: DataPredicate[] }
  | { kind: 'comparison'; left: DataBinding; operator: DataOperator; right?: DataBinding }

export function parseDataPredicate(input: unknown): DataPredicate {
  // Bound recursion before using the recursive contract.
  const raw = parseDataValue(input, DATA_LIMITS.detailBytes, 32)
  let comparisons = 0
  const comparison = z.object({
    kind: z.literal('comparison'),
    left: dataBindingSchema,
    operator: z.enum(DATA_OPERATORS),
    right: dataBindingSchema.optional(),
  }).strict()
  function visit(value: unknown, depth: number): DataPredicate {
    const group = z.object({
      kind: z.enum(['all', 'any']),
      predicates: z.array(z.unknown()).min(1).max(DATA_LIMITS.comparisons),
    }).strict().safeParse(value)
    if (group.success) {
      if (depth >= DATA_LIMITS.predicateDepth) throw new Error('Predicate nesting exceeds limit')
      return { kind: group.data.kind, predicates: group.data.predicates.map(child => visit(child, depth + 1)) }
    }
    if (++comparisons > DATA_LIMITS.comparisons) throw new Error('Too many comparisons')
    const parsed = comparison.parse(value)
    const presenceTest = ['missing', 'present'].includes(parsed.operator)
    if (presenceTest ? parsed.right !== undefined : parsed.right === undefined) {
      throw new Error('Invalid comparison operand count')
    }
    return parsed
  }
  return visit(raw, 0)
}

/** No coercion or locale dependence. Missing must be tested explicitly or resolved by a binding. */
export function compareDataValues(left: DataRead, operator: DataOperator, right: DataRead = MISSING): boolean {
  if (operator === 'missing') return left === MISSING
  if (operator === 'present') return left !== MISSING
  if (left === MISSING || right === MISSING) throw new Error('Comparison operand is missing')
  parseDataValue(left)
  parseDataValue(right)
  const primitive = (value: DataValue) => value === null || typeof value !== 'object'
  if (operator === 'in') {
    if (!primitive(left) || !Array.isArray(right) || !right.every(primitive)) {
      throw new Error('Membership requires a primitive and primitive array')
    }
    return right.some(item => item === left)
  }
  if (operator === 'contains') {
    if (typeof left === 'string' && typeof right === 'string') return left.includes(right)
    if (Array.isArray(left) && left.every(primitive) && primitive(right)) return left.some(item => item === right)
    throw new Error('Contains requires strings or a primitive array and primitive')
  }
  if (!primitive(left) || !primitive(right)) throw new Error('Comparison requires primitive values')
  if (operator === 'eq') return left === right
  if (operator === 'ne') return left !== right
  if (!((typeof left === 'number' && typeof right === 'number')
    || (typeof left === 'string' && typeof right === 'string'))) {
    throw new Error('Ordered comparison requires matching numbers or strings')
  }
  if (operator === 'lt') return left < right
  if (operator === 'lte') return left <= right
  if (operator === 'gt') return left > right
  return left >= right
}
