import type { DataValue } from '@acorn/protocol/dataValues.ts'
import type { PanelPlan } from '@acorn/protocol/dashboards.ts'

export const instant = (value: DataValue | undefined): number | undefined => {
  const date = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(date) ? date : undefined
}

/** UTC bucket retained for version 1 charts and trend history. */
export const dayBucket = (at: number): number => Math.floor(at / 86_400_000) * 86_400_000

export function bucketValue(value: DataValue | undefined, bucket: 'value' | 'day' | 'week' | 'month', zone: string, weekStart: PanelPlan['time']['weekStart']): DataValue {
  if (bucket === 'value' || value == null) return value ?? null
  const date = instant(value)
  if (date === undefined) return null
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const part = (name: string) => parts.find(item => item.type === name)?.value ?? ''
  const day = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : `${part('year')}-${part('month')}-${part('day')}`
  if (bucket === 'day') return day
  if (bucket === 'month') return day.slice(0, 7)
  const week = new Date(`${day}T12:00:00Z`)
  const first = { sunday: 0, monday: 1, saturday: 6 }[weekStart]
  week.setUTCDate(week.getUTCDate() - (week.getUTCDay() - first + 7) % 7)
  return week.toISOString().slice(0, 10)
}
