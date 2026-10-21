import type { QueryClient } from '@tanstack/solid-query'
import type { TelemetryAttrs } from '@acorn/protocol/telemetry.ts'
import {
  currentActivity,
  emitEvent,
  noteSuspension,
  onTelemetryActivity,
  recordDuration,
  telemetryEnabled,
  type TelemetryActivity,
} from './emitter'

export type ResponsivenessPulse = { active: boolean; activity: TelemetryActivity | null }

/** A one-second tick this late means the window slept or was throttled while hidden. */
const SUSPEND_GAP_MS = 5_000

/** How long frame gaps are sampled after the last sign of activity. */
const FRAME_SAMPLE_MS = 2_000

// Input that can move the screen. `scroll` doesn't bubble, so the listeners capture at the window.
const INPUT_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll'] as const

const screenWorkListeners = new Set<() => void>()
// The socket channels that delivered a frame since the last one-second tick, named on a `ui.stall`.
const recentChannels = new Set<string>()

/**
 * Something that can change the screen arrived without input, such as a socket frame while an agent
 * streams. Frame gaps are sampled for a short while after it. `channel` is the frame's channel
 * prefix, or `binary` for terminal bytes.
 */
export function noteScreenWork(channel?: string): void {
  if (channel) recentChannels.add(channel)
  for (const listener of screenWorkListeners) listener()
}

/** The active Node's query cache, as much of it as a stall report reads. */
type ActiveCache = { client: QueryClient; persistence: { saving(): boolean } }

/**
 * What else was running when the window stalled, since most stalls come with no interaction open.
 * Names and counts only, never a query key or frame content.
 */
function stallContext(activeCache: (() => ActiveCache) | undefined): TelemetryAttrs {
  const context: TelemetryAttrs = { inbound: [...recentChannels].sort().join(',') }
  try {
    const cache = activeCache?.()
    if (cache) {
      context['cache.saving'] = cache.persistence.saving()
      context['queries.fetching'] = cache.client.isFetching()
    }
  } catch {
    // A diagnostic must not fail the page it describes.
  }
  return context
}

/**
 * A local responsiveness check, not an uptime monitor. Only a focused, visible window is armed.
 *
 * Frame gaps are sampled only for a short window after activity. A frame loop that never stops would
 * wake an idle window at the display's refresh rate to measure nothing. The event-loop check stays on
 * its one-second timer, so a stall in an idle window is still reported.
 */
export function startResponsivenessMonitor(
  send: (pulse: ResponsivenessPulse) => void,
  activeCache?: () => ActiveCache,
): () => void {
  let last = performance.now()
  let active = false
  let frame: number | null = null
  let previousFrame = 0
  let sampleUntil = 0
  const isActive = () => telemetryEnabled() && document.visibilityState === 'visible' && document.hasFocus()
  const safelySend = (value: ResponsivenessPulse) => {
    try {
      send(value)
    } catch {
      /* diagnostics cannot fail the UI */
    }
  }
  const pulse = () => {
    const next = isActive()
    // Always send the disarm transition, even when consent has just been revoked.
    if (next || active) safelySend({ active: next, activity: next ? currentActivity() : null })
    active = next
  }
  const paint = (now: number) => {
    frame = null
    if (!isActive()) {
      previousFrame = 0
      return
    }
    // A frame requested inside the window is measured however late it lands, so a stall that runs
    // past the window's end still records its gap.
    if (previousFrame) recordDuration('core', 'ui.frame.gap', now - previousFrame)
    previousFrame = now
    if (now < sampleUntil) frame = requestAnimationFrame(paint)
    else previousFrame = 0
  }
  const sampleFrames = () => {
    sampleUntil = performance.now() + FRAME_SAMPLE_MS
    if (frame === null && isActive()) frame = requestAnimationFrame(paint)
  }
  const changed = () => {
    if (document.visibilityState === 'hidden') noteSuspension()
    last = performance.now()
    pulse()
    if (isActive()) return sampleFrames()
    if (frame !== null) cancelAnimationFrame(frame)
    frame = null
    previousFrame = 0
  }
  const off = onTelemetryActivity(() => {
    pulse()
    sampleFrames()
  })
  screenWorkListeners.add(sampleFrames)
  const timer = setInterval(() => {
    const now = performance.now()
    const delay = Math.max(0, now - last - 1000)
    if (delay > SUSPEND_GAP_MS) noteSuspension()
    // Very large gaps may be suspend/resume. The independent helper applies the same exclusion.
    if (active && isActive() && delay < 30_000) {
      recordDuration('core', 'ui.event_loop.delay', delay)
      if (delay >= 250)
        emitEvent('core', 'ui.stall', { durationMs: delay, ...currentActivity(), ...stallContext(activeCache) })
    }
    recentChannels.clear()
    last = now
    pulse()
  }, 1000)
  for (const type of INPUT_EVENTS) window.addEventListener(type, sampleFrames, { capture: true, passive: true })
  document.addEventListener('visibilitychange', changed)
  window.addEventListener('focus', changed)
  window.addEventListener('blur', changed)
  changed()
  return () => {
    off()
    screenWorkListeners.delete(sampleFrames)
    clearInterval(timer)
    if (frame !== null) cancelAnimationFrame(frame)
    for (const type of INPUT_EVENTS) window.removeEventListener(type, sampleFrames, { capture: true })
    document.removeEventListener('visibilitychange', changed)
    window.removeEventListener('focus', changed)
    window.removeEventListener('blur', changed)
    if (active) safelySend({ active: false, activity: null })
  }
}
