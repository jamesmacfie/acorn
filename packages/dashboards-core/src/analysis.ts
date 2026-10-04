import type { PanelPlan, PlanExpression } from '@acorn/protocol/dashboards.ts'
import { MISSING, readDataPointer, type DataValue } from '@acorn/protocol/dataValues.ts'
import type { PlanRow } from './plan'
import { bucketValue, instant } from './planBuckets'

type Stage = PanelPlan['stages'][number]
type Summary = Extract<Stage, { op: 'summarize' }>
type Measure = Summary['measures'][number]
const key = (values: readonly unknown[]): string => JSON.stringify(values)
const numeric = (value: DataValue | undefined): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined

/** Pure stage semantics; dataset execution can reuse these without a source runtime. */
export function evaluateExpression(expression: PlanExpression, row: PlanRow, now: number): DataValue {
  switch (expression.kind) {
    case 'column': return row.values[expression.column] ?? null
    case 'literal': return expression.value
    case 'clock': return now
    case 'choice': return expression.cases[String(row.values[expression.column])] ?? expression.otherwise ?? null
    case 'coalesce': return expression.values.map(value => evaluateExpression(value, row, now)).find(value => value != null) ?? null
    case 'min': case 'max': {
      const values = expression.values.map(value => numeric(evaluateExpression(value, row, now)))
      return values.some(value => value === undefined) ? null : expression.kind === 'min' ? Math.min(...values as number[]) : Math.max(...values as number[])
    }
    case 'duration': {
      const start = instant(evaluateExpression(expression.start, row, now))
      const end = instant(evaluateExpression(expression.end, row, now))
      if (start === undefined || end === undefined) return null
      return (end - start) / { ms: 1, s: 1000, minutes: 60000, hours: 3600000, days: 86400000 }[expression.unit]
    }
    case 'arithmetic': {
      const left = numeric(evaluateExpression(expression.left, row, now))
      const right = numeric(evaluateExpression(expression.right, row, now))
      if (left === undefined || right === undefined) return null
      if (expression.operator === 'divide' && right === 0) return null
      const answer = expression.operator === 'add' ? left + right : expression.operator === 'subtract' ? left - right
        : expression.operator === 'multiply' ? left * right : left / right
      return Number.isFinite(answer) ? answer : null
    }
  }
}

function measureValue(measure: Measure, rows: readonly PlanRow[]): { value: DataValue; partial: boolean } {
  const values = rows.map(row => row.values[measure.column ?? ''])
  const known = values.filter(value => value != null)
  const numbers = known.flatMap(value => typeof value === 'number' && Number.isFinite(value) ? [value] : [])
  const partial = !!measure.column && known.length !== values.length
  switch (measure.kind) {
    case 'count': case 'count-where': return { value: rows.length, partial: false }
    case 'distinct-count': return { value: new Set(known.map(value => key([value]))).size, partial }
    case 'distinct-list': return { value: [...new Map(known.map(value => [key([value]), value])).values()], partial }
    case 'sum': return { value: numbers.reduce((sum, value) => sum + value, 0), partial: partial || numbers.length !== known.length }
    case 'average': return { value: numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null, partial: partial || numbers.length !== known.length }
    case 'minimum': case 'maximum': return { value: numbers.length ? (measure.kind === 'minimum' ? Math.min(...numbers) : Math.max(...numbers)) : null, partial }
    case 'median': case 'percentile': {
      if (!numbers.length) return { value: null, partial }
      numbers.sort((a, b) => a - b)
      const rank = (numbers.length - 1) * (measure.kind === 'median' ? .5 : (measure.percentile ?? 50) / 100)
      const low = Math.floor(rank), high = Math.ceil(rank)
      return { value: numbers[low]! + (numbers[high]! - numbers[low]!) * (rank - low), partial }
    }
    case 'earliest': case 'latest': {
      const sorted = known.toSorted((a, b) => typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)))
      return { value: measure.kind === 'earliest' ? sorted[0] ?? null : sorted.at(-1) ?? null, partial }
    }
  }
}

export type SummaryResult = { rows: PlanRow[]; errors: string[] }
export function summarizeRows(plan: PanelPlan, stage: Summary, rows: readonly PlanRow[], matches: (row: PlanRow, where: NonNullable<Measure['where']>) => boolean, incomplete = false): SummaryResult {
  const groups = new Map<string, { by: DataValue[]; rows: PlanRow[] }>()
  for (const row of rows) {
    const by = stage.by.map(group => bucketValue(row.values[group.column], group.bucket ?? 'value', plan.time.zone, plan.time.weekStart))
    const id = key(by)
    const group = groups.get(id) ?? { by, rows: [] }
    group.rows.push(row)
    groups.set(id, group)
  }
  if (!stage.by.length && !groups.size) groups.set('[]', { by: [], rows: [] })
  const output: PlanRow[] = []
  const errors: string[] = []
  for (const [id, group] of groups) {
    const values: PlanRow['values'] = Object.fromEntries(stage.by.map((by, index) => [by.column, group.by[index] ?? null]))
    const measureRows: NonNullable<PlanRow['measureRows']> = {}
    const partial: NonNullable<PlanRow['partial']> = {}
    for (const measure of stage.measures) {
      const selected = measure.where ? group.rows.filter(row => matches(row, measure.where!)) : group.rows
      measureRows[measure.id] = selected
      const result = measureValue(measure, selected)
      values[measure.id] = result.value
      if (result.partial || incomplete) partial[measure.id] = incomplete ? 'source incomplete or window uncovered' : 'unknown input values'
      if (measure.column) {
        const unit = plan.columns.find(column => column.id === measure.column)?.unit
        if (typeof unit === 'object') {
          const units = new Set(selected.map(row => row.values[unit.column]).filter(value => value != null))
          if (units.size > 1) errors.push(`Measure ${measure.label} mixes units.`)
          if (selected.some(row => row.values[unit.column] == null)) partial[measure.id] = [partial[measure.id], 'unknown unit'].filter(Boolean).join('; ')
        }
      }
    }
    output.push({ id: `summary:${id}`, values, records: [...new Map(group.rows.flatMap(row => row.records).map(ref => [key([ref]), ref])).values()],
      recordItems: group.rows.flatMap(row => row.recordItems ?? []), measureRows, partial, representedRows: group.rows })
  }
  return { rows: finishSummaryRows(plan, stage, output), errors }
}

/** Shared final shaping after either in-memory or SQLite grouped reductions. */
export function finishSummaryRows(plan: PanelPlan, stage: Summary, output: PlanRow[]): PlanRow[] {
  if (stage.fill && stage.by.length === 1 && stage.by[0]?.bucket && stage.by[0].bucket !== 'value' && output.length) {
    const bucket = stage.by[0]
    const byDay = new Map(output.map(row => [String(row.values[bucket.column]), row]))
    const dates = [...byDay.keys()].toSorted()
    const next = (date: string): string => {
      const value = new Date(`${date.length === 7 ? `${date}-01` : date}T12:00:00Z`)
      if (bucket.bucket === 'month') value.setUTCMonth(value.getUTCMonth() + 1)
      else value.setUTCDate(value.getUTCDate() + (bucket.bucket === 'week' ? 7 : 1))
      return value.toISOString().slice(0, bucket.bucket === 'month' ? 7 : 10)
    }
    for (let date = dates[0]!; date < dates.at(-1)! && byDay.size < 366; date = next(date)) {
      if (byDay.has(date)) continue
      const values: PlanRow['values'] = { [bucket.column]: date }
      for (const measure of stage.measures) values[measure.id] = measure.kind === 'count' || measure.kind === 'count-where' ? 0 : null
      byDay.set(date, { id: `summary:empty:${date}`, values, records: [], measureRows: {}, representedRows: [] })
    }
    output.splice(0, output.length, ...[...byDay.values()].toSorted((a, b) => String(a.values[bucket.column]).localeCompare(String(b.values[bucket.column]))))
  }
  for (const measure of stage.measures) {
    if (!measure.share) continue
    const total = output.reduce((sum, row) => sum + (numeric(row.values[measure.id]) ?? 0), 0)
    for (const row of output) row.values[measure.id] = total ? 100 * (numeric(row.values[measure.id]) ?? 0) / total : null
  }
  if (stage.pivot) {
    const choiceColumn = plan.columns.find(column => column.id === stage.pivot!.column)
    const grouped = new Map<string, PlanRow>()
    for (const row of output) {
      const by = stage.by.filter(item => item.column !== stage.pivot!.column)
      const identity = key(by.map(item => row.values[item.column]))
      const base = grouped.get(identity) ?? { id: `pivot:${identity}`, values: Object.fromEntries(by.map(item => [item.column, row.values[item.column] ?? null])), records: [], representedRows: [], measureRows: {}, partial: {} }
      const choice: string = String(row.values[stage.pivot.column] ?? '')
      const column = `${stage.pivot.measure}_${choice}`
      base.values[column] = row.values[stage.pivot.measure] ?? null
      base.records.push(...row.records)
      base.representedRows!.push(...row.representedRows ?? [])
      base.measureRows![column] = row.measureRows?.[stage.pivot.measure] ?? []
      if (row.datasetGroups?.[stage.pivot.measure]) {
        base.datasetGroups ??= {}
        base.datasetGroups[column] = row.datasetGroups[stage.pivot.measure]
      }
      if (row.partial?.[stage.pivot.measure]) base.partial![column] = row.partial[stage.pivot.measure]
      grouped.set(identity, base)
    }
    for (const row of grouped.values()) for (const choice of choiceColumn?.choices ?? []) row.values[`${stage.pivot.measure}_${choice.id}`] ??= null
    output.splice(0, output.length, ...grouped.values())
  }
  if (stage.by.length === 1 && stage.by[0]?.bucket && stage.by[0].bucket !== 'value') {
    const column = stage.by[0].column
    const ordered = output.toSorted((a, b) => String(a.values[column]).localeCompare(String(b.values[column])))
    for (const measure of stage.measures) if (measure.previous) ordered.forEach((row, index) => {
      const current = numeric(row.values[measure.id]), previous = numeric(ordered[index - 1]?.values[measure.id])
      row.values[`${measure.id}Previous`] = current === undefined || previous === undefined ? null
        : measure.previous === 'amount' ? current - previous : previous ? 100 * (current - previous) / previous : null
    })
  }
  return output
}

export function expandRows(plan: PanelPlan, rows: readonly PlanRow[], stage: Extract<Stage, { op: 'expand' }>, maxRows = 25000): PlanRow[] {
  const output: PlanRow[] = []
  for (const row of rows) {
    const list = row.values[stage.column]
    if (!Array.isArray(list)) continue
    if (list.length > stage.perRow || output.length + list.length > maxRows) throw new Error('Expansion row budget exceeded.')
    list.forEach((item, index) => {
      const child = row.childRecords?.[stage.column]?.[index]
      const relation = plan.relations?.find(item => item.output === stage.column)
      const attached = Object.fromEntries(plan.columns.flatMap(column => {
        const binding = relation && column.bind[relation.to]
        if (!child || !binding) return []
        const value = 'field' in binding ? readDataPointer(child.data, binding.field) : binding.value
        return [[column.id, value === MISSING ? null : value]]
      }))
      output.push({ ...row, id: `${row.id}:element:${child?.ref.recordId ?? index}`, values: { ...row.values, ...attached, [stage.output]: item },
        records: child ? [...row.records, child.ref] : row.records,
        recordItems: child ? [...row.recordItems ?? [], { ref: child.ref, ...(child.action ? { action: child.action } : {}), ...(child.target ? { target: child.target } : {}), ...(child.actions ? { actions: child.actions } : {}) }] : row.recordItems })
    })
  }
  return output
}

/** Active intervals are ordered by end time; each input is visited once plus emitted pairs. */
export function overlapRows(rows: readonly PlanRow[], stage: Extract<Stage, { op: 'overlap' }>): PlanRow[] {
  if (rows.length > 5000) throw new Error('Overlap input budget exceeded.')
  const intervals = rows.flatMap(row => {
    const start = instant(row.values[stage.start]), end = instant(row.values[stage.end])
    return start !== undefined && end !== undefined && end > start ? [{ row, start, end, partition: key([stage.partition ? row.values[stage.partition] : null]) }] : []
  }).sort((a, b) => a.start - b.start)
  const active = new Map<string, typeof intervals>()
  const output: PlanRow[] = []
  for (const item of intervals) {
    const bucket = (active.get(item.partition) ?? []).filter(other => other.end > item.start)
    for (const other of bucket) {
      if (output.length >= stage.maxPairs) throw new Error('Overlap pair budget exceeded.')
      output.push({ id: `overlap:${other.row.id}:${item.row.id}`, values: { ...other.row.values,
        ...Object.fromEntries(Object.entries(item.row.values).map(([id, value]) => [`right_${id}`, value])),
        overlapDuration: Math.min(other.end, item.end) - item.start },
        records: [...other.row.records, ...item.row.records], recordItems: [...other.row.recordItems ?? [], ...item.row.recordItems ?? []],
        representedRows: [other.row, item.row] })
    }
    bucket.push(item)
    active.set(item.partition, bucket)
  }
  return output
}
