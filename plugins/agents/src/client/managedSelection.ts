import { createSignal } from 'solid-js'
import { dispatchLayout, registerNoticeTargetHandler } from '@acorn/plugin-api/client'

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
