// `checkStarterTriggers` and `testTrigger` (docs/plugin-authoring/triggers.md § Test your triggers).
// Both run the protocol's own rules: the starter check the Node drops a starter with, and the change
// decision a record trigger's check makes. So a test and the Node agree.
import { dataPredicateMatches } from '@acorn/protocol/dataBindings.ts'
import { validateDataValue } from '@acorn/protocol/dataSchemas.ts'
import type { DataValue } from '@acorn/protocol/dataValues.ts'
import {
  recordChangeDecision,
  recordChangeFields,
  recordProjection,
  type RecordChangePolicy,
} from '@acorn/protocol/recordChanges.ts'
import { starterTriggerCheck } from '@acorn/protocol/starterTriggers.ts'
import type { checkStarterTriggers as CheckStarterTriggers, testTrigger as TestTrigger } from './public.ts'

export const checkStarterTriggers: typeof CheckStarterTriggers = (description) => {
  const { dropped } = starterTriggerCheck(description, description.starterTriggers ?? [])
  if (dropped.length)
    throw new Error(
      dropped.map(({ id, problems }) => `Suggested trigger ${id || '(no id)'}: ${problems.join(' ')}`).join('\n'),
    )
}

export const testTrigger: typeof TestTrigger = (description, change, reads, options = {}) => {
  // The check a suggestion gets, so a rule the Node would refuse fails here first.
  const probe = { id: 'test', label: 'Test', description: 'Test', change, ...options }
  const { dropped } = starterTriggerCheck(description, [probe])
  if (dropped.length) throw new Error(dropped[0]!.problems.join(' '))
  // A trigger's pointers address the record envelope, so a field of the record is under /data.
  const policy: RecordChangePolicy =
    change.on === 'new'
      ? { mode: 'unseen' }
      : change.on === 'enters'
        ? { mode: 'enters' }
        : { mode: 'changed', fields: change.fields.map((field) => `/data${field}`) }
  const fields = recordChangeFields(policy)
  const ledger = new Map<string, { projection: string; matching: boolean }>()
  return reads.map((read, index) => {
    const { records, completeness } =
      'records' in read ? read : { records: read, completeness: { kind: 'complete' as const } }
    const seen = new Set<string>()
    const starts: { id: string; reason: typeof change.on }[] = []
    for (const record of records) {
      try {
        validateDataValue(record.data, description.schema)
      } catch (error) {
        throw new Error(`Read ${index + 1}, record ${record.id}: ${error instanceof Error ? error.message : error}`)
      }
      if (
        seen.has(record.id) ||
        (options.predicate && !dataPredicateMatches(record.data as DataValue, options.predicate))
      )
        continue
      seen.add(record.id)
      const envelope = {
        ref: { pluginId: 'test', sourceId: 'test', recordId: record.id },
        data: record.data,
      } as DataValue
      const kept = ledger.get(record.id)
      const decision = recordChangeDecision({
        policy,
        snapshot: envelope,
        ...(kept ? { previous: { fields, ...kept } } : {}),
        active: false,
      })
      if (decision === 'admitted') starts.push({ id: record.id, reason: change.on })
      const projection = decision === 'admitted' || !kept ? recordProjection(envelope, fields) : kept.projection
      ledger.set(record.id, { projection, matching: true })
    }
    // Only a complete read can say which records stopped matching.
    if (completeness.kind === 'complete') for (const [id, kept] of ledger) if (!seen.has(id)) kept.matching = false
    return { starts }
  })
}
