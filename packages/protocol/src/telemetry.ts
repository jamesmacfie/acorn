// What one telemetry record looks like, and what a batch of them looks like on the wire.
//
// Here rather than in node-core because from phase 1 the renderer, the terminal client and the
// desktop helper all build batches and post them to the node, and protocol is the one package every
// runtime imports (docs/telemetry.md § The five kinds).
//
// The field names are OpenTelemetry's and none of its code is here. That is the whole reason a
// second exporter is cheap: Better Stack, Coralogix and Datadog all take OTLP, so a sink that speaks
// one of them maps these names across rather than inventing a translation.
//
// Two rules run through every shape below, and both come from the audit trail
// (node-core server/audit.ts § AuditEntry.details): an attribute is a scalar, and a record never
// quotes the work it describes. A record that carried a prompt, a diff or a query would be a second
// copy of the thing it is supposed to be measuring.
import { z } from 'zod'

/** The one node preference that turns collection on. Off unless the row says `'1'`. */
export const TELEMETRY_PREF_KEY = 'telemetry.enabled'

// The caps. The collector truncates rather than dropping, and counts each truncation, so a seam that
// keeps hitting one of these is visible as a metric instead of quietly losing its tail.
export const ATTR_KEY_MAX = 64
export const ATTR_VALUE_MAX = 512
export const ATTRS_MAX = 32
export const LOG_BODY_MAX = 2_000

/** Scalars only. An object here would be a place for a request body to hide, and a nested shape is
 *  something no sink's column model can index anyway. */
export const telemetryAttrsSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
export type TelemetryAttrs = z.infer<typeof telemetryAttrsSchema>

/** W3C sizes: 32 hex characters for a trace, 16 for a span, so a `traceparent` header round-trips
 *  with no conversion at either end. */
const traceIdSchema = z.string().regex(/^[0-9a-f]{32}$/)
const spanIdSchema = z.string().regex(/^[0-9a-f]{16}$/)

export const telemetrySpanSchema = z.object({
  kind: z.literal('span'),
  traceId: traceIdSchema,
  spanId: spanIdSchema,
  parentSpanId: spanIdSchema.optional(),
  // A pattern, never one instance: `http.request` with the route as an attribute, not a hundred URLs
  // (docs/telemetry.md § The admission rule for a span).
  name: z.string().min(1),
  // Milliseconds since the epoch, and milliseconds of duration.
  start: z.number(),
  durationMs: z.number(),
  status: z.enum(['ok', 'error']),
  attrs: telemetryAttrsSchema,
})

export const telemetryLogSchema = z.object({
  kind: z.literal('log'),
  at: z.number(),
  level: z.enum(['debug', 'info', 'warn', 'error']),
  // Who wrote the line: a core tag such as `server` or `schedules`, or a plugin id.
  logger: z.string(),
  body: z.string(),
  attrs: telemetryAttrsSchema,
  traceId: traceIdSchema.optional(),
})

export const telemetryEventSchema = z.object({
  kind: z.literal('event'),
  at: z.number(),
  name: z.string().min(1),
  attrs: telemetryAttrsSchema,
})

/** A histogram arrives pre-aggregated over one flush window. That is how a seam firing a thousand
 *  times a second costs one record every five seconds instead of a thousand spans a sink has to
 *  drop (docs/telemetry.md § Hot seams are metrics). */
export const telemetryHistogramSchema = z.object({
  count: z.number(),
  sum: z.number(),
  min: z.number(),
  max: z.number(),
  p50: z.number(),
  p95: z.number(),
})
export type TelemetryHistogram = z.infer<typeof telemetryHistogramSchema>

export const telemetryMetricSchema = z.object({
  kind: z.literal('metric'),
  at: z.number(),
  name: z.string().min(1),
  type: z.enum(['count', 'gauge', 'histogram']),
  value: z.union([z.number(), telemetryHistogramSchema]),
  unit: z.string().optional(),
  attrs: telemetryAttrsSchema,
})

export const telemetryErrorSchema = z.object({
  kind: z.literal('error'),
  at: z.number(),
  name: z.string(),
  // Scrubbed before it gets here. A boundary that already withholds a message keeps withholding:
  // `onServerError` sends a name and a code and no message at all, because drivers embed bound
  // values in `err.message`.
  message: z.string(),
  // Opt in per record. The logger leaves it off; a crash handler puts it on, because a fatal error
  // with no stack is not worth sending anywhere.
  stack: z.string().optional(),
  level: z.enum(['error', 'fatal']),
  handled: z.boolean(),
  attrs: telemetryAttrsSchema,
  traceId: traceIdSchema.optional(),
  spanId: spanIdSchema.optional(),
})

export const telemetryRecordSchema = z.discriminatedUnion('kind', [
  telemetrySpanSchema,
  telemetryLogSchema,
  telemetryEventSchema,
  telemetryMetricSchema,
  telemetryErrorSchema,
])

export type TelemetrySpan = z.infer<typeof telemetrySpanSchema>
export type TelemetryLog = z.infer<typeof telemetryLogSchema>
export type TelemetryEvent = z.infer<typeof telemetryEventSchema>
export type TelemetryMetric = z.infer<typeof telemetryMetricSchema>
export type TelemetryError = z.infer<typeof telemetryErrorSchema>
export type TelemetryRecord = z.infer<typeof telemetryRecordSchema>

/** Which runtime built a batch. The node re-stamps this from the principal on arrival rather than
 *  trusting the body, so a batch cannot claim to be somebody else's process. */
export const TELEMETRY_RUNTIMES = ['node', 'renderer', 'helper', 'tui', 'shell'] as const
export type TelemetryRuntime = (typeof TELEMETRY_RUNTIMES)[number]

/** Which runtimes may post a batch to the node, which is every runtime except the node itself.
 *
 *  A posted batch names its own runtime, because a device token says only that the caller holds one
 *  and cannot tell the renderer, the helper and the terminal client apart. What the node does not
 *  take on trust is `node`: the collector stamps that on its own records, so leaving it postable
 *  would let anything holding a device token file records as the node's own. */
export const POSTED_TELEMETRY_RUNTIMES = ['renderer', 'helper', 'tui', 'shell'] as const
export type PostedTelemetryRuntime = (typeof POSTED_TELEMETRY_RUNTIMES)[number]

/** The body of `POST /v2/core/telemetry`: which runtime built these records, and the records.
 *
 *  No `node` and no `version`, unlike the batch a sink is handed below. The node the batch reached
 *  is the node that will hold it, and it stamps its own id and build onto the batch it flushes, so
 *  a sender saying either would only be saying something the receiver already knows better. */
export const postedTelemetryBatchSchema = z.object({
  runtime: z.enum(POSTED_TELEMETRY_RUNTIMES),
  records: z.array(telemetryRecordSchema),
})
export type PostedTelemetryBatch = z.infer<typeof postedTelemetryBatchSchema>

/** How much of a batch the node will read. A renderer flushes at 500 records and each record is
 *  capped attribute by attribute, so an honest batch is tens of kilobytes and this is the ceiling on
 *  a dishonest one. */
export const TELEMETRY_BATCH_MAX_BYTES = 1024 * 1024

/** `node` and `version` are on the batch rather than on every record, so a fleet with several nodes
 *  reads apart without paying for the id a thousand times. */
export const telemetryBatchSchema = z.object({
  node: z.string(),
  version: z.string(),
  records: z.array(telemetryRecordSchema),
})
export type TelemetryBatch = z.infer<typeof telemetryBatchSchema>

/** What a parsed `traceparent` header says: which trace this belongs to, and which span to hang the
 *  next one under. */
export type Traceparent = { traceId: string; parentSpanId: string; sampled: boolean }

// `traceparent` is attacker-controlled input on every request, so this accepts exactly the W3C form
// and nothing adjacent to it: two hex digits of version, 32 of trace id, 16 of parent id, two of
// flags. An all-zero id is refused because the spec says it is invalid, and treating it as a real
// trace would merge unrelated requests into one.
//
// The raw header never reaches a log line. A caller that gets null starts its own trace.
const TRACEPARENT = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/

export function parseTraceparent(header: string | undefined | null): Traceparent | null {
  if (!header) return null
  const match = TRACEPARENT.exec(header.trim().toLowerCase())
  if (!match) return null
  const [, version, traceId, parentSpanId, flags] = match
  // `ff` is reserved as "invalid" by the spec. Anything else is a version this build does not know,
  // and the spec's forward-compatibility rule is to read the first three fields and carry on.
  if (version === 'ff') return null
  if (/^0+$/.test(traceId) || /^0+$/.test(parentSpanId)) return null
  return { traceId, parentSpanId, sampled: (Number.parseInt(flags, 16) & 1) === 1 }
}

/** The header form, for a runtime that is about to make a request inside a span it opened. */
export const formatTraceparent = (traceId: string, spanId: string, sampled = true): string =>
  `00-${traceId}-${spanId}-${sampled ? '01' : '00'}`


/** Split on encoded bytes, not record count: multibyte messages and a full attribute map can
 * exceed the route cap even in an ordinary flush. A single oversized record is dropped with a
 * counter, so it cannot keep an otherwise valid queue retrying a 413 forever. */
export function encodeTelemetryBatches(runtime: PostedTelemetryRuntime, records: readonly TelemetryRecord[]): string[] {
  const encoder = new TextEncoder()
  const prefix = `{"runtime":${JSON.stringify(runtime)},"records":[`
  const overhead = encoder.encode(prefix + ']}').byteLength
  const batches: string[] = []
  let parts: string[] = []
  let bytes = overhead
  let dropped = 0
  const append = (record: TelemetryRecord) => {
    const json = JSON.stringify(record)
    const size = encoder.encode(json).byteLength
    if (size + overhead > TELEMETRY_BATCH_MAX_BYTES) { dropped += 1; return }
    if (bytes + size + (parts.length ? 1 : 0) > TELEMETRY_BATCH_MAX_BYTES) {
      batches.push(prefix + parts.join(',') + ']}')
      parts = []
      bytes = overhead
    }
    bytes += size + (parts.length ? 1 : 0)
    parts.push(json)
  }
  for (const record of records) append(record)
  if (dropped) append({ kind: 'metric', at: Date.now(), name: 'telemetry.dropped', type: 'count', value: dropped, attrs: { owner: 'core', runtime, reason: 'record-too-large' } })
  if (parts.length) batches.push(prefix + parts.join(',') + ']}')
  return batches
}
