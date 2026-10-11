import type { TelemetryAttrs } from '@acorn/protocol/telemetry.ts'
import { emitSpan, newSpanId, telemetryEnabled } from '@acorn/client-core/infra/telemetry/emitter.ts'
import { whenOpenFeaturesSettle } from '@acorn/client-core/infra/telemetry'
import { startupTraceId } from './boot'

// The four moments a launch is judged by, beside the boot account in ./boot.ts and in its trace
// (docs/telemetry/renderer.md § Startup milestones).
//
//   first_frame  the first frame the owner could see
//   shell        the startup screen gave way to the shell: rail, top bar, and content region
//   restored     the saved state is hydrated and the window has chosen where to land
//   usable       everything visible at that landing has said it is usable, or shown an actionable
//                empty, offline, or error state
//
// Each is a number off `performance.now()`, which counts from this document's navigation and never
// jumps with the wall clock. Each is recorded once and emitted once. The switch is a preference on the
// Node and usually arrives after some of these, so they are emitted when it turns on, the same way
// the boot account is. Until then they are local numbers and nothing else.
//
// A window that was hidden at any point before a milestone says `visibility: 'hidden'` on it. WebKit
// runs a hidden or occluded window at background priority, so those numbers describe a launch nobody
// watched and are not comparable with a visible one. The roster's 250 ms fallback in ./index.tsx is
// never counted as a frame.

type Milestone = 'first_frame' | 'shell' | 'restored' | 'usable'
type Recorded = { at: number; attrs: TelemetryAttrs }

const recorded = new Map<Milestone, Recorded>()
const emitted = new Set<Milestone>()
let hiddenAt: number | null = null
/** The Node the restored and usable milestones belong to. Undefined until a shell restores. */
let accountNode: string | undefined
let abandoned = false

function watchVisibility(): void {
  if (typeof document === 'undefined') return
  if (document.hidden) hiddenAt = 0
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && hiddenAt === null) hiddenAt = performance.now()
  })
}

const visibilityAt = (at: number): 'hidden' | 'visible' => (hiddenAt !== null && hiddenAt <= at ? 'hidden' : 'visible')

function record(name: Milestone, at: number, attrs: TelemetryAttrs = {}): void {
  if (recorded.has(name)) return
  recorded.set(name, { at, attrs: { ...attrs, visibility: visibilityAt(at) } })
  performance.mark(`acorn:startup:${name}`, { startTime: at })
  emitReady()
}

/**
 * The first frame, from the browser's first-contentful-paint entry where the engine reports paint
 * timing. WebKit reports it for a hidden window too, which an animation frame callback never sees.
 */
function observeFirstPaint(): boolean {
  if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes?.includes('paint'))
    return false
  const observer = new PerformanceObserver((list) => {
    const paint = list.getEntriesByName('first-contentful-paint')[0]
    if (!paint) return
    observer.disconnect()
    record('first_frame', paint.startTime, { method: 'paint', proxy: false })
  })
  observer.observe({ type: 'paint', buffered: true })
  return true
}

let paintObserved = false
function watch(): void {
  watchVisibility()
  paintObserved = observeFirstPaint()
}
watch()

/**
 * The first animation frame callback after the tree was built. It stands in for the first frame only
 * on an engine without paint timing, labelled as a proxy, because the callback runs before its frame
 * paints.
 */
export function markFirstFrame(): void {
  if (!paintObserved) record('first_frame', performance.now(), { method: 'frame', proxy: true })
}

/** The first time this document drew the shell, whichever Node it was for. */
export function markShellDrawn(): void {
  record('shell', performance.now())
}

export type StartupAccount = {
  /** The window has hydrated its saved state and chosen where to land. */
  restored(): void
  /**
   * The launch stopped before restoring, on a screen the person can act on: a failure with Try again,
   * or an offline Node with nothing cached. That screen is the launch's usable state, so it ends the
   * usable milestone with its outcome and the step that stopped it.
   */
  stopped(step: string, outcome: 'offline' | 'error'): void
}

const INERT_ACCOUNT: StartupAccount = { restored: () => {}, stopped: () => {} }

/**
 * The restored and usable milestones belong to the first Node whose shell restores. A window can mount
 * the shell several times before that: under the placeholder cache on a first launch, or for a
 * remembered Node it then re-homes from. Those mounts claim nothing. Once a Node has restored, a mount
 * for a different Node is a Node switch: it abandons the account, dropping whatever was not emitted
 * yet, so the previous Node's launch is never posted to the next one and the next one's restore is
 * never reported as a cold start.
 */
export function claimStartupAccount(nodeId: string | null): StartupAccount {
  if (nodeId === null) return INERT_ACCOUNT
  if (accountNode !== undefined && nodeId !== accountNode && !abandoned) {
    abandoned = true
    for (const name of ['restored', 'usable'] as const) if (!emitted.has(name)) recorded.delete(name)
  }
  // Another Node's account, or one a switch abandoned, is not this mount's to record into.
  const foreign = () => abandoned || (accountNode !== undefined && accountNode !== nodeId)
  return {
    stopped: (step, outcome) => {
      if (foreign() || recorded.has('restored')) return
      accountNode = nodeId
      record('usable', performance.now(), { features: 0, proxy: false, outcome, 'startup.step': step })
    },
    restored: () => {
      // A launch that stopped and was retried still records its restore. Its usable milestone is the
      // stopped screen, which came first.
      if (foreign() || recorded.has('restored')) return
      accountNode = nodeId
      record('restored', performance.now())
      // After this turn, so the destination the restore just chose has mounted its features and
      // opened their records (client-core infra/telemetry/featureOpening.ts).
      setTimeout(() => {
        void whenOpenFeaturesSettle().then((settlement) => {
          if (abandoned) return
          record('usable', performance.now(), {
            features: settlement.features,
            proxy: settlement.proxy,
            outcome: settlement.outcome,
          })
        })
      }, 0)
    },
  }
}

/** Called when the switch turns on. Emits whatever is recorded and not yet emitted, the same
 *  retroactive rule the boot account follows (./boot.ts § emitBootSpans). */
export function emitStartupMilestones(): void {
  emitReady()
}

function emitReady(): void {
  if (!telemetryEnabled()) return
  const origin = performance.timeOrigin
  for (const name of ['first_frame', 'shell', 'restored', 'usable'] as const) {
    if (emitted.has(name)) continue
    const milestone = recorded.get(name)
    if (!milestone) continue
    emitted.add(name)
    const spanId = newSpanId()
    emitSpan('core', {
      traceId: startupTraceId,
      spanId,
      name: `renderer.startup.${name}`,
      start: origin,
      durationMs: milestone.at,
      status: milestone.attrs.outcome === 'timeout' || milestone.attrs.outcome === 'error' ? 'error' : 'ok',
      attrs: { seam: `renderer.startup.${name}`, ...milestone.attrs },
    })
    // The usable span carries its two phases as children, so a slow launch says whether the time
    // went into restoring or into the features' own content.
    const restored = recorded.get('restored')
    if (name !== 'usable' || !restored) continue
    for (const [phase, from, to] of [
      ['restore', 0, restored.at],
      ['content', restored.at, milestone.at],
    ] as const) {
      emitSpan('core', {
        traceId: startupTraceId,
        spanId: newSpanId(),
        parentSpanId: spanId,
        name: 'renderer.startup.phase',
        start: origin + from,
        durationMs: to - from,
        status: 'ok',
        attrs: { seam: 'renderer.startup.phase', phase },
      })
    }
  }
}

/** Test seam: forget every milestone and the account, and start watching again. */
export function _resetStartupMilestones(): void {
  recorded.clear()
  emitted.clear()
  hiddenAt = null
  accountNode = undefined
  abandoned = false
  watch()
}
