// The read facet on `ctx.core`, behind the `telemetry` token (server/plugins/permissions.ts).
//
// Everything else a plugin does with telemetry is write-only and free: `ctx.telemetry` and `ctx.log`
// are on every context because a plugin measuring itself is measuring its own work. This one is a
// token, and the trust prompt draws it high, because a sink sees every record from every owner:
// core's request timings, another plugin's schedule runs, and the logger lines of packages the owner
// installed for a different reason (docs/security.md § Telemetry sinks).
//
// Batches plus a consent read for queued retries. The testkit recorder and Sentry exporter
// subscribe here; consent must come from core because plugin prefs are namespaced.
import { onTelemetryBatch, telemetrySummary, type Disposable, type TelemetrySink } from '../telemetry/collector'

export type TelemetryService = {
  /** Current node consent, re-read by the collector within five seconds. Sinks check before retrying. */
  enabled(): boolean
  /**
   * Every record this node collects, in batches, while the owner has telemetry on.
   *
   * Return quickly. The collector calls sinks in order on its flush timer, awaits none of them, and
   * contains a throw or a rejection; buffering, retry and sampling are the sink's job, because only
   * the sink knows what its vendor bills for.
   */
  onBatch(sink: TelemetrySink): Disposable
}

/**
 * The facet as one plugin sees it, with its id closed over.
 *
 * The id is here rather than on `onBatch` for the reason every other owner is: an emitter, or a
 * subscriber, cannot state its own name. The host binds it in
 * server/pluginHost/context.ts and Settings reads it back to say who is reading the stream.
 */
export const telemetryServiceFor = (owner: string): TelemetryService => ({
  enabled: () => telemetrySummary().enabled,
  onBatch: (sink) => onTelemetryBatch(sink, owner),
})

/** The unbound facet on `CoreServices`. Every plugin gets a bound one instead; this is what the
 *  node's own code holds, and its records say `core`. */
export const createTelemetryService = (): TelemetryService => telemetryServiceFor('core')

export type { TelemetrySink }
