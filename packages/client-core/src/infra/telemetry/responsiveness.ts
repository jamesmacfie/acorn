import { currentActivity, emitEvent, onTelemetryActivity, recordDuration, telemetryEnabled, type TelemetryActivity } from './emitter'

export type ResponsivenessPulse = { active: boolean; activity: TelemetryActivity | null }

/** A local responsiveness check, not an uptime monitor. Only a focused, visible window is armed. */
export function startResponsivenessMonitor(send: (pulse: ResponsivenessPulse) => void): () => void {
  let last = performance.now()
  let active = false
  let frame: number | null = null
  let previousFrame = 0
  const isActive = () => telemetryEnabled() && document.visibilityState === 'visible' && document.hasFocus()
  const safelySend = (value: ResponsivenessPulse) => { try { send(value) } catch { /* diagnostics cannot fail the UI */ } }
  const pulse = () => {
    const next = isActive()
    // Always send the disarm transition, even when consent has just been revoked.
    if (next || active) safelySend({ active: next, activity: next ? currentActivity() : null })
    active = next
  }
  const paint = (now: number) => {
    frame = null
    if (!isActive()) { previousFrame = 0; return }
    if (previousFrame) recordDuration('core', 'ui.frame.gap', now - previousFrame)
    previousFrame = now
    frame = requestAnimationFrame(paint)
  }
  const changed = () => {
    last = performance.now()
    pulse()
    if (isActive() && frame === null) frame = requestAnimationFrame(paint)
    if (!isActive() && frame !== null) { cancelAnimationFrame(frame); frame = null; previousFrame = 0 }
  }
  const off = onTelemetryActivity(() => {
    pulse()
    if (active && frame === null) frame = requestAnimationFrame(paint)
  })
  const timer = setInterval(() => {
    const now = performance.now()
    const delay = Math.max(0, now - last - 1000)
    // Very large gaps may be suspend/resume. The independent helper applies the same exclusion.
    if (active && isActive() && delay < 30_000) {
      recordDuration('core', 'ui.event_loop.delay', delay)
      if (delay >= 250) emitEvent('core', 'ui.stall', { durationMs: delay, ...currentActivity() })
    }
    last = now
    pulse()
    if (active && frame === null) frame = requestAnimationFrame(paint)
  }, 1000)
  document.addEventListener('visibilitychange', changed)
  window.addEventListener('focus', changed)
  window.addEventListener('blur', changed)
  changed()
  return () => {
    off()
    clearInterval(timer)
    if (frame !== null) cancelAnimationFrame(frame)
    document.removeEventListener('visibilitychange', changed)
    window.removeEventListener('focus', changed)
    window.removeEventListener('blur', changed)
    if (active) safelySend({ active: false, activity: null })
  }
}
