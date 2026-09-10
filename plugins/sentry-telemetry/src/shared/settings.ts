// What the owner chose on this plugin's settings page, and the one place the shape is written.
//
// Both halves read it. The settings tree writes the object through `bridge.state.set('settings', …)`
// and the node half reads it back through `ctx.core.prefs`, which is the same
// `plugin:sentry-telemetry:settings` row on both sides (protocol/plugin/state.ts). So the parser
// lives here, in `shared/`, rather than being written twice and drifting.
//
// Everything here is the sink's own decision to make. Core has one switch and never samples, because
// only a sink knows which signals its vendor bills for (docs/telemetry.md § The collector).

/** Which of the five record kinds this exporter sends. Each maps to a Sentry item that costs money. */
export type SentryKindSwitches = {
  span: boolean
  log: boolean
  event: boolean
  metric: boolean
  error: boolean
}

export type SentrySettings = {
  /** Spans only, 0 to 1, decided per trace so a transaction and its children survive together. */
  sampleRate: number
  kinds: SentryKindSwitches
  /** Send `stack` on an error event. Off leaves Sentry with a type, a message, and the tags. */
  stacks: boolean
  /** Send the `task.id` attribute as a Sentry tag. Off drops it from every record on the way out. */
  taskIds: boolean
}

/** Everything on, nothing sampled away. A single-user tool produces little, and the owner turning
 *  the switch on wants to see what happens next. */
export const DEFAULT_SETTINGS: SentrySettings = {
  sampleRate: 1,
  kinds: { span: true, log: true, event: true, metric: true, error: true },
  stacks: true,
  taskIds: true,
}

const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Read a stored settings value, whatever it turns out to be.
 *
 * Never throws and never returns a partial object. The row is written by a sandboxed frame and read
 * on a flush, so a half-written or hand-edited value has to answer with the defaults rather than
 * stop the export.
 */
export function parseSettings(raw: unknown): SentrySettings {
  if (!isRecord(raw)) return DEFAULT_SETTINGS
  const kinds = isRecord(raw.kinds) ? raw.kinds : {}
  const rate = typeof raw.sampleRate === 'number' && Number.isFinite(raw.sampleRate) ? raw.sampleRate : DEFAULT_SETTINGS.sampleRate
  return {
    sampleRate: Math.min(1, Math.max(0, rate)),
    kinds: {
      span: bool(kinds.span, DEFAULT_SETTINGS.kinds.span),
      log: bool(kinds.log, DEFAULT_SETTINGS.kinds.log),
      event: bool(kinds.event, DEFAULT_SETTINGS.kinds.event),
      metric: bool(kinds.metric, DEFAULT_SETTINGS.kinds.metric),
      error: bool(kinds.error, DEFAULT_SETTINGS.kinds.error),
    },
    stacks: bool(raw.stacks, DEFAULT_SETTINGS.stacks),
    taskIds: bool(raw.taskIds, DEFAULT_SETTINGS.taskIds),
  }
}

/** The preference key both halves use, relative to the plugin's own namespace. */
export const SETTINGS_KEY = 'settings'

/** The provider id, which is also the plugin id. One connection holds the DSN. */
export const PROVIDER_ID = 'sentry-telemetry'

/** What every envelope reports itself as. A bundle cannot read a `package.json` that is not inside
 *  it, so the version is written here and `settings.test.ts` holds the two in step. */
export const SDK_NAME = 'acorn.sentry-telemetry'
export const SDK_VERSION = '0.1.0'
