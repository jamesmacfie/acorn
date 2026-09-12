import { telemetryFor } from '@acorn/plugin-api/client'

export const agentTelemetry = telemetryFor('agents')

/** One opening, ending after loaded content has had a paint opportunity, including cached views. */
export function startAgentView(name: string) {
  const span = agentTelemetry.startOperation(name)
  if (!span.traceId) return { ready: () => {}, fail: () => {}, dispose: () => {} }
  let done = false
  let scheduled = false
  let frame: number | null = null
  const finish = (outcome: 'ready' | 'error' | 'cancelled' | 'timeout') => {
    if (done) return
    done = true
    clearTimeout(timer)
    if (frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
    span.end(outcome === 'error' || outcome === 'timeout' ? 'error' : 'ok', { outcome })
  }
  const timer = setTimeout(() => finish('timeout'), 30_000)
  return {
    ready: () => {
      if (done || scheduled) return
      scheduled = true
      if (typeof requestAnimationFrame !== 'function') { finish('ready'); return }
      frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => finish('ready')) })
    },
    fail: () => finish('error'),
    dispose: () => finish('cancelled'),
  }
}

// Selection starts before the signal write; the conversation claims it when that selection mounts.
// Only the latest selection is retained, never a growing map of task/session IDs.
let selected: { id: string; view: ReturnType<typeof startAgentView> } | null = null
export function markAgentSelection(id: string): void {
  selected?.view.dispose()
  selected = { id, view: startAgentView('agents.session.open') }
}
export function claimAgentSelection(id: string): ReturnType<typeof startAgentView> {
  if (selected?.id === id) {
    const view = selected.view
    selected = null
    return view
  }
  return startAgentView('agents.session.open')
}
