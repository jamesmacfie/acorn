import type { TelemetryRecord } from '../../runtime/telemetry.ts'

// Run targets (docs/workflows.md § Routes and UI): the renderer shares the RunBridge routes the MCP
// run tools use (server/routes/plugins/harness.ts). Replaced the `run:*` IPC channels.
export const runTargetsRoute = (taskId: string) => `/v1/core/tasks/${taskId}/run`
export const runDefaultUrlRoute = (taskId: string) => `/v1/core/tasks/${taskId}/run/default-url`
export const runStartRoute = (taskId: string, targetId: string) => `/v1/core/tasks/${taskId}/run/${encodeURIComponent(targetId)}/start`
export const runStopRoute = (taskId: string, targetId: string) => `/v1/core/tasks/${taskId}/run/${encodeURIComponent(targetId)}/stop`
export const runStatusRoute = (taskId: string, targetId: string) => `/v1/core/tasks/${taskId}/run/${encodeURIComponent(targetId)}/status`

// Where every runtime that is not the node posts its telemetry (docs/telemetry/runtimes.md § Other runtimes).
// Device-only, because a record admitted here reaches every sink, and a sink can send it off the
// machine.
export const coreTelemetryRoute = '/v1/core/telemetry'
// What Settings → Telemetry draws: counters, never records (docs/telemetry/diagnosis.md § What the page
// shows). Device-only, like the route above, and for a smaller reason: it names which plugins are
// reading the stream, which is a fact about this machine's installation.
export const coreTelemetrySummaryRoute = '/v1/core/telemetry/summary'

/** The node's own account of what it has collected since it started.
 *
 *  Counters rather than a window over the ring. The ring holds 5,000 records and a sink may have
 *  drained it a second ago, so a page built on the ring would answer "what is being collected" with
 *  whatever happened in the last five seconds. */
export type TelemetrySummary = {
  /** The `telemetry.enabled` preference, as the collector last read it. */
  enabled: boolean
  /** The preference on and at least one sink subscribed, which is what it takes to build a record. */
  collecting: boolean
  /** When this node's collector started, in epoch milliseconds. Every count below is since then. */
  since: number
  /** When a batch last went to the sinks, or null when none has. */
  lastFlushAt: number | null
  /** Records the ring dropped at its cap, and attributes cut at theirs. */
  dropped: number
  truncated: number
  /** Who is reading the stream, by plugin id. `core` is the node's own, such as the `ACORN_PERF`
   *  printer. */
  sinks: string[]
  /** One row per owner and kind, so the page can say what each plugin is producing. */
  records: Array<{ owner: string; kind: TelemetryRecord['kind']; count: number }>
}

// Schedules: periodic work owned by the node (docs/schedules.md). The row and cadence types live in
// @acorn/protocol/schedules.ts, which needs zod for the cadence parser. This module does not carry that dependency.
//
// A key contains a colon ('core:audit-prune'), so every builder below encodes it.
export const schedulesRoute = '/v1/core/schedules'
export const scheduleRoute = (key: string) => `${schedulesRoute}/${encodeURIComponent(key)}`
export const scheduleRunNowRoute = (key: string) => `${scheduleRoute(key)}/run`
export const scheduleRunsRoute = (key: string) => `${scheduleRoute(key)}/runs`
/** What this node can actually run, for the creation picker. Only what resolves is offered, so a
 *  schedule can never be created against something that does not exist. */
export const scheduleTargetsRoute = `${schedulesRoute}/targets`
/** Re-take consent after a target's declared risk tier rose. The client can't name a tier here: it
 *  posts nothing and the node re-stamps from the registry, so accepting is always accepting the tier
 *  the host just showed. */
export const scheduleConfirmRoute = (key: string) => `${scheduleRoute(key)}/confirm`

// Dashboards: the measure series behind a stat's trend (docs/dashboards.md § Trends). Read-only by
// design, not by phase: the sampler and the store share a process, so the only writer is the
// `core:sample-measures` schedule and a write route would have nobody to serve.
//
// An empty series answers 200 with an empty array, never 404. Absence is data, and a panel given a
// trend a minute ago has a cold state to render rather than an error to branch on.
export const dashboardHistoryRoute = '/v1/core/dashboards/history'
export type DashboardMeasureSample = { bucket: number; value: number }
export type DashboardHistoryResponse = { signature: string; samples: DashboardMeasureSample[] }
