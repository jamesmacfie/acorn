import type { DataValue } from '@acorn/protocol/dataValues.ts'
import type { PanelPlan } from '@acorn/protocol/dashboards.ts'

export const instant = (value: DataValue | undefined): number | undefined => {
  const date = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(date) ? date : undefined
}

/** UTC bucket retained for version 1 charts and trend history. */
export const dayBucket = (at: number): number => Math.floor(at / 86_400_000) * 86_400_000

const formatters = new Map<string, Intl.DateTimeFormat>()
function dateFormatter(zone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(zone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' })
    if (formatters.size >= 32) formatters.delete(formatters.keys().next().value!)
    formatters.set(zone, formatter)
  }
  return formatter
}

export function bucketValue(value: DataValue | undefined, bucket: 'value' | 'day' | 'week' | 'month', zone: string, weekStart: PanelPlan['time']['weekStart']): DataValue {
  if (bucket === 'value' || value == null) return value ?? null
  const date = instant(value)
  if (date === undefined) return null
  const parts = dateFormatter(zone).formatToParts(date)
  const part = (name: string) => parts.find(item => item.type === name)?.value ?? ''
  const day = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : `${part('year')}-${part('month')}-${part('day')}`
  if (bucket === 'day') return day
  if (bucket === 'month') return day.slice(0, 7)
  const week = new Date(`${day}T12:00:00Z`)
  const first = { sunday: 0, monday: 1, saturday: 6 }[weekStart]
  week.setUTCDate(week.getUTCDate() - (week.getUTCDay() - first + 7) % 7)
  return week.toISOString().slice(0, 10)
}

/** Exact half-open bounds for a displayed calendar bucket, including zone offset changes. */
export function bucketBounds(value: DataValue, bucket: 'day' | 'week' | 'month', zone: string,
  precision: 'day' | 'instant'): { start: number | string; end: number | string } | undefined {
  if (typeof value !== 'string') return undefined
  const firstDay = bucket === 'month' ? `${value}-01` : value
  if (!/^\d{4}-\d{2}-\d{2}$/.test(firstDay)) return undefined
  const first = new Date(`${firstDay}T00:00:00Z`)
  if (!Number.isFinite(first.getTime()) || first.toISOString().slice(0, 10) !== firstDay) return undefined
  const next = new Date(first)
  if (bucket === 'month') next.setUTCMonth(next.getUTCMonth() + 1)
  else next.setUTCDate(next.getUTCDate() + (bucket === 'week' ? 7 : 1))
  const lastDay = next.toISOString().slice(0, 10)
  if (precision === 'day') return { start: firstDay, end: lastDay }
  const midnight = (day: string): number => {
    const target = Date.parse(`${day}T00:00:00Z`)
    let low = target - 48 * 60 * 60 * 1000
    let high = target + 48 * 60 * 60 * 1000
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2)
      if (String(bucketValue(middle, 'day', zone, 'monday')) >= day) high = middle
      else low = middle
    }
    return high
  }
  return { start: midnight(firstDay), end: midnight(lastDay) }
}
