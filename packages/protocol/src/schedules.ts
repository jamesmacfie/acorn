import { z } from 'zod'
import type { ToolRisk } from './api'

// The scheduler's shared vocabulary. One scheduler lives in the node process and three parties put
// work on it: core, plugins, and the user. See docs/schedules.md § Cadence for why it is a budgeted
// vocabulary rather than cron.

/** Below this a schedule is a poll, and polling is the client's job for a person who is present. */
export const CADENCE_MIN_SECONDS = 60
/** A plugin's floor is higher than core's: its work hits someone else's rate budget, not ours. */
export const CADENCE_MIN_SECONDS_PLUGIN = 300
/** A week. Past this, "when" is a calendar question the three forms cannot answer honestly. */
export const CADENCE_MAX_SECONDS = 604_800

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)

// `every` is unbounded here and clamped on read (`clampCadence` below). See docs/schedules.md §
// Cadence: a stored out-of-range value is clamped, never rejected, because rejecting would mean a row
// the owner can see but the node refuses to load.
export const cadenceSchema = z.union([
  z.object({ every: z.number().finite().positive() }),
  z.object({ daily: timeOfDay }),
  z.object({ weekly: z.object({ day: z.number().int().min(0).max(6), at: timeOfDay }) }),
])

export type Cadence = z.infer<typeof cadenceSchema>

export type ScheduleOwner = 'core' | 'plugin' | 'user'
export type ScheduleStatus = 'ok' | 'error' | 'timeout' | 'skipped'

/** One row of the merged view: a registry entry, a user row, or a retained state row whose
 *  declaration is currently absent. `registered: false` means a disabled plugin must not delete the
 *  owner's pause or its run history. */
export type ScheduleRow = {
  key: string
  owner: ScheduleOwner
  /** Set when `owner === 'plugin'`; the badge the settings list renders. */
  pluginId?: string
  name: string
  /** Target kind. Declared schedules report their own; a user row reports what it was created with,
   *  which may be a kind this version cannot run (`registered: false`). */
  kind: string
  /** What the loop will actually use: the owner's retune if there is one, else the declared cadence. */
  cadence: Cadence
  /** Present only when the owner has retuned it, so the settings list can say what it was. */
  declaredCadence?: Cadence
  enabled: boolean
  /** False when nothing can run this key right now: the plugin is disabled, or the target kind is
   *  unknown to this version. The row still renders, and its state survives. */
  registered: boolean
  nextRunAt: number
  lastRunAt?: number
  lastStatus?: ScheduleStatus
  lastError?: string
  /** Set while consecutive failures are backing the schedule off. Visible, because a silent retry
   *  loop is how rate limits die. */
  backoffUntil?: number
  /** Stamped at creation from the target's declared tier: the consent record for a user schedule. */
  risk?: ToolRisk
}

export type ScheduleRun = {
  startedAt: number
  finishedAt?: number
  status: ScheduleStatus
  /** One line: '14 panels sampled', 'catch-up', or the error. */
  detail?: string
}

export type SchedulesResponse = {
  /** The global kill switch. Stops the loop without touching a single row. */
  paused: boolean
  schedules: ScheduleRow[]
}

/** One thing a person may put on a schedule, as the creation flow sees it (docs/schedules.md §
 *  Targets).
 *
 *  The list is what resolves on this node right now, which is the whole promise the picker makes: a
 *  schedule can never be created against something this node cannot run, so there is nothing for the
 *  creation form to validate after the fact.
 *
 *  `risk` is the tier the host draws the arming confirmation from and stamps onto the row. It is
 *  never absent: an action that declares nothing is reported as `execute`, the strongest, because the
 *  direction that cannot be wrong in a way that matters is the safe one. */
export type ScheduleTargetOption = {
  kind: 'node-action'
  pluginId: string
  actionId: string
  name: string
  risk: ToolRisk
}

export type ScheduleTargetsResponse = { targets: ScheduleTargetOption[] }

/** Clamp a cadence into the allowed range rather than rejecting it (see cadenceSchema above). */
export function clampCadence(cadence: Cadence, floorSeconds = CADENCE_MIN_SECONDS): Cadence {
  if (!('every' in cadence)) return cadence
  return { every: Math.min(Math.max(Math.round(cadence.every), floorSeconds), CADENCE_MAX_SECONDS) }
}

/** Parse a stored/wire cadence tolerantly. `null` means this value is not a cadence at all, which the
 *  caller turns into the declared default, never into a refusal to load the row. */
export function parseCadence(raw: unknown, floorSeconds = CADENCE_MIN_SECONDS): Cadence | null {
  const parsed = cadenceSchema.safeParse(raw)
  return parsed.success ? clampCadence(parsed.data, floorSeconds) : null
}

/** The nominal length of one cycle. Used for backoff arithmetic and for deciding whether a late run is
 *  a catch-up; not for computing the next fire time, which is calendar work for the two dated forms. */
export function cadencePeriodMs(cadence: Cadence): number {
  if ('every' in cadence) return cadence.every * 1000
  if ('daily' in cadence) return 24 * 60 * 60 * 1000
  return 7 * 24 * 60 * 60 * 1000
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Cadence in words, for the settings list. 'every hour', 'daily at 03:30': the row says when it
 *  runs in the same register a person would say it. */
export function describeCadence(cadence: Cadence): string {
  if ('daily' in cadence) return `daily at ${cadence.daily}`
  if ('weekly' in cadence) return `${DAYS[cadence.weekly.day] ?? 'weekly'}s at ${cadence.weekly.at}`
  const seconds = cadence.every
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600
    return hours === 1 ? 'every hour' : `every ${hours} hours`
  }
  if (seconds % 60 === 0) {
    const minutes = seconds / 60
    return minutes === 1 ? 'every minute' : `every ${minutes} minutes`
  }
  return `every ${seconds} seconds`
}
