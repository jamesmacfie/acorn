import { z } from 'zod'
import type { ToolRisk } from './api'

// The scheduler's shared vocabulary (docs/schedules.md). One scheduler lives in the node process and
// three parties put work on it — core, plugins, and the user — so the cadence grammar, the merged row
// and the run record all have to be nameable from both sides of the wire.
//
// Cadence is a BUDGETED VOCABULARY, not a language: three forms, node-local time, and no five-field
// cron. A cron expression is a thing to parse, explain and debug, and none of the use cases this was
// sized against needs "the last Friday of the month". Additive later at the cost of arguing for it.

/** Below this a schedule is a poll, and polling is the client's job for a person who is present. */
export const CADENCE_MIN_SECONDS = 60
/** A plugin's floor is higher than core's: its work hits someone else's rate budget, not ours. */
export const CADENCE_MIN_SECONDS_PLUGIN = 300
/** A week. Past this, "when" is a calendar question the three forms cannot answer honestly. */
export const CADENCE_MAX_SECONDS = 604_800

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)

// `every` is unbounded HERE and clamped on read (clampCadence below), because the storage rules are
// tolerant-codec rules: a stored out-of-range value is clamped, never rejected. Rejecting would mean a
// row the owner can see but the node refuses to load, which is the failure mode this avoids.
export const cadenceSchema = z.union([
  z.object({ every: z.number().finite().positive() }),
  z.object({ daily: timeOfDay }),
  z.object({ weekly: z.object({ day: z.number().int().min(0).max(6), at: timeOfDay }) }),
])

export type Cadence = z.infer<typeof cadenceSchema>

export type ScheduleOwner = 'core' | 'plugin' | 'user'
export type ScheduleStatus = 'ok' | 'error' | 'timeout' | 'skipped'

/** One row of the merged view: a registry entry, a user row, or a retained state row whose declaration
 *  is currently absent (`registered: false` — a disabled plugin must not delete the owner's pause or
 *  its run history). */
export type ScheduleRow = {
  key: string
  owner: ScheduleOwner
  /** Set when `owner === 'plugin'`; the badge the settings list renders. */
  pluginId?: string
  name: string
  /** Target kind. Declared schedules report their own; a user row reports what it was created with,
   *  which may be a kind this version cannot run (`registered: false`). */
  kind: string
  /** What the loop will actually use — the owner's retune if there is one, else the declared cadence. */
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
  /** Set while consecutive failures are backing the schedule off. Visible on purpose: a silent retry
   *  loop is how rate limits die. */
  backoffUntil?: number
  /** Stamped at CREATION from the target's declared tier — the consent record for a user schedule. */
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

/** Clamp a cadence into the allowed range rather than rejecting it (see cadenceSchema above). */
export function clampCadence(cadence: Cadence, floorSeconds = CADENCE_MIN_SECONDS): Cadence {
  if (!('every' in cadence)) return cadence
  return { every: Math.min(Math.max(Math.round(cadence.every), floorSeconds), CADENCE_MAX_SECONDS) }
}

/** Parse a stored/wire cadence tolerantly. `null` means "this value is not a cadence at all", which the
 *  caller turns into the declared default — never into a refusal to load the row. */
export function parseCadence(raw: unknown, floorSeconds = CADENCE_MIN_SECONDS): Cadence | null {
  const parsed = cadenceSchema.safeParse(raw)
  return parsed.success ? clampCadence(parsed.data, floorSeconds) : null
}

/** The nominal length of one cycle. Used for backoff arithmetic and for deciding whether a late run is
 *  a catch-up; NOT for computing the next fire time, which is calendar work for the two dated forms. */
export function cadencePeriodMs(cadence: Cadence): number {
  if ('every' in cadence) return cadence.every * 1000
  if ('daily' in cadence) return 24 * 60 * 60 * 1000
  return 7 * 24 * 60 * 60 * 1000
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Cadence in words, for the settings list. "every hour", "daily at 03:30" — the row says when it runs
 *  in the same register a person would say it. */
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
