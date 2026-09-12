import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  TELEMETRY_PREF_KEY,
  telemetryRecordSchema,
  encodeTelemetryBatches,
  type PostedTelemetryRuntime,
  type TelemetryRecord,
} from '@acorn/protocol/telemetry.ts'
import { coreTelemetryRoute, prefsRoute } from '@acorn/protocol/api.ts'
import { flushTelemetry, onTelemetryBatch, setTelemetryPref, startTelemetry, type Disposable } from '@acorn/node-core/server/telemetry/collector.ts'
import { createLogger } from '@acorn/node-core/server/telemetry/logger.ts'
import type { NodeBroker } from './broker/nodeBroker'
import { helperBootSpans } from './bootMarks'

// How the desktop helper reports, and how the Rust shell's last words get out
// (docs/telemetry.md § Other runtimes, docs/shell.md § What the helper reports).
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

export type HelperTelemetry = {
  /** The local node this helper posts to, or null while there is none. Called at every adoption,
   *  because a crash restart mints a new endpoint, certificate and token. */
  setNode(nodeId: string | null): void
  dispose(): void
}

type Request = (path: string, init: { method: string; body?: string }) => Promise<{ status: number; text: string }>

export function startHelperTelemetry(options: {
  broker: NodeBroker
  /** The helper's custody root, which is where the shell writes its crash file. */
  userDataDir: string
  version: string
}): HelperTelemetry {
  let nodeId: string | null = null
  let counter = 0

  // One round trip to the local node, with the device token the broker already attaches. It throws
  // until a node has been adopted, which on a cold boot is a second or two after this module starts.
  const ask: Request = async (path, init) => {
    const id = nodeId
    if (!id) throw new Error('no node')
    const response = await options.broker.fetch(id, {
      requestId: `helper-telemetry-${(counter += 1)}`,
      path,
      method: init.method,
      headers: init.body === undefined ? {} : { 'content-type': 'application/json' },
      ...(init.body === undefined ? {} : { body: { kind: 'bytes' as const, bytes: new TextEncoder().encode(init.body) } }),
    })
    return { status: response.status, text: new TextDecoder().decode(response.body) }
  }

  const readPref = async (): Promise<string | null> => {
    const { status, text } = await ask(prefsRoute, { method: 'GET' })
    if (status !== 200) return null
    const rows = JSON.parse(text) as Record<string, string>
    return rows[TELEMETRY_PREF_KEY] ?? null
  }

  // ── Posting ──

  let held: TelemetryRecord[] = []
  let posting = false

  const post = async (runtime: PostedTelemetryRuntime, records: readonly TelemetryRecord[]): Promise<void> => {
    for (const body of encodeTelemetryBatches(runtime, records)) {
      const { status } = await ask(coreTelemetryRoute, { method: 'POST', body })
      if (status !== 202) throw new Error(`the node answered ${status}`)
    }
  }

  const drain = async (): Promise<void> => {
    if (posting || held.length === 0) return
    const records = held
    held = []
    posting = true
    try {
      await post('helper', records)
    } catch {
      // The node is restarting, which is the case this queue exists for. Oldest first on the way
      // back, and the cap drops the front rather than the tail so a long outage keeps what happened
      // at the start of it.
      held = [...records, ...held].slice(-QUEUE_MAX)
    } finally {
      posting = false
    }
  }

  const sink = (batch: { records: TelemetryRecord[] }): void => {
    held = [...held, ...batch.records].slice(-QUEUE_MAX)
    void drain()
  }

  // ── The switch ──

  let subscription: Disposable | null = null
  let bootSpansSent = false

  const apply = (on: boolean): void => {
    // Told rather than left to the collector's own five-second tick, because everything worth
    // reporting about a boot happens inside those five seconds.
    setTelemetryPref(on)
    if (on && !subscription) {
      subscription = onTelemetryBatch(sink)
      // The marks were recorded before the answer was known, so they become spans the first time it
      // is yes (./bootMarks.ts § helperBootSpans).
      if (!bootSpansSent) {
        bootSpansSent = true
        helperBootSpans()
      }
      void forwardShellCrash()
      return
    }
    if (!on && subscription) {
      subscription.dispose()
      subscription = null
      held = []
    }
  }

  const poll = async (): Promise<void> => {
    if (!nodeId) return
    const value = await readPref().catch(() => null)
    apply(value === '1')
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
  async function forwardShellCrash(): Promise<void> {
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
      await post('shell', [parsed.data])
      log.warn('the shell panicked on its last run; the record has been reported')
    } catch {
      // The node is not up yet. The file is gone, so this one is lost, and the alternative is
      // keeping a file that gets re-read on every boot until a post happens to succeed.
    }
  }

  // ── Lifecycle ──

  startTelemetry({ node: 'helper', version: options.version, readPref })

  const timer = setInterval(() => void poll(), PREF_POLL_MS)
  // Unref'd like the collector's own: a helper with nothing left to do must be allowed to exit.
  timer.unref?.()

  return {
    setNode: (id) => {
      nodeId = id
      void poll()
    },
    dispose: () => {
      clearInterval(timer)
      // One last flush, so the boot spans and whatever the shutdown produced are not lost to a
      // window that had four seconds left on it.
      flushTelemetry()
      void drain()
      subscription?.dispose()
      subscription = null
    },
  }
}
