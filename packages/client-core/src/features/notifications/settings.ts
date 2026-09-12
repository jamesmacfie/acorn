// The notification switches, as one JSON device preference
// (docs/notifications.md § Settings).
//
// One key holding six booleans, not six keys, for the reason `docker_prefs` and `exclusive_slots`
// give: a value that is read together is stored together, and six keys would mean six `DEVICE_KEYS`
// lines and a migration the day a seventh appears. The parser below is the migration: every field
// that is missing, or is not a boolean, reads as `true`, so a fresh install and a blob written by an
// older build both behave the way the design intends.
//
// The device's, like `theme`. A sound on this machine is not a fact about the node.
import type { QueryClient } from '@tanstack/solid-query'
import { readDevicePrefs } from '../../infra/persistence/devicePrefs'
import { PrefKeys } from '../../infra/persistence/prefKeys'
import { saveJsonPref } from '../settings/savePref'

export type NotificationSettings = {
  sound: boolean
  system: boolean
  badge: boolean
  events: { blocked: boolean; finished: boolean; error: boolean }
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  sound: true, system: true, badge: true, events: { blocked: true, finished: true, error: true },
}

// Absent, malformed, and "some other writer put a string here" all mean on. Only an explicit `false`
// turns a channel off, because the switch the user flipped is the only reason to be quiet.
const on = (value: unknown): boolean => value !== false

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}

export function parseNotificationSettings(json: string | undefined): NotificationSettings {
  let raw: Record<string, unknown> = {}
  try {
    if (json) raw = object(JSON.parse(json))
  } catch {
    // Not JSON is not a setting. Every field falls back to its default below.
  }
  const events = object(raw.events)
  return {
    sound: on(raw.sound),
    system: on(raw.system),
    badge: on(raw.badge),
    events: { blocked: on(events.blocked), finished: on(events.finished), error: on(events.error) },
  }
}

// What the gate reads. Straight from the device store rather than the prefs query, because the gate
// is not a component and has no query client to hand: this key never reaches a node, so localStorage
// is the whole truth and `savePref` writes it before it touches the cache.
export const readNotificationSettings = (): NotificationSettings =>
  parseNotificationSettings(readDevicePrefs()[PrefKeys.notifications])

/**
 * One switch, written as a merge onto the whole record.
 *
 * A merge and not a replace, because the six booleans share one key: writing `{ sound: false }` on its
 * own would turn the other five off, since every absent field reads as `true`. Settings → Notifications
 * and the palette's setting commands both come through here so there is one merge rule and not two.
 */
export const saveNotificationSettings = (
  qc: QueryClient,
  current: NotificationSettings,
  patch: Partial<NotificationSettings>,
): Promise<boolean> => saveJsonPref(qc, PrefKeys.notifications, { ...current, ...patch })

/** The same, one level down: the three event switches are a nested object, so they merge twice. */
export const saveNotificationEvent = (
  qc: QueryClient,
  current: NotificationSettings,
  patch: Partial<NotificationSettings['events']>,
): Promise<boolean> => saveNotificationSettings(qc, current, { events: { ...current.events, ...patch } })
