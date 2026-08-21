import { type Cadence, cadencePeriodMs } from '@acorn/protocol/schedules.ts'

// When a cadence next comes round. Pure and separated from the loop so the arithmetic can be tested
// without a clock, a database or a timer. Node-local time for the two dated forms and DST handling
// follow docs/schedules.md § Cadence.

const parseTime = (at: string): [number, number] => {
  const [h, m] = at.split(':')
  return [Number(h), Number(m)]
}

/** The next wall-clock occurrence of `HH:MM` strictly after `from`. */
function nextTimeOfDay(from: number, at: string, dayOfWeek?: number): number {
  const [hours, minutes] = parseTime(at)
  const date = new Date(from)
  date.setHours(hours, minutes, 0, 0)
  if (dayOfWeek !== undefined) {
    // Forward to the named weekday first, then push a whole week if that landed in the past. Doing it
    // the other way round skips a week whenever `from` is earlier in the same day.
    date.setDate(date.getDate() + ((dayOfWeek - date.getDay() + 7) % 7))
    if (date.getTime() <= from) date.setDate(date.getDate() + 7)
    return date.getTime()
  }
  if (date.getTime() <= from) date.setDate(date.getDate() + 1)
  return date.getTime()
}

/** ±5% skew on interval cadences (docs/schedules.md § Policies, Jitter). Scoped to interval forms
 *  only, narrower than "every computed nextRunAt": a dated cadence has a wall clock to answer to,
 *  an interval has nothing but its length. */
export function nextRunAt(cadence: Cadence, from: number, random: () => number = Math.random): number {
  if ('daily' in cadence) return nextTimeOfDay(from, cadence.daily)
  if ('weekly' in cadence) return nextTimeOfDay(from, cadence.weekly.at, cadence.weekly.day)
  return from + Math.round(cadencePeriodMs(cadence) * (0.95 + random() * 0.1))
}
