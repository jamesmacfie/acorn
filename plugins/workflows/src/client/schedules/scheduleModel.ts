import type { Cadence } from '@acorn/protocol/schedules.ts'
import type { WorkflowScheduleDisplayState, WorkflowScheduleLimits } from '../../shared/workflowSchedules'

const parseTime = (value: string): [number, number] => value.split(':').map(Number) as [number, number]

type Parts = { year: number; month: number; day: number; weekday: number; hour: number; minute: number }

const partsAt = (instant: number, timezone: string): Parts => {
  const values = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(instant)
  const number = (type: Intl.DateTimeFormatPartTypes) => Number(values.find(part => part.type === type)?.value)
  return {
    year: number('year'), month: number('month'), day: number('day'), hour: number('hour'), minute: number('minute'),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values.find(part => part.type === 'weekday')?.value ?? ''),
  }
}

const shiftedDate = (parts: Parts, days: number): Parts => {
  const value = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days))
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate(), weekday: value.getUTCDay(), hour: 0, minute: 0 }
}

const firstInstant = (date: Parts, at: string, timezone: string): number | null => {
  const [hour, minute] = parseTime(at)
  const nominal = Date.UTC(date.year, date.month - 1, date.day, hour, minute)
  for (let instant = nominal - 18 * 60 * 60_000; instant <= nominal + 18 * 60 * 60_000; instant += 60_000) {
    const candidate = partsAt(instant, timezone)
    if (candidate.year === date.year && candidate.month === date.month && candidate.day === date.day
      && candidate.hour === hour && candidate.minute === minute) return instant
  }
  return null
}

export function nextScheduleOccurrence(cadence: Cadence, after: number, timezone: string): number {
  new Intl.DateTimeFormat('en', { timeZone: timezone }).format(after)
  if ('every' in cadence) return after + cadence.every * 1000
  const local = partsAt(after, timezone)
  for (let offset = 0; offset <= 14; offset++) {
    const date = shiftedDate(local, offset)
    if ('weekly' in cadence && date.weekday !== cadence.weekly.day) continue
    const instant = firstInstant(date, 'daily' in cadence ? cadence.daily : cadence.weekly.at, timezone)
    if (instant !== null && instant > after) return instant
  }
  throw new Error(`Could not find the next occurrence in ${timezone}.`)
}

export function nextScheduleOccurrences(cadence: Cadence, timezone: string, after = Date.now(), count = 3): number[] {
  const result: number[] = []
  let cursor = after
  while (result.length < count) {
    cursor = nextScheduleOccurrence(cadence, cursor, timezone)
    result.push(cursor)
  }
  return result
}

/** "Oct 3, 2026, 9:00 AM GMT+13": to the minute, because a schedule never fires on a second. */
export const formatOccurrence = (instant: number, timezone: string): string => new Intl.DateTimeFormat(undefined, {
  timeZone: timezone, year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
}).format(instant)

export const scheduleStateLabel = (state: WorkflowScheduleDisplayState): string => ({
  draft: 'Draft', activating: 'Activating', active: 'Active', paused: 'Paused',
  'needs-review': 'Needs review', unavailable: 'Unavailable',
})[state]

/** In minutes, the unit the Definition inspector and this dialog's own field use. */
export const limitsSummary = (limits: WorkflowScheduleLimits): string =>
  `Up to ${limits.maxDescendants} tasks, ${limits.maxConcurrency} at a time, ${limits.budget.maxWallTimeMs / 60_000} minutes.`

export const cadenceChoice = (cadence: Cadence): 'hourly' | 'daily' | 'weekly' =>
  'every' in cadence ? 'hourly' : 'daily' in cadence ? 'daily' : 'weekly'

export const cadenceForChoice = (choice: 'hourly' | 'daily' | 'weekly'): Cadence =>
  choice === 'hourly' ? { every: 3600 } : choice === 'daily' ? { daily: '09:00' } : { weekly: { day: 1, at: '09:00' } }
