import { activeTaskId, telemetryFor } from '@acorn/plugin-api/client'

export const agentTelemetry = telemetryFor('agents')

// Only a DOM host has a page visibility. The terminal client has no `document`.
const pageVisibility = (): DocumentVisibilityState | undefined =>
  typeof document === 'undefined' ? undefined : document.visibilityState

/** One opening, ending after loaded content has had a paint opportunity, including cached views.
 *  `claimed` says whether a conversation has taken the open on, and is recorded on a timeout. */
export function startAgentView(name: string, claimed?: () => boolean) {
  const span = agentTelemetry.startOperation(name)
  if (!span.traceId) return { ready: () => {}, fail: () => {}, dispose: () => {} }
  let done = false
  let scheduled = false
  let frame: number | null = null
  let hiddenCheck: ReturnType<typeof setTimeout> | undefined
  const finish = (
    outcome: 'ready' | 'error' | 'cancelled' | 'timeout',
    attrs: Record<string, string | boolean> = {},
  ) => {
    if (done) return
    done = true
    clearTimeout(timer)
    clearTimeout(hiddenCheck)
    if (frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
    span.end(outcome === 'error' || outcome === 'timeout' ? 'error' : 'ok', { ...attrs, outcome })
  }
  const timer = setTimeout(() => {
    const visibility = pageVisibility()
    finish('timeout', {
      ...(claimed ? { claimed: claimed() } : {}),
      ...(visibility ? { visibility } : {}),
    })
  }, 30_000)
  return {
    ready: () => {
      if (done || scheduled) return
      scheduled = true
      if (typeof requestAnimationFrame !== 'function') {
        finish('ready')
        return
      }
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => finish('ready'))
      })
      // A hidden window draws no frames, so the wait above would run to the timeout after the content
      // had arrived. Tagged, so the latency numbers can leave these out.
      hiddenCheck = setTimeout(() => {
        if (pageVisibility() === 'hidden') finish('ready', { hidden: true })
      }, 100)
    },
    fail: () => finish('error'),
    dispose: () => finish('cancelled'),
  }
}

// Selection starts before the signal write; the conversation claims it when that selection mounts.
// Only the latest selection is retained, never a growing map of task/session IDs.
type AgentSelection = { id: string; view: ReturnType<typeof startAgentView> }
let selected: AgentSelection | null = null
export function markAgentSelection(taskId: string, id: string): void {
  selected?.view.dispose()
  const mark: AgentSelection = { id, view: startAgentView('agents.session.open', () => selected !== mark) }
  selected = mark
  // After the caller's writes. A conversation on screen claims the mark synchronously, and one that
  // is still mounting belongs to the active task. A session picked for any other task draws nothing,
  // so its open ends here rather than at the timeout. If that task's conversation mounts later, it
  // measures its own open from the mount.
  queueMicrotask(() => {
    if (selected !== mark || activeTaskId() === taskId) return
    selected = null
    mark.view.dispose()
  })
}
export function claimAgentSelection(id: string): ReturnType<typeof startAgentView> {
  if (selected?.id === id) {
    const view = selected.view
    selected = null
    return view
  }
  return startAgentView('agents.session.open', () => true)
}
