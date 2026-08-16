import { type Cadence, cadencePeriodMs } from '@acorn/protocol/schedules.ts'

// When a cadence next comes round. Pure, node-LOCAL, and separated from the loop so the arithmetic can
// be tested without a clock, a database or a timer.
//
// Local time for the two dated forms because the node is the owner's machine and "03:30" means their
// 03:30. DST does what local time does and nobody pretends otherwise: on the spring-forward day a
// 02:30 daily schedule lands on the wall clock's next 02:30, which is the next day.

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
    // Forward to the named weekday first, THEN push a whole week if that landed in the past. Doing it
    // the other way round skips a week whenever `from` is earlier in the same day.
    date.setDate(date.getDate() + ((dayOfWeek - date.getDay() + 7) % 7))
    if (date.getTime() <= from) date.setDate(date.getDate() + 7)
    return date.getTime()
  }
  if (date.getTime() <= from) date.setDate(date.getDate() + 1)
  return date.getTime()
}

/** ±5% skew on interval cadences. Without it every hourly schedule minted at one boot fires in the same
 *  second forever — a thundering herd against the node's own concurrency cap and any shared upstream.
 *
 *  ponytail: interval forms ONLY, deliberately narrower than "every computed nextRunAt". Five percent of
 *  a day is 72 minutes, so jittering `{ daily: '03:30' }` would break the one promise that form makes.
 *  A dated cadence has a wall clock to answer to; an interval has nothing but its length. */
export function nextRunAt(cadence: Cadence, from: number, random: () => number = Math.random): number {
  if ('daily' in cadence) return nextTimeOfDay(from, cadence.daily)
  if ('weekly' in cadence) return nextTimeOfDay(from, cadence.weekly.at, cadence.weekly.day)
  return from + Math.round(cadencePeriodMs(cadence) * (0.95 + random() * 0.1))
}
