// The sink: batches in, envelopes out, and everything that has to happen between them.
//
// The collector hands a sink every record this node collected, on its own five-second timer, and
// awaits nothing (docs/telemetry.md § Writing a sink). So `accept` does one thing: it takes the
// batch and returns. Reading the connection, reading the settings, building the envelopes and
// posting them all happen after, on the exporter's own promise chain.
//
// ## Two queues, because they empty at different speeds
//
// Conversion is a database read and some object building, and it finishes in milliseconds.
// Delivery is a network call that can be waiting on a closed laptop for two minutes. Chaining them
// would mean a stalled post holding up conversion, and the thing that grew unbounded would be
// batches rather than envelopes. So conversion runs on its own serialised chain and delivery on its
// own loop, and the bounded thing between them is the envelope queue.
//
// ## Nothing survives a restart
//
// By design (docs/telemetry.md § Deliberate limits). A durable queue
// would be a second copy of the records on disk, in a table with none of the audit trail's closed
// vocabulary. A restart loses the collector window and every queued envelope.
import { setTimeout as delay } from 'node:timers/promises'
import type { Logger, PluginTelemetry, TelemetryBatch } from '@acorn/plugin-api/node'
import { buildEnvelopes, type SentryDataCategory, type SentryEnvelope } from './envelope'
import { redactBatch } from './redact'
import type { SentryDsn } from './dsn'
import { postEnvelope, type FetchLike, type RateLimit } from './transport'
import type { SentrySettings } from '../shared/settings'

/** Where the DSN and the two non-secret fields beside it come from, resolved once per flush so
 *  disconnecting stops the export within one window. */
export type SentryTarget = { dsn: SentryDsn; environment?: string; release?: string }

export type ExporterDeps = {
  fetch: FetchLike
  now: () => number
  /** 32 lowercase hex characters. Injected so a test reads its own ids back. */
  newId: () => string
  /** Resolves to null when nothing is connected, which is the off state. */
  target: () => Promise<SentryTarget | null>
  settings: () => Promise<SentrySettings>
  log: Logger
  telemetry: PluginTelemetry
  /** `<name>/<version>`, the user agent and the `sentry_client` value. */
  client: string
  sdk: { name: string; version: string }
  sleep?: (ms: number) => Promise<void>
}

/** Envelopes held while the network is unreachable. Past this the oldest goes, because the newest
 *  records are the ones describing whatever is happening now. */
const MAX_QUEUE = 200
const BACKOFF_MIN_MS = 1_000
const BACKOFF_MAX_MS = 120_000

type Queued = { envelope: SentryEnvelope; target: SentryTarget }

export type Exporter = {
  /** What `ctx.core.telemetry.onBatch` calls. Returns immediately and never throws. */
  accept(batch: TelemetryBatch): void
  /** Everything accepted so far, converted and posted. Tests await this; nothing else calls it. */
  settled(): Promise<void>
  dispose(): void
}

export function createExporter(deps: ExporterDeps): Exporter {
  const controller = new AbortController()
  const sleep = deps.sleep ?? ((ms: number) => delay(ms, undefined, { signal: controller.signal, ref: false }).catch(() => {}))
  const queue: Queued[] = []
  const limits: RateLimit[] = []
  let converting: Promise<void> = Promise.resolve()
  let pendingBatches = 0
  let delivering: Promise<void> | null = null
  let backoffMs = BACKOFF_MIN_MS
  let stopped = false

  // The one place this exporter measures itself, and the only telemetry it emits. It comes back in
  // the next batch and is exported like anything else, which is fine: it is one metric per flush,
  // so the loop converges instead of compounding.
  const dropped = (count: number, reason: string, category?: SentryDataCategory) => {
    if (count > 0) deps.telemetry.count('sentry.dropped', count, { reason, ...(category ? { category } : {}) })
  }

  const limitedNow = (category: SentryDataCategory): boolean => {
    const now = deps.now()
    for (let index = limits.length - 1; index >= 0; index -= 1) {
      if (limits[index].untilMs <= now) {
        limits.splice(index, 1)
        continue
      }
      const scope = limits[index].categories
      if (scope === 'all' || scope.includes(category)) return true
    }
    return false
  }

  const applyLimits = (incoming: RateLimit[]) => {
    for (const limit of incoming) {
      // Keep the longest window when two quotas name the same category, which is what the
      // specification asks for.
      const existing = limits.find((held) =>
        held.categories === 'all' ? limit.categories === 'all' : limit.categories !== 'all'
          && held.categories.length === limit.categories.length
          && held.categories.every((category) => (limit.categories as SentryDataCategory[]).includes(category)))
      if (existing) existing.untilMs = Math.max(existing.untilMs, limit.untilMs)
      else limits.push(limit)
    }
  }

  const enqueue = (item: Queued) => {
    queue.push(item)
    let lost = 0
    while (queue.length > MAX_QUEUE) {
      queue.shift()
      lost += 1
    }
    dropped(lost, 'queue-full')
  }

  async function convert(batch: TelemetryBatch): Promise<void> {
    if (stopped) return
    const target = await deps.target()
    // No connection is the off state, and it is the ordinary one. Nothing is queued, so connecting
    // later does not send the last hour of a machine nobody had pointed at Sentry yet.
    if (stopped || !target) return
    const settings = await deps.settings()
    if (stopped) return
    const clean = redactBatch(batch, { taskIds: settings.taskIds, stacks: settings.stacks })
    for (const envelope of buildEnvelopes(clean, {
      settings,
      newId: deps.newId,
      ...(target.environment ? { environment: target.environment } : {}),
      ...(target.release ? { release: target.release } : {}),
    })) {
      if (limitedNow(envelope.category)) {
        dropped(1, 'rate-limited', envelope.category)
        continue
      }
      enqueue({ envelope, target })
    }
  }

  async function deliver(): Promise<void> {
    while (!stopped && queue.length) {
      const head = queue[0]
      // Re-check consent and connection before every attempt, including retries of old data.
      const target = await deps.target().catch(() => null)
      if (stopped) break
      if (!target || JSON.stringify(target) !== JSON.stringify(head.target)) {
        queue.length = 0
        limits.length = 0
        break
      }
      // Conversion may have evicted this envelope while the connection lookup was in flight.
      if (queue[0] !== head) continue
      if (limitedNow(head.envelope.category)) {
        queue.shift()
        dropped(1, 'rate-limited', head.envelope.category)
        continue
      }
      const result = await postEnvelope({
        fetch: deps.fetch,
        dsn: head.target.dsn,
        envelope: head.envelope,
        client: deps.client,
        sdk: deps.sdk,
        now: deps.now(),
        signal: controller.signal,
      })
      if (stopped) break
      applyLimits(result.limits)

      // A network failure or a Sentry that is down. The envelope stays at the front and the wait
      // doubles, because the alternative is a tight loop against an unreachable host.
      if (result.status === null || result.status >= 500) {
        await sleep(backoffMs)
        backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS)
        continue
      }
      if (queue[0] === head) queue.shift()
      backoffMs = BACKOFF_MIN_MS
      if (result.status === 429) {
        dropped(1, 'rate-limited', head.envelope.category)
        continue
      }
      if (result.status >= 400) {
        // A malformed envelope or a DSN that no longer names a project. Retrying is a loop, so this
        // one is gone and the reason is written down once.
        deps.log.warn('Sentry refused an envelope', {
          status: result.status,
          category: head.envelope.category,
          ...(result.detail ? { detail: result.detail } : {}),
        })
        dropped(1, `http-${result.status}`, head.envelope.category)
      }
    }
    delivering = null
  }

  const pump = () => {
    if (stopped || delivering || !queue.length) return
    delivering = deliver()
  }

  return {
    accept(batch) {
      if (stopped) return
      if (pendingBatches >= MAX_QUEUE) {
        dropped(batch.records.length, 'conversion-full')
        return
      }
      pendingBatches += 1
      // Serialised, so two batches cannot interleave their conversions and reverse the order the
      // records were collected in. `catch` rather than a throw: a sink that throws is contained by
      // the collector anyway, and swallowing here keeps the chain alive for the next batch.
      converting = converting
        .then(() => convert(batch))
        .catch((error: unknown) => deps.log.error('could not build a Sentry envelope', { error: String(error) }))
        .finally(() => { pendingBatches -= 1 })
        .then(pump)
    },
    async settled() {
      await converting
      pump()
      await delivering
    },
    dispose() {
      stopped = true
      controller.abort()
      queue.length = 0
    },
  }
}
