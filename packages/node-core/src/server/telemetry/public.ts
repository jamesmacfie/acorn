export {
  TELEMETRY_PREF_KEY, emitError, emitEvent, emitMetric, emitSpan,
  flushTelemetry, measure, onTelemetryBatch, setTelemetryPref,
  startTelemetry, stopTelemetry, telemetryEnabled,
} from './collector.ts'
export type { Disposable, PluginTelemetry, SpanHandle, TelemetrySink } from './collector.ts'
export { createLogger, describeError, installPerfSink } from './logger.ts'
export type { Logger } from './logger.ts'
export { scrub, setTelemetryDataRoot } from './scrub.ts'
