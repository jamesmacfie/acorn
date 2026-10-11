import { startSpan, type SpanHandle } from './emitter'

// How long a feature takes to become usable after the host opens it
// (docs/telemetry/renderer.md § Feature openings).
//
// The host opens a record where it mounts a feature: a task pane, a rail source, or Settings. The
// feature itself closes it, because only the feature knows when its content can be used. A cached
// list, a finished empty result, an editable document, or a recoverable error all count. A spinner
// does not. A feature that never reports is closed by the host when it mounts, and the record says
// `proxy: 'mount'` so nobody reads that number as usable time.
//
// One pending record per feature id, never one per task. Opening a feature again replaces its
// pending record, and the map holds at most MAX_PENDING records, so a person clicking through fifty
// tasks costs fifty short-lived entries and no growing map.
//
// `first` says whether this document has opened that feature before. That's module-cache warmth: a
// first opening also pays to load the feature's code. Query-cache warmth is a separate fact, and a
// feature that knows it passes `cached` when it reports.

export type UsableState = 'content' | 'empty' | 'offline' | 'error'

/** How a record ended. `usable` covers all four `UsableState`s. */
type OpeningOutcome = 'usable' | 'timeout' | 'cancelled'

export type FeatureKind = 'pane' | 'source' | 'settings'

/** What the startup account learns once every feature that was open has settled. */
export type FeatureSettlement = {
  features: number
  /** At least one of them closed on mount rather than on its own report. */
  proxy: boolean
  /** The worst outcome among them: `timeout` beats `cancelled` beats `usable`. */
  outcome: OpeningOutcome
}

type Pending = {
  reportsUsable: boolean
  span: SpanHandle
  timer: ReturnType<typeof setTimeout>
}

export const MAX_PENDING_OPENINGS = 16
export const OPENING_TIMEOUT_MS = 30_000

const pending = new Map<string, Pending>()
const opened = new Set<string>()
const settledListeners = new Set<(featureId: string, outcome: OpeningOutcome, proxy: boolean) => void>()

function settle(
  featureId: string,
  record: Pending,
  outcome: OpeningOutcome,
  attrs: Record<string, string | boolean>,
): void {
  if (pending.get(featureId) !== record) return
  pending.delete(featureId)
  clearTimeout(record.timer)
  const proxy = outcome === 'usable' && attrs.proxy === 'mount'
  // A cancelled opening is not a measurement. The span is dropped, but the startup account still
  // hears that the feature went away.
  if (outcome !== 'cancelled') record.span.end(outcome === 'usable' ? 'ok' : 'error', { outcome, ...attrs })
  for (const listener of settledListeners) listener(featureId, outcome, proxy)
}

/**
 * Start timing a feature the host is mounting. Returns the close the host calls on unmount, which
 * cancels the record if the feature never reported.
 */
export function openFeature(
  featureId: string,
  owner: string,
  options: { kind: FeatureKind; reportsUsable: boolean },
): () => void {
  const previous = pending.get(featureId)
  if (previous) settle(featureId, previous, 'cancelled', {})
  if (pending.size >= MAX_PENDING_OPENINGS) {
    const [oldestId, oldest] = pending.entries().next().value!
    settle(oldestId, oldest, 'cancelled', {})
  }
  const first = !opened.has(featureId)
  opened.add(featureId)
  const record: Pending = {
    reportsUsable: options.reportsUsable,
    span: startSpan(owner, {
      name: 'ui.feature.open',
      attrs: { seam: 'ui.feature.open', 'feature.id': featureId, 'feature.kind': options.kind, first },
    }),
    timer: setTimeout(() => settle(featureId, record, 'timeout', {}), OPENING_TIMEOUT_MS),
  }
  pending.set(featureId, record)
  return () => settle(featureId, record, 'cancelled', {})
}

/** The feature's own report that it can be used now. Ignored when nothing is pending for it. */
export function featureUsable(
  featureId: string,
  state: UsableState = 'content',
  facts: { cached?: boolean } = {},
): void {
  const record = pending.get(featureId)
  if (!record) return
  settle(featureId, record, 'usable', { state, ...(facts.cached === undefined ? {} : { cached: facts.cached }) })
}

/** The host's mount, which closes a feature that does not report for itself. */
export function featureMounted(featureId: string): void {
  const record = pending.get(featureId)
  if (!record || record.reportsUsable) return
  settle(featureId, record, 'usable', { state: 'content', proxy: 'mount' })
}

/**
 * Resolves once every feature open right now has settled. The startup account calls this once the
 * restored destination is on screen. With nothing open it resolves straight away, which is the
 * empty, onboarding, and no-project screens.
 */
export function whenOpenFeaturesSettle(): Promise<FeatureSettlement> {
  const waiting = new Set(pending.keys())
  const settlement: FeatureSettlement = { features: waiting.size, proxy: false, outcome: 'usable' }
  if (!waiting.size) return Promise.resolve(settlement)
  const rank = { usable: 0, cancelled: 1, timeout: 2 }
  return new Promise((resolve) => {
    const listener = (featureId: string, outcome: OpeningOutcome, proxy: boolean) => {
      if (!waiting.delete(featureId)) return
      settlement.proxy ||= proxy
      if (rank[outcome] > rank[settlement.outcome]) settlement.outcome = outcome
      if (waiting.size) return
      settledListeners.delete(listener)
      resolve(settlement)
    }
    settledListeners.add(listener)
  })
}

/** Test seam: forget every record and every first opening. */
export function _resetFeatureOpenings(): void {
  for (const record of pending.values()) clearTimeout(record.timer)
  pending.clear()
  opened.clear()
  settledListeners.clear()
}
