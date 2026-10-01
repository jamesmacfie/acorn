// ── The registries ────────────────────────────────────────────────────────────────────────────────

/** Periodic work the node runs, whether or not a client is attached (docs/schedules.md). A loaded
 *  plugin normally declares these in its manifest, which is what puts them in front of the owner at
 *  install; the host registers those through this same seam. Any `setInterval` in plugin code is a
 *  review flag. */
export type PluginScheduleRegistry = {
  register(schedule: PluginSchedule): void
}

/** How often a schedule runs. Clamped on read to the plugin floor of 300 seconds, never rejected: a
 *  stored out-of-range value would otherwise be a row the owner can see and the node refuses to load.
 *  `at` is `HH:MM` in the node's local time; `day` is 0 for Sunday. */
export type Cadence =
  | { every: number }
  | { daily: string }
  | { weekly: { day: number; at: string } }

export type PluginSchedule = {
  /** Unique within this plugin. The host prefixes it with your id. */
  scheduleId: string
  name: string
  cadence: Cadence
  /** Seconds, capped at 300. Absent means the engine default of 60. */
  timeout?: number
  enabled?: boolean
  /** Fires on timeout and on node shutdown. Report failure by throwing; the return value is one line of
   *  detail for the run row. */
  run(signal: AbortSignal): Promise<string | void>
}
