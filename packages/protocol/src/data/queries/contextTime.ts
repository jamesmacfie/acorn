import type { DataBindingAddress } from '../values/dataBindings'

type TimeAddress = Extract<DataBindingAddress, { from: 'context'; name: 'now' | 'calendar' }>
type Policy = { zone: string; weekStart: 'monday' | 'sunday' | 'saturday' }

const localParts = (instant: number, zone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant)
  const part = (kind: string) => Number(parts.find(item => item.type === kind)?.value)
  return { year: part('year'), month: part('month'), day: part('day') }
}

function localStart(year: number, month: number, day: number, zone: string): number {
  const target = Date.UTC(year, month - 1, day)
  let low = target - 48 * 60 * 60 * 1000
  let high = target + 48 * 60 * 60 * 1000
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2)
    const date = localParts(middle, zone)
    if (Date.UTC(date.year, date.month - 1, date.day) >= target) high = middle
    else low = middle
  }
  return high
}

/** Resolve relative values from one frozen instant, using the same local-date boundary as time windows. */
export function resolveContextTime(address: TimeAddress, evaluationTime: number, policy: Policy): number {
  if (!Number.isFinite(evaluationTime)) throw new Error('Invalid evaluation time')
  const offset = /^([+-])P(\d+)([DWM])$/.exec(address.offset ?? '')
  const amount = offset ? Number(offset[2]) * (offset[1] === '-' ? -1 : 1) : 0
  const unit = offset?.[3]
  if (address.name === 'now') {
    if (unit === 'M') throw new Error('Calendar months require a calendar boundary')
    return evaluationTime + amount * (unit === 'W' ? 7 : 1) * 86_400_000
  }
  const date = localParts(evaluationTime, policy.zone)
  const utc = new Date(Date.UTC(date.year, date.month - 1, date.day))
  if (address.boundary === 'startOfWeek') {
    const weekday = utc.getUTCDay()
    utc.setUTCDate(utc.getUTCDate() - ((weekday - (policy.weekStart === 'monday' ? 1 : policy.weekStart === 'saturday' ? 6 : 0) + 7) % 7))
  } else if (address.boundary === 'startOfMonth') utc.setUTCDate(1)
  if (unit === 'M') utc.setUTCMonth(utc.getUTCMonth() + amount)
  else utc.setUTCDate(utc.getUTCDate() + amount * (unit === 'W' ? 7 : 1))
  return localStart(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate(), policy.zone)
}
