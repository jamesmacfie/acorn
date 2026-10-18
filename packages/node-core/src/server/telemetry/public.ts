export {
  TELEMETRY_PREF_KEY,
  emitError,
  emitEvent,
  emitMetric,
  emitSpan,
  flushTelemetry,
  measure,
  newSpanId,
  newTraceId,
  onTelemetryBatch,
  setTelemetryPref,
  startTelemetry,
  stopTelemetry,
  telemetryEnabled,
  whenTelemetryEnabled,
} from './collector.ts'
export type { Disposable, PluginTelemetry, SpanHandle } from './collector.ts'
export { createLogger, describeError, installPerfSink } from './logger.ts'
export type { Logger } from './logger.ts'
export { scrub, setTelemetryDataRoot } from './scrub.ts'
