import { createSignal } from 'solid-js'
import { clientEvents, consumePaneIntent, dispatchLayout, registerNoticeTargetHandler } from '@acorn/plugin-api/client'
import { AGENT_PANE_ID } from './paneContribution'

const [selectedByTask, setSelectedByTask] = createSignal<Record<string, string | undefined>>({})
const [focusedRequestBySession, setFocusedRequestBySession] = createSignal<Record<string, string | undefined>>({})

export const selectedManagedSession = (taskId: string): string | undefined => selectedByTask()[taskId]
export const focusedManagedRequest = (sessionId: string): string | undefined =>
  focusedRequestBySession()[sessionId]

export function selectManagedSession(taskId: string, sessionId: string): void {
  setSelectedByTask((current) => ({ ...current, [taskId]: sessionId }))
}

export function clearManagedSession(taskId: string, expectedSessionId?: string): void {
  setSelectedByTask((current) => {
    if (!(taskId in current) || (expectedSessionId && current[taskId] !== expectedSessionId)) return current
    const next = { ...current }
    delete next[taskId]
    return next
  })
  if (!expectedSessionId) return
  setFocusedRequestBySession((current) => {
    if (!(expectedSessionId in current)) return current
    const next = { ...current }
    delete next[expectedSessionId]
    return next
  })
}

export function openManagedSession(taskId: string, sessionId: string, requestId?: string): void {
  selectManagedSession(taskId, sessionId)
  setFocusedRequestBySession((current) => ({ ...current, [sessionId]: requestId }))
  dispatchLayout(taskId, { type: 'show', pane: 'agents' })
}

export function activateManagedAgentNoticeTargets(): () => void {
  return registerNoticeTargetHandler('managed-agent', (taskId, target) => {
    openManagedSession(taskId, target.resourceId, target.subresourceId)
  })
}

// The other way in: a dashboard row for a session, whose click the host resolves. It activates the row's
// task, navigates there and opens this pane with the row's id as a selection intent
// (client-core/plugins/chrome/actions.ts § openPane). All that's left is what the id means, which is the
// one thing the host can't know.
//
// A listener rather than a read inside the pane, because the selection lives in a module signal keyed by
// task rather than in the pane's own state, so setting it works whether the pane is mounted, mounting,
// or about to be. The intent is consumed all the same: a retained intent nobody collects would be
// replayed at whatever mounts into that slot next.
export function activateManagedAgentPaneIntents(): () => void {
  return clientEvents.on('presentation:pane-intent', (event) => {
    if (event.paneId !== AGENT_PANE_ID || event.intent.kind !== 'plugin:select') return
    consumePaneIntent(event.taskId, event.paneId)
    selectManagedSession(event.taskId, event.intent.item)
  })
}
