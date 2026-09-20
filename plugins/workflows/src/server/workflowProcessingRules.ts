import { canonicalDataProjection, parseDataPointer, parseDataValue, MISSING, readDataPointer, type DataValue } from '@acorn/protocol/dataValues.ts'
import { dataRecordRefSchema } from '@acorn/protocol/dataSources.ts'
import type { WorkflowProcessingDecision, WorkflowRepeatPolicy } from '../shared/workflowProcessing'

/** Retrieval scope is transport context, not business identity. */
export function workflowRecordIdentity(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || !('ref' in value) || !('data' in value)) return undefined
  const parsed = dataRecordRefSchema.safeParse(value.ref)
  if (!parsed.success) return undefined
  const { pluginId, sourceId, connectionId, recordId } = parsed.data
  return JSON.stringify(['source', pluginId, sourceId, connectionId ?? null, recordId])
}

export function processingFields(policy: WorkflowRepeatPolicy): string[] {
  if (!['every-match', 'unseen', 'changed'].includes(policy.mode)) throw new Error('Unknown repeat policy')
  const fields = [...new Set(policy.fields ?? [])].sort()
  if (fields.length > 256 || fields.some(field => !parseDataPointer(field))) throw new Error('Tracked fields must be safe JSON Pointers')
  if (policy.mode === 'changed' && !fields.length) throw new Error('Select at least one tracked field')
  return fields
}

export function processingProjection(snapshot: unknown, fields: readonly string[]): string {
  return canonicalDataProjection(parseDataValue(snapshot), fields)
}

export function processingDecision(args: {
  policy: WorkflowRepeatPolicy
  snapshot: DataValue
  previous?: { snapshot: DataValue; fields: string[]; projection: string }
  active: boolean
  baseline?: boolean
  reprocess?: boolean
}): WorkflowProcessingDecision {
  const fields = processingFields(args.policy)
  if (args.active) return 'active'
  if (args.baseline) return 'baseline'
  if (args.reprocess || !args.previous || args.policy.mode === 'every-match') return 'admitted'
  if (args.policy.mode === 'unseen') return 'seen'
  const changedFields = JSON.stringify(fields) !== JSON.stringify(args.previous.fields)
  if (changedFields && fields.some(field => !args.previous!.fields.includes(field) && readDataPointer(args.previous!.snapshot, field) === MISSING)) {
    throw new Error('A tracked field is unavailable in the retained snapshot. Choose a fresh baseline or processing epoch.')
  }
  const previous = changedFields ? processingProjection(args.previous.snapshot, fields) : args.previous.projection
  return previous === processingProjection(args.snapshot, fields) ? 'unchanged' : 'admitted'
}
