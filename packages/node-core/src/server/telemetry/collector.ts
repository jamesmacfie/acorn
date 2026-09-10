// The node's telemetry collector: where every record is built, held, and handed to whoever asked
// for it. docs/telemetry.md owns the behaviour; this comment covers the two shape decisions.
//
// **It is a module singleton.** The capability registry beside it is not one, for two reasons that
// do not apply here: a second boot would throw "already provided", and `Env` reaches every route
// anyway. Calling `startTelemetry()` twice resets the ring and re-reads the preference, which is
// what a second boot in one process wants, and the collector never goes on `Env` because a plugin
// reaches it through `ctx.telemetry` and `ctx.core.telemetry` instead. Threading it would not work
// in any case: `requestIdMiddleware` is a module-level middleware and `createApp()` takes no
// arguments, so the seam that produces the most records has nowhere to receive a handle.
//
// **Off costs one boolean read.** `enabled` is `PERF || (sinks.size > 0 && prefEnabled)`. With no
// sink subscribed there is no flush timer and no SELECT, and every emit verb returns before it
// allocates anything. The preference is re-read once per flush tick because `PUT /v2/core/prefs`
// writes the table directly and has no way to tell this module, so a switch flipped in Settings is
// seen within five seconds.
//
// **The owner comes from the seam, or from the stack.** Every verb takes it as its first argument.
// Where the caller passes `'core'` and an ambient context is open, the context wins, which is how
// a git spawn under a plugin's route reports as that plugin's (./context.ts).
//
// Nothing here can fail the thing it measures. Every verb is wrapped, a throwing sink is contained,
// and a full ring drops its oldest record and counts the drop.
import type {
  PostedTelemetryRuntime,
  TelemetryAttrs,
  TelemetryBatch,
  TelemetryLog,
  TelemetryMetric,
  TelemetryRecord,
  TelemetryRuntime,
  TelemetrySpan,
} from '@acorn/protocol/telemetry.ts'
import { ATTRS_MAX, ATTR_KEY_MAX, ATTR_VALUE_MAX, LOG_BODY_MAX, TELEMETRY_PREF_KEY } from '@acorn/protocol/telemetry.ts'
import type { TelemetrySummary } from '@acorn/protocol/api.ts'
import { currentTelemetryContext, runWithTelemetryContext, type TelemetryContext } from './context'
import { scrub } from './scrub'

/** The developer switch that predates all of this. With it on, the collector runs with no sink
 *  subscribed and prints to stderr, which is what `ACORN_PERF=1` has always meant
 *  (docs/local-development.md § Timing a cold start). */
export const PERF = process.env.ACORN_PERF === '1'

/** Enough records that a burst survives a flush window, and small enough that a node nobody is
 *  collecting from cannot grow a heap out of its own instrumentation. */
const RING_MAX = 5_000
const FLUSH_AT = 500
const FLUSH_EVERY_MS = 5_000
/** Enough samples for a percentile to mean something over one window. Past the cap the count, sum,
 *  min and max stay exact and the percentiles describe the first 20,000 calls. */
const MAX_SAMPLES = 20_000
/** How many distinct histograms one flush window may hold. A seam that puts an id in an attribute
 *  would otherwise mint one series per call, which is the cardinality failure the vocabulary rule
 *  exists to prevent (docs/telemetry.md § The attribute vocabulary). */
const MAX_SERIES = 200
/** The separator inside a counter key, and inside a histogram's label fingerprint below. A control
 *  character because an owner, a seam and an attribute value are all free-ish text and none of them
 *  can contain one. */
const SEP = '\u0000'

export type TelemetrySink = (batch: TelemetryBatch) => void
export type Disposable = { dispose(): void }

/** What a caller passes; the host fills in the rest. `owner` is never taken from here: the seam that
 *  knows binds it, so an emitter cannot file a record under another plugin's name. */
export type SpanInput = { name: string; attrs?: TelemetryAttrs; traceId?: string; parentSpanId?: string }
export type SpanHandle = {
  readonly traceId: string
  readonly spanId: string
  end(status?: 'ok' | 'error', attrs?: TelemetryAttrs): void
}
export type ErrorInput = {
  name: string
  message?: string
  stack?: string
  level?: 'error' | 'fatal'
  handled?: boolean
  attrs?: TelemetryAttrs
  traceId?: string
  spanId?: string
}

type Histogram = { count: number; sum: number; min: number; max: number; samples: number[] }

type CollectorState = {
  ring: TelemetryRecord[]
  // The owner beside each sink, so the summary can say which plugins are reading the stream and a
  // rollback can drop one plugin's subscriptions without holding the functions itself.
  sinks: Map<TelemetrySink, string>
  histograms: Map<string, { owner: string; seam: string; attrs: TelemetryAttrs; histogram: Histogram }>
  timer: ReturnType<typeof setInterval> | null
  prefEnabled: boolean
  readPref: (() => Promise<boolean>) | null
  node: string
  version: string
  dropped: number
  truncated: number
  // Counters for the summary, all since the last `startTelemetry`. `dropped` and `truncated` above
  // are the pending ones: each flush turns them into a record and zeroes them, so a page reading
  // those two would show whatever happened in the last five seconds.
  counts: Map<string, number>
  droppedTotal: number
  truncatedTotal: number
  startedAt: number
  lastFlushAt: number | null
}

const state: CollectorState = {
  ring: [],
  sinks: new Map(),
  histograms: new Map(),
  timer: null,
  prefEnabled: false,
  readPref: null,
  node: 'unknown',
  version: '0',
  dropped: 0,
  truncated: 0,
  counts: new Map(),
  droppedTotal: 0,
  truncatedTotal: 0,
  startedAt: Date.now(),
  lastFlushAt: null,
}

/** One boolean read on the hot path. Everything else in this module starts with it. */
export const telemetryEnabled = (): boolean => PERF || (state.sinks.size > 0 && state.prefEnabled)

// ── Attribute hygiene ─────────────────────────────────────────────────────────────────────────────
//
// Truncate rather than drop, and count what was truncated, so a chatty seam shows up as a metric
// instead of quietly losing its tail (docs/telemetry.md § The attribute vocabulary).

function cleanAttrs(attrs: TelemetryAttrs | undefined, owner: string, runtime: TelemetryRuntime = 'node'): TelemetryAttrs {
  const out: TelemetryAttrs = {}
  let count = 0
  for (const [key, value] of Object.entries(attrs ?? {})) {
    // `owner` and `runtime` are the host's to stamp, so an emitter that sets one is ignored rather
    // than refused: a plugin should not be able to fail its own route by mislabelling a span.
    if (key === 'owner' || key === 'runtime') continue
    if (count >= ATTRS_MAX) {
      state.truncated += 1
      break
    }
    if (value === undefined) continue
    const short = key.length > ATTR_KEY_MAX ? key.slice(0, ATTR_KEY_MAX) : key
    if (typeof value === 'string') {
      if (value.length > ATTR_VALUE_MAX) state.truncated += 1
      out[short] = scrub(value).slice(0, ATTR_VALUE_MAX)
    } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      out[short] = value
    } else {
      // A nested value cannot happen through the typed verbs and can through a loaded plugin's
      // untyped JavaScript. Dropped, because the reason attributes are scalars is that an object is
      // where a request body hides.
      state.truncated += 1
      continue
    }
    count += 1
  }
  out.owner = owner
  out.runtime = runtime
  return out
}

// ── The ring ──────────────────────────────────────────────────────────────────────────────────────

let flushQueued = false

function push(record: TelemetryRecord): void {
  state.ring.push(record)
  // One map increment per record, which is what the summary is built from. Counting here rather
  // than at each verb means a record posted by another runtime is counted the same way as one this
  // process built, because both arrive through this function.
  const owner = typeof record.attrs.owner === 'string' ? record.attrs.owner : 'core'
  const key = `${owner}${SEP}${record.kind}`
  state.counts.set(key, (state.counts.get(key) ?? 0) + 1)
  if (state.ring.length > RING_MAX) {
    state.ring.shift()
    state.dropped += 1
  }
  // Scheduled, never called here. A sink run from inside `emit` would run on the stack of the code
  // being measured, and a slow sink would then add its own latency to the request it is describing.
  // It also means a synchronous burst can outrun the flush, which is what the ring cap is for.
  if (state.ring.length >= FLUSH_AT && !flushQueued) {
    flushQueued = true
    queueMicrotask(() => {
      flushQueued = false
      flushTelemetry()
    })
  }
}

/** Every verb goes through this. A throw inside instrumentation must never reach the code being
 *  instrumented, and the alternative to swallowing it is a node that dies of its own metrics. */
function safely(run: () => void): void {
  try {
    run()
  } catch {
    // Deliberately silent: reporting a telemetry failure through the logger would call back into
    // this module.
  }
}

// ── Ids ───────────────────────────────────────────────────────────────────────────────────────────
//
// W3C sizes, lowercase hex, so an id round-trips through a `traceparent` header untouched.
// `Math.random` rather than `randomUUID`: a trace id is a correlation key, not a secret, and this
// runs on the request path.

const hex = (bytes: number): string => {
  let out = ''
  for (let index = 0; index < bytes; index += 1) out += Math.floor(Math.random() * 256).toString(16).padStart(2, '0')
  return out
}
export const newTraceId = (): string => hex(16)
export const newSpanId = (): string => hex(8)

// ── Ambient attribution ───────────────────────────────────────────────────────────────────────────
//
// Every verb takes the owner as its first argument. Where the caller has nothing better to say than
// `'core'`, the store answers instead: a request under `/v2/p/rollbar` entered it with
// `owner: 'rollbar'`, so the git spawn eleven frames down reports as rollbar's without git.ts ever
// learning who called it (./context.ts, docs/telemetry.md § Ambient attribution).
//
// The precedence is explicit, then ambient, then core. A plugin's `ctx.telemetry` closes over its
// own id and so always passes one, which is what stops a plugin inheriting core's name, or another
// plugin's, from whatever happens to be on the stack.

/** The owner to file a record under. `'core'` is the "I have nothing better" spelling, and the one
 *  the ambient context is allowed to override. */
const resolveOwner = (owner: string): string => (owner === 'core' ? (currentTelemetryContext()?.owner ?? 'core') : owner)

/**
 * Enter the ambient context for one seam, or do nothing when nothing is collecting.
 *
 * The switch lives here rather than in ./context.ts so that file stays free of this one and the
 * dependency runs one way. Off, this is a function call and the store is never touched.
 */
export function runWithTelemetry<T>(context: TelemetryContext, run: () => T): T {
  if (!telemetryEnabled()) return run()
  return runWithTelemetryContext(context, run)
}

// ── The emit verbs ────────────────────────────────────────────────────────────────────────────────

export function emitSpan(owner: string, span: Omit<TelemetrySpan, 'kind' | 'attrs'> & { attrs?: TelemetryAttrs }): void {
  if (!telemetryEnabled()) return
  safely(() => push({ ...span, kind: 'span', attrs: cleanAttrs(span.attrs, resolveOwner(owner)) }))
}

export function emitLog(owner: string, log: Omit<TelemetryLog, 'kind' | 'attrs'> & { attrs?: TelemetryAttrs }): void {
  if (!telemetryEnabled()) return
  safely(() => {
    // A line written inside a request belongs to that request's trace. The caller may still name
    // one, because a line about work that outlived its request should not be filed under it.
    const traceId = log.traceId ?? currentTelemetryContext()?.traceId
    push({
      ...log,
      kind: 'log',
      body: scrub(log.body).slice(0, LOG_BODY_MAX),
      ...(traceId ? { traceId } : {}),
      attrs: cleanAttrs(log.attrs, resolveOwner(owner)),
    })
  })
}

export function emitEvent(owner: string, name: string, attrs?: TelemetryAttrs): void {
  if (!telemetryEnabled()) return
  safely(() => push({ kind: 'event', at: Date.now(), name, attrs: cleanAttrs(attrs, resolveOwner(owner)) }))
}

export function emitMetric(owner: string, metric: Omit<TelemetryMetric, 'kind' | 'at' | 'attrs'> & { at?: number; attrs?: TelemetryAttrs }): void {
  if (!telemetryEnabled()) return
  safely(() => push({ ...metric, kind: 'metric', at: metric.at ?? Date.now(), attrs: cleanAttrs(metric.attrs, resolveOwner(owner)) }))
}

export function emitError(owner: string, error: ErrorInput): void {
  if (!telemetryEnabled()) return
  safely(() => {
    // An error raised inside a request lands in that request's trace rather than starting a second
    // one, which is what makes the failure and the call that caused it one query.
    const ambient = currentTelemetryContext()
    const traceId = error.traceId ?? ambient?.traceId
    const spanId = error.spanId ?? (error.traceId ? undefined : ambient?.spanId)
    push({
      kind: 'error',
      at: Date.now(),
      name: error.name,
      message: scrub(error.message ?? ''),
      ...(error.stack ? { stack: scrub(error.stack) } : {}),
      level: error.level ?? 'error',
      handled: error.handled ?? true,
      ...(traceId ? { traceId } : {}),
      ...(spanId ? { spanId } : {}),
      attrs: cleanAttrs(error.attrs, resolveOwner(owner)),
    })
  })
}

/** An inert handle when telemetry is off, so a caller writes the same three lines either way and
 *  pays a boolean for them. */
const INERT: SpanHandle = { traceId: '', spanId: '', end: () => {} }

export function startSpan(owner: string, input: SpanInput): SpanHandle {
  if (!telemetryEnabled()) return INERT
  // A span raised inside an entered seam hangs under it, so a tool call made during a request is a
  // child of that request rather than the root of a trace of its own. A caller that names a trace
  // has said where it belongs and is left alone.
  const ambient = input.traceId ? undefined : currentTelemetryContext()
  const traceId = input.traceId ?? ambient?.traceId ?? newTraceId()
  const parentSpanId = input.parentSpanId ?? ambient?.spanId
  const spanId = newSpanId()
  const started = Date.now()
  const hrStart = process.hrtime.bigint()
  // Resolved at the start rather than at the end: `end` can run long after the context that knows
  // the owner has unwound, and a span attributed to whatever happened to be on the stack when it
  // finished would be worse than one attributed to core.
  const resolved = resolveOwner(owner)
  let ended = false
  return {
    traceId,
    spanId,
    end: (status = 'ok', attrs) => {
      if (ended) return
      ended = true
      emitSpan(resolved, {
        traceId,
        spanId,
        ...(parentSpanId ? { parentSpanId } : {}),
        name: input.name,
        start: started,
        durationMs: Number(process.hrtime.bigint() - hrStart) / 1e6,
        status,
        attrs: { ...input.attrs, ...attrs },
      })
    },
  }
}

/** A stable fingerprint of one sample's attributes, so two samples share a histogram only when
 *  their labels match. Sorted, because two call sites can build the same attributes in a different
 *  order and a metrics backend counts those as one series. Empty for the common case of none. */
function labelsOf(attrs: TelemetryAttrs | undefined): string {
  if (!attrs) return ''
  const keys = Object.keys(attrs).sort()
  if (keys.length === 0) return ''
  return keys.map((key) => `${key}=${String(attrs[key])}`).join(SEP)
}

/**
 * One sample into a histogram, aggregated over the flush window.
 *
 * This is the seam `perf.ts` used to be. A seam firing thousands of times a second is a metric and
 * never a span (docs/telemetry.md § Hot seams are metrics), and pre-aggregating here is what makes
 * the difference between one record per window and a thousand records a sink has to throw away.
 */
export function recordDuration(owner: string, seam: string, ms: number, attrs?: TelemetryAttrs): void {
  if (!telemetryEnabled()) return
  safely(() => {
    // Keyed by owner, seam and attributes together. Owner and seam alone are two plugins spawning
    // git read as one average that describes neither; the attributes belong in the key too, because
    // a histogram describes one label set and merging two of them under the first sample's labels
    // reports one channel's name for every channel's timings.
    const resolved = resolveOwner(owner)
    const labels = labelsOf(attrs)
    let key = `${resolved}${SEP}${seam}${SEP}${labels}`
    let slot = state.histograms.get(key)
    if (!slot && labels && state.histograms.size >= MAX_SERIES) {
      // At the cap a sample keeps its count and loses its labels rather than being dropped: the
      // totals stay exact, memory stays bounded, and the truncation counter says it happened.
      state.truncated += 1
      attrs = undefined
      key = `${resolved}${SEP}${seam}${SEP}`
      slot = state.histograms.get(key)
    }
    if (!slot) {
      slot = { owner: resolved, seam, attrs: { ...attrs, seam }, histogram: { count: 0, sum: 0, min: ms, max: ms, samples: [] } }
      state.histograms.set(key, slot)
    }
    const h = slot.histogram
    h.count += 1
    h.sum += ms
    h.min = Math.min(h.min, ms)
    h.max = Math.max(h.max, ms)
    if (h.samples.length < MAX_SAMPLES) h.samples.push(ms)
  })
}

/**
 * Time one call and hand back its own result untouched. Promise-aware, and timed to settlement
 * rather than to the call that started it, which for a git spawn is the whole of the duration.
 *
 * The replacement for `perf.ts`'s `timed`. A caller with nothing better to say than `'core'` gets
 * the ambient owner, so `git.ts` and `sqlite.ts` name the plugin whose request they are serving
 * without either file learning anything about its callers (docs/telemetry.md § Ambient attribution).
 */
export function measure<T>(owner: string, seam: string, run: () => T, attrs?: TelemetryAttrs): T {
  if (!telemetryEnabled()) return run()
  const started = process.hrtime.bigint()
  // Resolved here, where the ambient context is certainly the caller's, rather than in `finish`,
  // which runs when the promise settles.
  const resolved = resolveOwner(owner)
  const finish = () => recordDuration(resolved, seam, Number(process.hrtime.bigint() - started) / 1e6, attrs)
  let result: T
  try {
    result = run()
  } catch (error) {
    finish()
    throw error
  }
  // `finally` rather than `then`, so a rejection is still counted.
  if (result instanceof Promise) return result.finally(finish) as T
  finish()
  return result
}

// ── Records from another runtime ──────────────────────────────────────────────────────────────────

/**
 * Take a batch another runtime built and hold it with the node's own records.
 *
 * The node is the only collector, so the renderer, the helper, the terminal client and the shell all
 * post here (docs/telemetry.md § Other runtimes). Three things are re-done rather than trusted:
 *
 *   - `runtime` comes from the route, which takes it from a set that does not contain `node`. A
 *     record that could claim to be the node's own would be indistinguishable from one at a sink.
 *   - `owner` is read off the record, because only the runtime that emitted it knows which pane or
 *     which frame caused it, and it is put back through `cleanAttrs` so the caps and the scrubber
 *     apply to it like any other attribute.
 *   - The message, the body and the stack are scrubbed again here. A browser cannot know this
 *     machine's home directory or data root, so the renderer's own scrubber leaves paths that only
 *     this side can collapse.
 *
 * Answers how many records it took. Zero means nothing is collecting, which is not a failure: the
 * caller reads the preference on its own tick and stops on its own.
 */
export function ingestTelemetry(runtime: PostedTelemetryRuntime, records: readonly TelemetryRecord[]): number {
  if (!telemetryEnabled()) return 0
  let taken = 0
  for (const record of records) {
    safely(() => {
      const owner = typeof record.attrs.owner === 'string' ? record.attrs.owner : 'core'
      const attrs = cleanAttrs(record.attrs, owner, runtime)
      if (record.kind === 'log') push({ ...record, body: scrub(record.body).slice(0, LOG_BODY_MAX), attrs })
      else if (record.kind === 'error') push({ ...record, message: scrub(record.message), ...(record.stack ? { stack: scrub(record.stack) } : {}), attrs })
      else push({ ...record, attrs })
      taken += 1
    })
  }
  return taken
}

// ── Sinks ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Subscribe to the stream. Behind the `telemetry` core token, because a sink sees every record from
 * every owner (docs/security.md § Telemetry sinks).
 *
 * A sink must return quickly. The collector calls sinks in order on a timer, awaits none of them and
 * contains a throw or a rejection; buffering and retry are the sink's job.
 */
export function onTelemetryBatch(sink: TelemetrySink, owner = 'core'): Disposable {
  // The owner is the host's to state, the same rule every record follows: a plugin subscribes
  // through `ctx.core.telemetry`, which closes over its id (../core/telemetry.ts). It is kept so
  // Settings can say who is reading the stream and so a rollback can find this subscription again.
  state.sinks.set(sink, owner)
  arm()
  return {
    dispose: () => {
      state.sinks.delete(sink)
      if (state.sinks.size === 0 && !PERF) disarm()
    },
  }
}

/** Drop every sink one plugin registered. Called when the host rolls a plugin's registrations back,
 *  so a reloaded plugin does not leave the previous instance reading the stream. */
export function clearTelemetrySinks(owner: string): void {
  for (const [sink, sinkOwner] of state.sinks) {
    if (sinkOwner === owner) state.sinks.delete(sink)
  }
  if (state.sinks.size === 0 && !PERF) disarm()
}

/**
 * What Settings → Telemetry draws: is it on, what is it seeing, and who is reading it
 * (docs/telemetry.md § What the page shows).
 *
 * Counters, not records. The ring is 5,000 deep and a sink may have drained it a second ago, so a
 * page built on the ring would answer "what is this collecting" with whatever the last five seconds
 * happened to hold. Each count costs one map increment in `push`.
 *
 * `dropped` and `truncated` add the pending counts to the flushed ones, because a flush turns each
 * into a record and zeroes it.
 */
export function telemetrySummary(): TelemetrySummary {
  const records: TelemetrySummary['records'] = []
  for (const [key, count] of state.counts) {
    const [owner, kind] = key.split(SEP)
    records.push({ owner, kind: kind as TelemetryRecord['kind'], count })
  }
  // Biggest first, so the page opens on whatever is producing the most rather than on whichever
  // owner happened to emit first.
  records.sort((a, b) => b.count - a.count || a.owner.localeCompare(b.owner) || a.kind.localeCompare(b.kind))
  return {
    enabled: state.prefEnabled,
    collecting: telemetryEnabled(),
    since: state.startedAt,
    lastFlushAt: state.lastFlushAt,
    dropped: state.droppedTotal + state.dropped,
    truncated: state.truncatedTotal + state.truncated,
    sinks: [...new Set(state.sinks.values())].sort(),
    records,
  }
}

// ── Flush ─────────────────────────────────────────────────────────────────────────────────────────

function foldHistograms(): void {
  if (state.histograms.size === 0) return
  const at = Date.now()
  for (const slot of state.histograms.values()) {
    const h = slot.histogram
    const sorted = [...h.samples].sort((a, b) => a - b)
    const at_ = (fraction: number) => (sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))])
    push({
      kind: 'metric',
      at,
      name: slot.seam,
      type: 'histogram',
      value: { count: h.count, sum: h.sum, min: h.min, max: h.max, p50: at_(0.5), p95: at_(0.95) },
      unit: 'ms',
      attrs: cleanAttrs(slot.attrs, slot.owner),
    })
  }
  state.histograms.clear()
}

/** Hand everything held to every sink and clear the ring. Called on the timer, at the record cap,
 *  and on the way out. */
export function flushTelemetry(): void {
  safely(() => {
    if (!telemetryEnabled()) {
      state.ring = []
      state.histograms.clear()
      return
    }
    foldHistograms()
    if (state.dropped > 0) {
      const dropped = state.dropped
      state.dropped = 0
      state.droppedTotal += dropped
      state.ring.push({ kind: 'metric', at: Date.now(), name: 'telemetry.dropped', type: 'count', value: dropped, attrs: cleanAttrs({}, 'core') })
    }
    if (state.truncated > 0) {
      const truncated = state.truncated
      state.truncated = 0
      state.truncatedTotal += truncated
      state.ring.push({ kind: 'metric', at: Date.now(), name: 'telemetry.truncated', type: 'count', value: truncated, attrs: cleanAttrs({}, 'core') })
    }
    if (state.ring.length === 0) return
    state.lastFlushAt = Date.now()
    const batch: TelemetryBatch = { node: state.node, version: state.version, records: state.ring }
    state.ring = []
    for (const sink of [...state.sinks.keys()]) {
      try {
        // A sink may hand back a promise even though the type says otherwise, and an unhandled
        // rejection would take the process down.
        void Promise.resolve((sink as (b: TelemetryBatch) => unknown)(batch)).catch(() => {})
      } catch {
        // One sink that throws must not stop the next one from being called.
      }
    }
  })
}

function tick(): void {
  // The preference is re-read here rather than watched: `PUT /v2/core/prefs` writes the table
  // directly and has nothing to notify. One SELECT every five seconds, and only while a sink is
  // subscribed.
  const read = state.readPref
  if (read) {
    void read().then(setTelemetryPref).catch(() => setTelemetryPref(false)).then(flushTelemetry)
  } else flushTelemetry()
}

function arm(): void {
  if (state.timer) return
  state.timer = setInterval(tick, FLUSH_EVERY_MS)
  // Unref'd like the scheduler's timers: a node with nothing left to do must be allowed to exit.
  state.timer.unref?.()
}

function disarm(): void {
  if (!state.timer) return
  clearInterval(state.timer)
  state.timer = null
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────────────────────────

export type StartTelemetryOptions = {
  node: string
  version: string
  /** How the collector reads `telemetry.enabled`. The composition root passes
   *  `() => core.prefs.read(ACTIVE_IDENTITY.get(), TELEMETRY_PREF_KEY)`; a node with no bound
   *  identity passes nothing and stays off, which is the right answer and never a throw. */
  readPref?: () => Promise<string | null>
}

/**
 * Say what the preference reads, for a process that learned it some other way than by asking its own
 * database.
 *
 * The desktop helper is the one caller. It has no database: it reads `telemetry.enabled` off the
 * node over the broker, and without this the first five seconds after it turns collection on would
 * build no records, because `prefEnabled` only moves on the flush tick. Its boot spans are all in
 * those five seconds (packages/custody/src/telemetry.ts § The switch).
 *
 * The node itself never calls this. Its `readPref` is the authority and the tick re-reads it, so a
 * value set here is replaced within one window either way.
 */
export function setTelemetryPref(on: boolean): void {
  state.prefEnabled = on
  if (!on && !PERF) {
    state.ring = []
    state.histograms.clear()
  }
}

/**
 * Called once per boot, after `createCoreServices` and before `initPlugins`, so a plugin can
 * subscribe from its own `init`.
 *
 * Calling it a second time resets the ring and re-reads the preference. That is the behaviour a
 * process which starts the service more than once wants, and the node's own test does exactly that.
 */
export function startTelemetry(options: StartTelemetryOptions): void {
  state.ring = []
  state.histograms.clear()
  state.node = options.node
  state.version = options.version
  state.dropped = 0
  state.truncated = 0
  // The summary counts from here, which is what "since this node started" means on the page. A
  // second boot in one process is a second start, and the page says so through `since`.
  state.counts.clear()
  state.droppedTotal = 0
  state.truncatedTotal = 0
  state.startedAt = Date.now()
  state.lastFlushAt = null
  const read = options.readPref
  state.readPref = read ? async () => (await read().catch(() => null)) === '1' : null
  state.prefEnabled = false
  if (state.readPref) void state.readPref().then((value) => (state.prefEnabled = value)).catch(() => {})
  if (PERF || state.sinks.size > 0) arm()
}

/** Flush what is held and stop the timer. The last chance a sink gets, so it runs before the node
 *  closes its database on the way out. */
export function stopTelemetry(): void {
  flushTelemetry()
  disarm()
}

/** Test seam: forget every sink and everything held. Not called in production, where a second
 *  `startTelemetry` is the reset. */
export function resetTelemetryForTest(): void {
  state.sinks.clear()
  state.ring = []
  state.histograms.clear()
  state.prefEnabled = false
  state.readPref = null
  state.dropped = 0
  state.truncated = 0
  state.counts.clear()
  state.droppedTotal = 0
  state.truncatedTotal = 0
  state.startedAt = Date.now()
  state.lastFlushAt = null
  disarm()
}

// ── The owner-bound projection ────────────────────────────────────────────────────────────────────

/** What `ctx.telemetry` is (docs/plugin-authoring.md § Telemetry and logging). The owner is closed
 *  over by the host, so every verb on it files under the plugin the context belongs to. */
export type PluginTelemetry = {
  event(name: string, attrs?: TelemetryAttrs): void
  count(name: string, value?: number, attrs?: TelemetryAttrs): void
  gauge(name: string, value: number, attrs?: TelemetryAttrs): void
  error(error: ErrorInput): void
  /** Time one call and return its own result untouched. Promise-aware. */
  measure<T>(name: string, run: () => T, attrs?: TelemetryAttrs): T
  /** For work whose start and end do not fit one closure. `end` is idempotent. */
  startSpan(name: string, options?: { attrs?: TelemetryAttrs; traceId?: string; parentSpanId?: string }): SpanHandle
}

export const telemetryFor = (owner: string): PluginTelemetry => ({
  event: (name, attrs) => emitEvent(owner, name, attrs),
  count: (name, value = 1, attrs) => emitMetric(owner, { name, type: 'count', value, ...(attrs ? { attrs } : {}) }),
  gauge: (name, value, attrs) => emitMetric(owner, { name, type: 'gauge', value, ...(attrs ? { attrs } : {}) }),
  error: (error) => emitError(owner, error),
  measure: (name, run, attrs) => measure(owner, name, run, attrs),
  startSpan: (name, options) => startSpan(owner, { name, ...options }),
})

/** The preference key, re-exported so a composition root does not import protocol for one string. */
export { TELEMETRY_PREF_KEY }
