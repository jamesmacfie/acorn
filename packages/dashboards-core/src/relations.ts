import { MISSING, readDataPointer, type DataValue } from '@acorn/protocol/dataValues.ts'
import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { DataRecord } from '@acorn/protocol/dataSources.ts'
import type { PlanProblem, PlanRow, PlanSource } from './plan'

const scopedKey = (record: DataRecord, keys: readonly { pointer: string }[]): string | undefined => {
  const values = keys.map(key => readDataPointer(record.data, key.pointer))
  return values.some(value => value === MISSING || value == null || typeof value === 'object') ? undefined : JSON.stringify(values)
}

/** Relations use exact scoped fields. No title or label fallback is permitted. */
export function relatePanelRows(plan: PanelPlan, sources: readonly PlanSource[], initial: readonly PlanRow[]): { rows: PlanRow[]; problems: PlanProblem[] } {
  let rows = [...initial]
  const problems: PlanProblem[] = []
  for (const [index, relation] of (plan.relations ?? []).entries()) {
    const from = sources.find(source => source.instanceId === relation.from)
    const to = sources.find(source => source.instanceId === relation.to)
    if (!from || !to) continue
    const targets = new Map<string, DataRecord[]>()
    const fromCounts = new Map<string, number>()
    for (const record of to.result?.records ?? []) {
      const key = scopedKey(record, relation.keys.map(part => ({ pointer: part.to })))
      if (key) targets.set(key, [...targets.get(key) ?? [], record])
    }
    const fromRecords = new Map((from.result?.records ?? []).map(record => [record.ref.recordId, record]))
    for (const record of from.result?.records ?? []) {
      const key = scopedKey(record, relation.keys.map(part => ({ pointer: part.from })))
      if (key) fromCounts.set(key, (fromCounts.get(key) ?? 0) + 1)
    }
    const matched = new Map<string, string>()
    const removed = new Set<string>()
    rows = rows.flatMap(row => {
      const record = row.sourceRecords?.[relation.from]
      const raw = record && fromRecords.get(record.recordId)
      if (!raw) return [row]
      const key = scopedKey(raw, relation.keys.map(part => ({ pointer: part.from })))
      const matches = key ? targets.get(key) ?? [] : []
      if (matches.length > relation.maxMatches || (relation.cardinality !== 'one-to-many' && matches.length > 1) || relation.cardinality === 'one-to-one' && !!key && (fromCounts.get(key) ?? 0) > 1) {
        problems.push({ path: `/relations/${index}`, message: `${relation.id} violates ${relation.cardinality} at key ${key}.`, severity: 'warning' })
        return [row]
      }
      if (!matches.length) return relation.unmatched === 'drop' ? [] : [row]
      if (relation.kind === 'equivalence') {
        matched.set(row.id, `${relation.to}:${matches[0]!.ref.recordId}`)
        return [row]
      }
      if (relation.cardinality === 'one-to-many') {
        if (!relation.output) return [row]
        return [{ ...row, values: { ...row.values, [relation.output]: matches.map(item => item.ref.recordId) },
          childRecords: { ...row.childRecords, [relation.output]: matches } }]
      }
      const target = matches[0]!
      const values = { ...row.values }
      const attached: Record<string, DataValue> = {}
      for (const column of plan.columns) {
        const binding = column.bind[relation.to]
        if (!binding) continue
        const value = 'field' in binding ? readDataPointer(target.data, binding.field) : binding.value
        attached[column.id] = value === MISSING ? null : value
        values[column.id] = attached[column.id]!
      }
      return [{ ...row, values, sourceValues: { ...row.sourceValues, [relation.to]: attached }, sourceRecords: { ...row.sourceRecords, [relation.to]: target.ref }, records: [...row.records, target.ref], recordItems: [...row.recordItems ?? [], { ref: target.ref,
        ...(target.action ? { action: target.action } : {}), ...(target.actions ? { actions: target.actions } : {}),
        ...(target.target ? { target: target.target } : {}), ...(target.taskId ? { taskId: target.taskId } : {}) }] }]
    })
    if (relation.kind === 'equivalence') {
      const byId = new Map(rows.map(row => [row.id, row]))
      for (const [leftId, rightId] of matched) {
        const left = byId.get(leftId), right = byId.get(rightId)
        if (!left || !right || removed.has(rightId)) continue
        left.sourceValues = { ...left.sourceValues, ...right.sourceValues }
        left.values = Object.fromEntries(plan.columns.map(column => [column.id,
          [...new Set([...(column.precedence ?? []), ...plan.sources.map(source => source.id)])]
            .map(sourceId => left.sourceValues?.[sourceId]?.[column.id]).find(value => value != null) ?? null]))
        left.records = [...left.records, ...right.records]
        left.sourceRecords = { ...left.sourceRecords, ...right.sourceRecords }
        left.recordItems = [...left.recordItems ?? [], ...right.recordItems ?? []]
        left.id = `equivalent:${left.id}:${right.id}`
        removed.add(rightId)
      }
      rows = rows.filter(row => !removed.has(row.id))
    }
    if (rows.length > 25000) {
      problems.push({ path: `/relations/${index}`, message: 'Relation output row budget exceeded.', severity: 'error' })
      return { rows: [], problems }
    }
  }
  return { rows, problems }
}
