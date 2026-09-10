// One telemetry record out of a sandboxed frame, checked and emitted with the host's own owner
// stamped on it (docs/telemetry.md § A frame's own records).
//
// Beside the broker rather than inside it for the reason the broker's own comment gives: that file
// is the security choke point and stays a readable switch over verbs. This is the one verb whose
// payload is a shape rather than a path, so its checking is a page of its own.
//
// Hand-rolled checks, like every other verb here. The wire types in @acorn/protocol/plugin/bridge.ts
// are types and not Zod schemas, because the trust boundary is inverted: the host decides whether to
// act at all, and a schema in front of that would validate the shape of something it is about to
// drop anyway.
//
// Nothing a frame sends can reach the collector unlabelled. `owner` comes from the binding, the ids
// and the timestamps are minted here, and every attribute goes through the emitter's own caps.
import type { PluginBridgeTelemetryAttrs, PluginBridgeTelemetryRecord } from '@acorn/protocol/plugin/bridge.ts'
import type { TelemetryAttrs } from '@acorn/protocol/telemetry.ts'
import { currentTrace, emitError, emitEvent, emitLog, emitMetric, emitSpan, newSpanId, newTraceId } from '../../infra/telemetry/emitter'

/** A frame's own name for what it did. Long enough for `fetch-issues-for-the-open-project`, short
 *  enough that a name is a name and not a message. */
const NAME_MAX = 120
const LEVELS = new Set(['debug', 'info', 'warn', 'error'])

const name = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.slice(0, NAME_MAX) : null

/** A finite number, so `NaN` and `Infinity` cannot reach a histogram and make every percentile after
 *  them unreadable. */
const finite = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)

/** Scalars only, and the emitter's caps do the rest. A key with an object under it is dropped here
 *  rather than stringified, because the reason attributes are scalars is that an object is where a
 *  request body hides. */
function attrs(value: unknown): TelemetryAttrs {
  const out: TelemetryAttrs = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out
  for (const [key, entry] of Object.entries(value as PluginBridgeTelemetryAttrs)) {
    if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean' || entry === null) out[key] = entry
  }
  return out
}

/**
 * Emit what one frame asked for, or drop it.
 *
 * Dropped and never answered. A frame that sends nonsense has a bug in its own telemetry, and
 * failing its port over that would take the plugin's UI down to protect a metric. The rate window
 * is the answer to a frame that does it in a loop, and the broker applies that before this runs.
 */
export function recordFrameTelemetry(pluginId: string, raw: unknown): void {
  if (!raw || typeof raw !== 'object') return
  const record = raw as PluginBridgeTelemetryRecord
  const seam = { seam: 'frame.telemetry' }
  switch (record.type) {
    case 'event': {
      const which = name(record.name)
      if (which) emitEvent(pluginId, which, { ...seam, ...attrs(record.attrs) })
      return
    }
    case 'count':
    case 'gauge': {
      const which = name(record.name)
      const value = finite(record.value)
      if (which && value !== null) emitMetric(pluginId, { name: which, type: record.type, value, attrs: { ...seam, ...attrs(record.attrs) } })
      return
    }
    case 'span': {
      const which = name(record.name)
      const durationMs = finite(record.durationMs)
      if (!which || durationMs === null || durationMs < 0) return
      // The ids are the host's. A frame that could name a trace could hang its span under somebody
      // else's interaction, and it has no way to know a trace id in the first place. Under the open
      // interaction when there is one, exactly like a span the shell itself raises.
      const trace = currentTrace()
      emitSpan(pluginId, {
        traceId: trace?.traceId ?? newTraceId(),
        spanId: newSpanId(),
        ...(trace ? { parentSpanId: trace.spanId } : {}),
        name: which,
        start: Date.now() - durationMs,
        durationMs,
        status: record.status === 'error' ? 'error' : 'ok',
        attrs: { ...seam, ...attrs(record.attrs) },
      })
      return
    }
    case 'log': {
      const body = name(record.message)
      if (!body || !LEVELS.has(record.level)) return
      // `logger` is the plugin id and not a tag the frame chose, because a frame's log line has one
      // useful answer to "who wrote this" and it is the plugin the reader can turn off.
      emitLog(pluginId, { at: Date.now(), level: record.level, logger: pluginId, body, attrs: { ...seam, ...attrs(record.attrs) } })
      return
    }
    case 'error': {
      const which = name(record.name)
      if (!which) return
      // No stack. A frame's stack is inside its own bundle, under an origin that is a content hash,
      // so it names lines nobody outside that frame can resolve.
      emitError(pluginId, {
        name: which,
        message: typeof record.message === 'string' ? record.message : '',
        handled: true,
        attrs: { ...seam, ...attrs(record.attrs) },
      })
    }
  }
}
