import type { DataValue } from '@acorn/protocol/dataValues.ts'
import type { PanelPlan, PanelPlanColumn } from '@acorn/protocol/dashboards.ts'
import type { PlanGroup, PlanRow } from './plan'
import { outputPlanColumns } from './planColumns'

const columnAt = (plan: PanelPlan, id: string): PanelPlanColumn | undefined => outputPlanColumns(plan).find(column => column.id === id)

function compareCells(left: DataValue | undefined, right: DataValue | undefined): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return String(left).localeCompare(String(right))
}

export function sortPlanRows(plan: PanelPlan, rows: readonly PlanRow[]): PlanRow[] {
  const sorted = [...rows]
  sorted.sort((left, right) => {
    for (const key of plan.sort ?? []) {
      const a = left.values[key.column], b = right.values[key.column]
      const absentA = a == null, absentB = b == null
      if (absentA || absentB) {
        if (absentA === absentB) continue
        return (absentA ? 1 : -1) * (key.empty === 'first' ? -1 : 1)
      }
      const column = columnAt(plan, key.column)
      const rank = (value: DataValue): number => {
        const index = column?.choices?.findIndex(choice => choice.id === value) ?? -1
        return index < 0 ? (column?.choices?.length ?? 0) : (column?.choices?.[index]?.rank ?? index)
      }
      const ranked = column?.type === 'enum' ? rank(a) - rank(b) : 0
      const order = ranked || compareCells(a, b)
      if (order) return key.direction === 'desc' ? -order : order
    }
    return 0
  })
  return sorted
}

function datePart(value: DataValue, zone: string): { day: string; month: string } | undefined {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return { day: value, month: value.slice(0, 7) }
  const instant = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN
  if (!Number.isFinite(instant)) return undefined
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant)
  const get = (kind: string) => parts.find(part => part.type === kind)?.value ?? ''
  return { day: `${get('year')}-${get('month')}-${get('day')}`, month: `${get('year')}-${get('month')}` }
}

export function groupPlanRows(plan: PanelPlan, rows: readonly PlanRow[], evaluationTime: number): PlanGroup[] {
  const zone = plan.time.zone
  const today = datePart(evaluationTime, zone)?.day ?? ''
  const keys = plan.group ?? []
  const group = (items: readonly PlanRow[], depth: number): PlanGroup[] => {
    const spec = keys[depth]
    if (!spec) return []
    const buckets = new Map<string, PlanRow[]>()
    for (const row of items) {
      const value = row.values[spec.column]
      const date = spec.bucket && spec.bucket !== 'value' ? datePart(value, zone) : undefined
      let key = value == null ? 'No value' : String(value)
      if (spec.bucket === 'day') key = date?.day ?? 'No date'
      if (spec.bucket === 'month') key = date?.month ?? 'No date'
      if (spec.bucket === 'week' && date) {
        const day = new Date(`${date.day}T12:00:00Z`)
        const start = { sunday: 0, monday: 1, saturday: 6 }[plan.time.weekStart]
        day.setUTCDate(day.getUTCDate() - (day.getUTCDay() - start + 7) % 7)
        key = day.toISOString().slice(0, 10)
      }
      if (spec.bucket === 'relative') key = !date ? 'No date' : date.day < today ? 'Overdue' : date.day === today ? 'Today' : date.day <= new Date(Date.parse(`${today}T12:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10) ? 'Next seven days' : 'Later'
      buckets.set(key, [...(buckets.get(key) ?? []), row])
    }
    const declared = columnAt(plan, spec.column)?.choices?.map(choice => choice.id) ?? []
    const ordered = [...buckets].sort(([a, ar], [b, br]) => spec.order === 'count' ? br.length - ar.length
      : spec.order === 'declared' || spec.order === 'explicit' ? (() => {
        const order = spec.order === 'explicit' ? spec.values ?? [] : declared
        const ai = order.indexOf(a), bi = order.indexOf(b)
        return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi) || a.localeCompare(b)
      })() : a.localeCompare(b))
    return ordered.map(([key, members]) => ({ key, label: key, count: members.length, rows: members, ...(depth + 1 < keys.length ? { children: group(members, depth + 1) } : {}) }))
  }
  return group(rows, 0)
}

