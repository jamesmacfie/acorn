// What counts as a new, matching, or changed record, decided the same way wherever records are
// remembered: a workflow's For each loop, a record trigger's check, and the trigger editor's preview.
import { dataRecordRefSchema } from './dataSources'
import {
  canonicalDataProjection,
  MISSING,
  parseDataPointer,
  parseDataValue,
  readDataPointer,
  type DataValue,
} from './values/dataValues'

/**
 * - `every-match` admits every record, every time.
 * - `unseen` admits a record the first time it's seen.
 * - `changed` admits a record whose tracked fields differ from the last kept projection.
 * - `enters` admits a record that matches now and wasn't matching after the last complete read.
 *
 * Each consumer narrows the modes it accepts: loops take the first three, triggers the last three.
 */
type RecordChangeMode = 'every-match' | 'unseen' | 'changed' | 'enters'
export type RecordChangePolicy<Mode extends RecordChangeMode = RecordChangeMode> = { mode: Mode; fields?: string[] }
export type RecordChangeDecision = 'admitted' | 'baseline' | 'active' | 'seen' | 'unchanged'

/** What was remembered about a record. `snapshot` lets a changed field list be reprojected, and
 *  `matching` is false once a complete read stopped returning the record. */
export type RecordChangePrevious = {
  fields: string[]
  projection: string
  snapshot?: DataValue
  matching?: boolean
}

/** A record's business identity: source, account, and record ID. Retrieval scope is transport
 *  context, so a different search that finds the same record finds the same identity. */
export function recordIdentity(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || !('ref' in value) || !('data' in value)) return undefined
  const parsed = dataRecordRefSchema.safeParse(value.ref)
  if (!parsed.success) return undefined
  const { pluginId, sourceId, connectionId, recordId } = parsed.data
  return JSON.stringify(['source', pluginId, sourceId, connectionId ?? null, recordId])
}

export function recordChangeFields(policy: RecordChangePolicy): string[] {
  if (!['every-match', 'unseen', 'changed', 'enters'].includes(policy.mode)) throw new Error('Unknown repeat policy')
  const fields = [...new Set(policy.fields ?? [])].sort()
  if (fields.length > 256 || fields.some((field) => !parseDataPointer(field)))
    throw new Error('Tracked fields must be safe JSON Pointers')
  if (policy.mode === 'changed' && !fields.length) throw new Error('Select at least one tracked field')
  return fields
}

export function recordProjection(snapshot: unknown, fields: readonly string[]): string {
  return canonicalDataProjection(parseDataValue(snapshot), fields)
}

export function recordChangeDecision(args: {
  policy: RecordChangePolicy
  snapshot: DataValue
  previous?: RecordChangePrevious
  active: boolean
  baseline?: boolean
  reprocess?: boolean
}): RecordChangeDecision {
  const fields = recordChangeFields(args.policy)
  const previous = args.previous
  if (args.active) return 'active'
  if (args.baseline) return 'baseline'
  if (args.reprocess || !previous || args.policy.mode === 'every-match') return 'admitted'
  if (args.policy.mode === 'unseen') return 'seen'
  if (args.policy.mode === 'enters') return previous.matching === false ? 'admitted' : 'seen'
  const changedFields = JSON.stringify(fields) !== JSON.stringify(previous.fields)
  if (
    changedFields &&
    (previous.snapshot === undefined ||
      fields.some(
        (field) => !previous.fields.includes(field) && readDataPointer(previous.snapshot!, field) === MISSING,
      ))
  ) {
    throw new Error(
      'A tracked field is unavailable in the retained snapshot. Choose a fresh baseline or processing epoch.',
    )
  }
  const before = changedFields ? recordProjection(previous.snapshot, fields) : previous.projection
  return before === recordProjection(args.snapshot, fields) ? 'unchanged' : 'admitted'
}
