import { readFileSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import {
  TELEMETRY_PREF_KEY,
  telemetryRecordSchema,
  encodeTelemetryBatches,
  type PostedTelemetryRuntime,
  type TelemetryRecord,
} from '@acorn/protocol/telemetry.ts'
import { coreTelemetryRoute, prefsRoute } from '@acorn/protocol/api.ts'
import { emitMetric, flushTelemetry, onTelemetryBatch, setTelemetryPref, startTelemetry, type Disposable } from '@acorn/node-core/server/telemetry'
import { createLogger } from '@acorn/node-core/server/telemetry'
import type { NodeBroker } from './broker/nodeBroker'
import { helperBootSpans } from './bootMarks'
import { helperTelemetryRequests, type HelperTelemetryRequests } from './telemetryRequests'

// How the desktop helper reports, and how the Rust shell's last words get out
// (docs/telemetry/runtimes.md § Other runtimes, docs/shell/node-child.md § What the helper reports).
//
// **The emitter is the node's collector, not the renderer's.** The helper is a Node process that
// already depends on `@acorn/node-core`, so `createLogger`, `startSpan` and `recordDuration` are
// there for the taking, they write to stderr rather than to a devtools console — which is what a
// process whose stdout is a wire needs — and `@acorn/custody` stays out of a package that draws.
// The terminal client goes the other way for the same kind of reason: it runs client-core in
// process, so it reuses the renderer's emitter and changes only the poster.
//
// **The switch is a preference on the node and this process has to ask for it.** The collector's
// own rule is that collection needs a sink and the preference together, and a sink registered
// before the answer is known would arm a five-second flush timer in a process that may be collecting
// nothing all day. So the sink is registered when the answer is yes and dropped when it is no, and
// while it is off this polls once a minute instead. A switch flipped in Settings reaches the helper
// within a minute, and within five seconds once it is on.
//
// **A batch that fails to post is kept.** The collector hands a sink its records and forgets them,
// which is right for a sink whose job is buffering. Here the interesting records are the ones a
// node restart produces, and a restart is exactly when the post fails, so this holds them and
// prepends them to the next attempt.

const log = createLogger('telemetry')

/** The shell's panic record, written by the Rust panic hook and read once
 *  (apps/desktop/src-tauri/src/crash.rs). */
const CRASH_FILE = 'shell-crash.json'

/** How often to ask the node whether the switch is on, while it is off. Slower than the collector's
 *  own five seconds because nothing is being collected: this is one loopback GET a minute against a
 *  node in the same app. */
const PREF_POLL_MS = 60_000

/** What the helper holds between posts. Small, because it emits boot spans, broker events and a
 *  crash record rather than a stream. */
const QUEUE_MAX = 500

/** How often to ask the shell for memory numbers while the switch is on. Memory moves over minutes,
 *  and a sample is a line each way on the shell's pipe. */
export const FOOTPRINT_MS = 30_000
const FOOTPRINT = 'runtime.memory.footprint'

/** What the shell answers a footprint request with: bytes, or null for a process it could not read
 *  (apps/desktop/src-tauri/src/footprint.rs). */
export type FootprintSample = { renderer: number | null; helper: number | null }

export type HelperTelemetry = {
  /** The local node this helper posts to, or null while there is none. Called at every adoption,
   *  because a crash restart mints a new endpoint, certificate and token. */
  setNode(nodeId: string | null): void
  /** The shell's answer to a footprint request. Dropped while the switch is off. */
  footprint(sample: FootprintSample): void
  dispose(): void
}

type Adoption = { id: string; requests: HelperTelemetryRequests; enabled: boolean }
const FINAL_DELIVERY_MS = 5_000

export function startHelperTelemetry(options: {
  broker: NodeBroker
  /** The helper's custody root, which is where the shell writes its crash file. */
  userDataDir: string
  version: string
  /** Ask the shell for memory numbers. Absent where no shell can answer, such as a test. */
  requestFootprint?: () => void
  /** The platform the shell can measure on. Only macOS can, so only there is it asked. */
  platform?: NodeJS.Platform
}): HelperTelemetry {
  let owner: Adoption | null = null
  let retired = false
  let counter = 0
  const requestPrefix = `helper-telemetry-${randomUUID()}`
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let finalTimer: ReturnType<typeof setTimeout> | null = null
  let polling: { owner: Adoption; promise: Promise<void> } | null = null
  const adopt = (id: string): Adoption => ({
    id, enabled: false,
    requests: helperTelemetryRequests(options.broker, id, () => `${requestPrefix}-${++counter}`),
  })
  const live = (target: Adoption): boolean => owner === target && !retired
  const canPost = (target: Adoption): boolean => owner === target && target.enabled

  // ── Posting ──

  let held: TelemetryRecord[] = []
  let posting: Adoption | null = null

  const post = async (target: Adoption, runtime: PostedTelemetryRuntime, records: readonly TelemetryRecord[]): Promise<void> => {
    for (const body of encodeTelemetryBatches(runtime, records)) {
      if (!canPost(target)) return
      const { status } = await target.requests.ask(coreTelemetryRoute, { method: 'POST', body })
      if (status !== 202) throw new Error(`the node answered ${status}`)
    }
  }

  const finishFinalDelivery = (target: Adoption): void => {
    if (!retired || owner !== target) return
    if (finalTimer) clearTimeout(finalTimer)
    finalTimer = null
    target.enabled = false
    target.requests.close()
    held = []
  }

  const drain = async (): Promise<void> => {
    const target = owner
    if (!target || !canPost(target) || posting === target) return
    if (held.length === 0) return finishFinalDelivery(target)
    const bodies = encodeTelemetryBatches('helper', held)
    held = []
    posting = target
    let next = 0
    try {
      // Commit successful batches individually: a later failure retries only undelivered batches.
      for (; next < bodies.length; next += 1) {
        if (!canPost(target)) break
        const { status } = await target.requests.ask(coreTelemetryRoute, { method: 'POST', body: bodies[next] })
        if (status !== 202) throw new Error(`the node answered ${status}`)
      }
    } catch {
      if (live(target) && target.enabled) {
        const remaining = bodies.slice(next).flatMap(body => (JSON.parse(body) as { records: TelemetryRecord[] }).records)
        held = [...remaining, ...held].slice(-QUEUE_MAX)
      }
    } finally {
      if (posting === target) posting = null
      // Shutdown joins an admitted post, then attempts the final queued window once. No retries.
      if (retired && canPost(target)) {
        if (held.length) void drain()
        else finishFinalDelivery(target)
      }
    }
  }

  const sink = (batch: { records: TelemetryRecord[] }): void => {
    if (retired || !owner?.enabled) return
    held = [...held, ...batch.records].slice(-QUEUE_MAX)
    void drain()
  }

  // ── The switch ──

  let subscription: Disposable | null = null
  let bootSpansSent = false
  let footprintTimer: ReturnType<typeof setInterval> | null = null

  // The shell answers on stdin with `footprint` below. Asked only while the switch is on, so a
  // helper nobody is collecting from never wakes the shell.
  const { requestFootprint } = options
  const measurable = requestFootprint !== undefined && (options.platform ?? process.platform) === 'darwin'
  const stopFootprint = (): void => {
    if (footprintTimer) clearInterval(footprintTimer)
    footprintTimer = null
  }

  const apply = (target: Adoption, on: boolean): void => {
    if (!live(target)) return
    target.enabled = on
    // Told rather than left to the collector's own five-second tick, because everything worth
    // reporting about a boot happens inside those five seconds.
    setTelemetryPref(on)
    if (on && !subscription) {
      subscription = onTelemetryBatch(sink)
      if (measurable) {
        footprintTimer = setInterval(() => requestFootprint(), FOOTPRINT_MS)
        footprintTimer.unref?.()
      }
      // The marks were recorded before the answer was known, so they become spans the first time it
      // is yes (./bootMarks.ts § helperBootSpans).
      if (!bootSpansSent) {
        bootSpansSent = true
        helperBootSpans()
      }
      void forwardShellCrash(target)
      return
    }
    if (on) void drain()
    if (!on) {
      stopFootprint()
      subscription?.dispose()
      subscription = null
      held = []
      // Revoke requests as well as buffered records. Re-enable gets a distinct consent owner.
      target.requests.close()
      owner = adopt(target.id)
    }
  }

  // ── Memory, measured by the shell ──

  /**
   * The shell's answer, in bytes. The helper's own goes through its collector like its other runtime
   * gauges, so it is stamped `runtime: helper`. The renderer's is posted in a batch of its own named
   * `renderer`, because the record describes that process and a sink groups memory by runtime. The
   * helper already speaks for the shell this way, and the renderer's own posts reach the node through
   * this same broker, so this claims nothing the renderer could not.
   *
   * A renderer sample that fails to post is dropped rather than queued: the next one is thirty
   * seconds away and says more.
   */
  const footprint = (sample: FootprintSample): void => {
    const target = owner
    if (retired || !target || !subscription || !target.enabled) return
    if (sample.helper !== null) emitMetric('core', { name: FOOTPRINT, type: 'gauge', value: sample.helper, unit: 'byte' })
    if (sample.renderer === null) return
    const record: TelemetryRecord = {
      kind: 'metric', at: Date.now(), name: FOOTPRINT, type: 'gauge', value: sample.renderer, unit: 'byte', attrs: { owner: 'core' },
    }
    void post(target, 'renderer', [record]).catch(() => {})
  }

  const schedulePoll = (): void => {
    if (pollTimer) clearTimeout(pollTimer)
    if (retired || !owner || owner.enabled) return
    pollTimer = setTimeout(() => void poll(), PREF_POLL_MS)
    pollTimer.unref?.()
  }
  const poll = (): Promise<void> => {
    const target = owner
    if (retired || !target) return Promise.resolve()
    if (polling?.owner === target) return polling.promise
    const promise = (async () => {
      let value: string | null = null
      try {
        const { status, text } = await target.requests.ask(prefsRoute, { method: 'GET' })
        if (status === 200) value = (JSON.parse(text) as Record<string, string>)[TELEMETRY_PREF_KEY] ?? null
      } catch { /* An unavailable Node does not authorize collection. */ }
      if (live(target)) {
        apply(target, value === '1')
        // The remote consent answer precedes the flush, just as the Node's database read does.
        if (target.enabled) flushTelemetry()
      }
    })().finally(() => {
      if (polling?.promise !== promise) return
      polling = null
      schedulePoll()
    })
    polling = { owner: target, promise }
    return promise
  }

  // ── The shell's crash file ──

  /**
   * The Rust shell's panic record, read once and deleted.
   *
   * A panic hook runs while the process is dying: it can write a file and nothing else, and the
   * helper is that process's child and is gone with it. So the record waits on disk for the next
   * boot, which is the same pattern the crash budget uses for its window.
   *
   * Posted in a batch of its own with `runtime: 'shell'`, because the node re-stamps the runtime
   * from the batch onto every record in it and this helper's own records are not the shell's. Only
   * the helper can speak for the shell, which is why nothing else may claim that runtime.
   */
  async function forwardShellCrash(target: Adoption): Promise<void> {
    const path = join(options.userDataDir, CRASH_FILE)
    let raw: string
    try {
      raw = readFileSync(path, 'utf8')
    } catch {
      return // no panic since the last boot, which is the ordinary case
    }
    // Deleted whatever happens next. A record that cannot be parsed or cannot be posted is not worth
    // reading again on every boot for the life of the install.
    try {
      rmSync(path, { force: true })
    } catch {
      // A file we cannot delete is not a reason to lose the record.
    }
    let body: unknown
    try {
      body = JSON.parse(raw)
    } catch {
      log.warn('the shell left an invalid crash record')
      return
    }
    const parsed = telemetryRecordSchema.safeParse({ kind: 'error', ...(typeof body === 'object' && body !== null ? body : {}) })
    if (!parsed.success) return void log.warn('the shell left a crash record this build cannot read')
    try {
      await post(target, 'shell', [parsed.data])
      log.warn('the shell panicked on its last run; the record has been reported')
    } catch {
      // The node is not up yet. The file is gone, so this one is lost, and the alternative is
      // keeping a file that gets re-read on every boot until a post happens to succeed.
    }
  }

  // ── Lifecycle ──

  // Both polling paths join the same remote read. Its application and flush stay with that
  // adoption. Retiring the reader lease leaves other subscribers and their preference untouched.
  const collector = startTelemetry({ node: 'helper', version: options.version, readPref: async () => {
    const target = owner
    await poll()
    return target && live(target) && target.enabled ? '1' : null
  } })

  return {
    setNode: (id) => {
      if (retired) return
      if (pollTimer) clearTimeout(pollTimer)
      stopFootprint()
      subscription?.dispose()
      subscription = null
      owner?.requests.close()
      held = []
      setTelemetryPref(false)
      owner = id ? adopt(id) : null
      polling = null
      void poll()
    },
    footprint,
    dispose: () => {
      if (retired) return
      if (pollTimer) clearTimeout(pollTimer)
      stopFootprint()
      collector.dispose()
      // The final synchronous flush enters this owner's queue before retiring its sink.
      flushTelemetry()
      retired = true
      subscription?.dispose()
      subscription = null
      const target = owner
      if (!target) return
      if (!target.enabled) { target.requests.close(); return }
      target.requests.cancelReads()
      polling = null
      // At most five seconds for admitted posts and one final attempt. Failed deliveries cannot
      // recreate the queue, and the deadline cancels only requests admitted by this owner.
      finalTimer = setTimeout(() => finishFinalDelivery(target), FINAL_DELIVERY_MS)
      finalTimer.unref?.()
      void drain()
    },
  }
}
