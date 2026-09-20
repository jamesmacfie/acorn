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

type CalendarParts = { year: number; month: number; day: number; weekday: number; hour: number; minute: number }

const partsInTimezone = (instant: number, timezone: string): CalendarParts => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(instant)
  const value = (kind: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === kind)?.value)
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    .indexOf(parts.find(part => part.type === 'weekday')?.value ?? '')
  return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour'), minute: value('minute'), weekday }
}

const calendarDate = (parts: CalendarParts, days: number): CalendarParts => {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days))
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), weekday: date.getUTCDay(), hour: 0, minute: 0 }
}

function firstCalendarInstant(date: CalendarParts, at: string, timezone: string): number | null {
  const [hour, minute] = parseTime(at)
  const nominal = Date.UTC(date.year, date.month - 1, date.day, hour, minute)
  for (let instant = nominal - 18 * 60 * 60_000; instant <= nominal + 18 * 60 * 60_000; instant += 60_000) {
    const candidate = partsInTimezone(instant, timezone)
    if (candidate.year === date.year && candidate.month === date.month && candidate.day === date.day
      && candidate.hour === hour && candidate.minute === minute) return instant
  }
  return null
}

/**
 * Resolve a calendar cadence in one explicit IANA timezone. Gaps are skipped. For folds, only the
 * first matching instant is eligible, so one local date can never fire twice.
 */
export function nextRunAtInTimezone(cadence: Cadence, from: number, timezone: string): number {
  new Intl.DateTimeFormat('en', { timeZone: timezone }).format(from)
  if ('every' in cadence) return from + cadencePeriodMs(cadence)
  const local = partsInTimezone(from, timezone)
  for (let offset = 0; offset <= 14; offset++) {
    const date = calendarDate(local, offset)
    if ('weekly' in cadence && date.weekday !== cadence.weekly.day) continue
    const instant = firstCalendarInstant(date, 'daily' in cadence ? cadence.daily : cadence.weekly.at, timezone)
    if (instant !== null && instant > from) return instant
  }
  throw new Error(`Could not resolve the next calendar occurrence in '${timezone}'.`)
}

/** Existing callers omit timezone and retain the scheduler's node-local calendar behavior. */
export function nextRunAtForTarget(
  cadence: Cadence,
  from: number,
  random: () => number = Math.random,
  timezone?: string,
): number {
  return timezone && !('every' in cadence)
    ? nextRunAtInTimezone(cadence, from, timezone)
    : nextRunAt(cadence, from, random)
}
