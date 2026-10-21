// Suggested triggers: the record changes a source offers as a starting point in the trigger dialog
// (docs/plugin-authoring/triggers.md). The Node keeps only the starters that pass this check, and the
// SDK's `checkStarterTriggers` reports the same problems, so a test and the Node agree.
import { z } from 'zod'
import type { DataSourceDescription } from './dataSources'
import { parseDataPredicate, type DataField, type DataPredicate } from './values/dataBindings'
import { sourceFieldSchema, validateDataValue } from './values/dataSchemas'

const STARTER_TRIGGER_LIMIT = 10

/** Which records start a run: one that's new, starts matching, or changes in the fields named. */
export type RecordChange = { on: 'new' } | { on: 'enters' } | { on: 'changes'; fields: string[] }

/** A suggested trigger. Its predicate and fields point into the source's records, as a query's do, and
 *  it names no workspace, account, or workflow: the person picks those. */
export type StarterTrigger = {
  id: string
  label: string
  description: string
  predicate?: DataPredicate
  change: RecordChange
}

const starterSchema = z
  .object({
    id: z.string().min(1).max(200),
    label: z.string().min(1).max(80),
    description: z.string().min(1).max(300),
    predicate: z.unknown().optional(),
    change: z.discriminatedUnion('on', [
      z.object({ on: z.literal('new') }).strict(),
      z.object({ on: z.literal('enters') }).strict(),
      z.object({ on: z.literal('changes'), fields: z.array(z.string().min(1).max(256)).min(1).max(16) }).strict(),
    ]),
  })
  .strict()

type Described = Pick<DataSourceDescription, 'schema' | 'fields' | 'operations'>

/** What's wrong with a predicate over this source, in words. A starter's operands are literals. */
function predicateProblems(predicate: DataPredicate, description: Described, fields: Map<string, DataField>): string[] {
  if (predicate.kind !== 'comparison') {
    const group = description.operations.groups.includes(predicate.kind)
      ? []
      : [`The source can't combine conditions with "${predicate.kind}".`]
    return [...group, ...predicate.predicates.flatMap((part) => predicateProblems(part, description, fields))]
  }
  const { left, operator, right } = predicate
  if (left.address.from !== 'item' || left.conversion || left.fallback !== undefined)
    return ['A condition must test a field of the record.']
  const pointer = left.address.pointer
  const field = fields.get(pointer)
  if (!field) return [`The predicate names ${pointer}, which the source doesn't describe.`]
  if (!field.query?.operators.includes(operator)) return [`The source can't filter ${pointer} with "${operator}".`]
  if (!right) return []
  if (right.address.from !== 'literal' || right.conversion) return [`The condition on ${pointer} must compare a value.`]
  const schema = sourceFieldSchema(description.schema, pointer)
  if (!schema) return [`The predicate names ${pointer}, which the source's schema doesn't have.`]
  const operand = right.address.value
  const operands = operator === 'in' ? (Array.isArray(operand) ? operand : null) : [operand]
  if (!operands) return [`"in" on ${pointer} needs a list of values.`]
  return operands.flatMap((value) => {
    try {
      validateDataValue(value, operator === 'contains' && schema.items ? schema.items : schema)
    } catch {
      return [`${JSON.stringify(value)} isn't a value of ${pointer}.`]
    }
    return field.choices?.kind === 'static' && !field.choices.values.some((choice) => choice.id === value)
      ? [`${JSON.stringify(value)} isn't one of the choices for ${pointer}.`]
      : []
  })
}

/** Splits a description's starters into the ones the dialog may offer and the ones it drops, with why. */
export function starterTriggerCheck(
  description: Described,
  starters: readonly unknown[] = [],
): { kept: StarterTrigger[]; dropped: { id: string; problems: string[] }[] } {
  const fields = new Map(description.fields.map((field) => [field.pointer, field]))
  const kept: StarterTrigger[] = []
  const dropped: { id: string; problems: string[] }[] = []
  const ids = new Set<string>()
  if (starters.length > STARTER_TRIGGER_LIMIT)
    dropped.push({ id: '', problems: [`A source suggests at most ${STARTER_TRIGGER_LIMIT} triggers.`] })
  for (const candidate of starters.slice(0, STARTER_TRIGGER_LIMIT)) {
    const parsed = starterSchema.safeParse(candidate)
    if (!parsed.success) {
      const id = candidate && typeof candidate === 'object' && 'id' in candidate ? String(candidate.id) : ''
      dropped.push({
        id,
        problems: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'starter'}: ${issue.message}`),
      })
      continue
    }
    const { predicate: raw, ...rest } = parsed.data
    const problems: string[] = []
    if (ids.has(rest.id)) problems.push('Another starter has the same id.')
    ids.add(rest.id)
    let predicate: DataPredicate | undefined
    if (raw !== undefined) {
      try {
        predicate = parseDataPredicate(raw)
        problems.push(...predicateProblems(predicate, description, fields))
      } catch (error) {
        problems.push(`The predicate isn't valid: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (rest.change.on === 'changes')
      for (const pointer of rest.change.fields)
        if (!fields.has(pointer)) problems.push(`The watched field ${pointer} isn't one the source describes.`)
    if (problems.length) dropped.push({ id: rest.id, problems })
    else kept.push({ ...rest, ...(predicate ? { predicate } : {}) })
  }
  return { kept, dropped }
}
