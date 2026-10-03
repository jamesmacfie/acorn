import type { HostOwned } from './shared.js'
import type { Disposable } from './capabilities.js'

// ── Telemetry and logging ─────────────────────────────────────────────────────────────────────────

/** What one record can carry beside its name: scalars, and nothing else.
 *
 * An object here would be a place for a request body to hide, and the rule is the audit trail's:
 * a record that quotes what it saw is a second copy of the thing. Keys are dotted and lowercase,
 * at most 64 characters; a string value is cut at 512; a record keeps at most 32 of them. */
export type TelemetryAttrs = Record<string, string | number | boolean | null>

/** A span you opened, for work whose start and end do not fit one closure. `end` is idempotent. */
export type TelemetrySpanHandle = {
  readonly traceId: string
  readonly spanId: string
  end(status?: 'ok' | 'error', attrs?: TelemetryAttrs): void
}

export type TelemetryErrorInput = {
  name: string
  /** Scrubbed by the host: control characters out, the owner's home directory and the data root
   *  collapsed, credential-shaped runs replaced, and capped at 2,000 characters. */
  message?: string
  stack?: string
  level?: 'error' | 'fatal'
  /** `true` when you caught it and carried on, which is the usual case for a plugin. */
  handled?: boolean
  attrs?: TelemetryAttrs
  traceId?: string
  spanId?: string
}

/** Measure your own work (docs/plugin-authoring/telemetry.md § Telemetry and logging).
 *
 * Every verb is stamped with your plugin id by the host, which is why there is no owner argument
 * and why an `owner` attribute you set is dropped. Every verb is a no-op when the owner has
 * telemetry off, and every verb is wrapped so that a full buffer or a throwing sink cannot reach
 * your code.
 *
 * Nothing here needs a permission. Measuring your own work reads nobody else's; reading the stream
 * is `core.telemetry` and that one is a token. */
export type PluginTelemetry = {
  /** Whether anything is collecting. Ask before taking a value that costs something, such as a
   *  process list, so the work is skipped rather than thrown away. */
  enabled(): boolean
  /** Something happened, with no duration. */
  event(name: string, attrs?: TelemetryAttrs): void
  count(name: string, value?: number, attrs?: TelemetryAttrs): void
  gauge(name: string, value: number, attrs?: TelemetryAttrs): void
  error(error: TelemetryErrorInput): void
  /** Times synchronous work and returns its result. Use startSpan for asynchronous work. */
  measure<R extends () => unknown>(name: string, run: R & (ReturnType<R> extends PromiseLike<unknown> ? never : unknown), attrs?: TelemetryAttrs): ReturnType<R>
  startSpan(name: string, options?: { attrs?: TelemetryAttrs; traceId?: string; parentSpanId?: string }): TelemetrySpanHandle
}

/** A stderr line prefixed with your plugin id, and a log record with the owner bound when the owner
 *  has telemetry on. Attributes are scalars; an object is refused at the type level. */
export type Logger = {
  debug(message: string, attrs?: TelemetryAttrs): void
  info(message: string, attrs?: TelemetryAttrs): void
  warn(message: string, attrs?: TelemetryAttrs): void
  error(message: string, attrs?: TelemetryAttrs): void
}

/** Read this node's telemetry, behind the `telemetry` token in `permissions.node.core`.
 *
 * A sink sees everything from every owner, which is why it is a token and why the trust prompt
 * draws it high. Return quickly: the collector calls sinks on a timer, awaits none of them and
 * contains a throw, so buffering, retry and sampling are yours. */
export type CoreTelemetryService = {
  /** Node consent, refreshed within five seconds. Check before retrying queued exports. */
  enabled(): boolean
  onBatch(sink: (batch: TelemetryBatch) => void): Disposable
}

/** One flush window's worth of records. `node` and `version` are on the batch rather than on every
 *  record, so a fleet with several nodes reads apart. The record shapes are in
 *  `@acorn/protocol/telemetry.ts`, which a loaded plugin cannot import, so they are opaque here. */
export type TelemetryBatch = {
  node: string
  version: string
  records: readonly HostOwned<'protocol/telemetry.TelemetryRecord'>[]
}
