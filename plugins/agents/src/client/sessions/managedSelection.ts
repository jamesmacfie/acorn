import { agentTelemetry, markAgentSelection, startAgentView } from './agentTelemetry'
import { createSignal } from 'solid-js'
import { clientEvents, consumePaneIntent, dispatchLayout, registerNoticeTargetHandler } from '@acorn/plugin-api/client'
import { AGENT_PANE_ID } from '../paneIdentity'

const [selectedByTask, setSelectedByTask] = createSignal<Record<string, string | undefined>>({})
const [focusedRequestBySession, setFocusedRequestBySession] = createSignal<Record<string, string | undefined>>({})
// Keyed by session rather than by task, so switching sessions in the sidebar and back returns to the
// subagent you were reading instead of the top of the transcript.
const [selectedSubagentBySession, setSelectedSubagentBySession] = createSignal<Record<string, string | undefined>>({})
// Keyed by session for the same reason: the transcript remounts on every return, and the "Chats only"
// filter should still be on when you come back. Held for the app's lifetime, not across relaunches.
const [chatsOnlyBySession, setChatsOnlyBySession] = createSignal<Record<string, boolean>>({})

export const managedChatsOnly = (sessionId: string): boolean => chatsOnlyBySession()[sessionId] === true

export function toggleManagedChatsOnly(sessionId: string): void {
  setChatsOnlyBySession((current) => ({ ...current, [sessionId]: !current[sessionId] }))
}

export const selectedManagedSession = (taskId: string): string | undefined => selectedByTask()[taskId]
export const focusedManagedRequest = (sessionId: string): string | undefined => focusedRequestBySession()[sessionId]
export const selectedManagedSubagent = (sessionId: string): string | undefined => selectedSubagentBySession()[sessionId]

// One signal, two readers that agree by construction: it is which subagent's run the main window is
// showing, and the sidebar row for that subagent is the one drawn as selected. Absent means the
// session's own stream.
export function selectManagedSubagent(sessionId: string, subagentId: string): void {
  const view = selectedManagedSubagent(sessionId) !== subagentId ? startAgentView('agents.subagent.open') : null
  setSelectedSubagentBySession((current) => ({ ...current, [sessionId]: subagentId }))
  view?.ready()
}

/** Back out of a subagent's run to the session's own stream. */
export function clearManagedSubagent(sessionId: string): void {
  setSelectedSubagentBySession((current) => {
    if (current[sessionId] === undefined) return current
    const next = { ...current }
    delete next[sessionId]
    return next
  })
}

export function selectManagedSession(taskId: string, sessionId: string): void {
  if (selectedManagedSession(taskId) !== sessionId) {
    markAgentSelection(taskId, sessionId)
    agentTelemetry.startRenderTransition('agents.session.select')
  }
  setSelectedByTask((current) => ({ ...current, [taskId]: sessionId }))
  requestComposerFocus(sessionId)
}

/** Selects without measuring an open, for a selection nothing is about to draw: the task list's
 *  default, which the conversation has already measured as its own mount, or one made for a pane that
 *  isn't shown. A conversation that mounts on it later measures that mount. */
export function restoreManagedSessionSelection(taskId: string, sessionId: string): void {
  setSelectedByTask((current) => ({ ...current, [taskId]: sessionId }))
  requestComposerFocus(sessionId)
}

export function clearManagedSession(taskId: string, expectedSessionId?: string): void {
  setSelectedByTask((current) => {
    if (!(taskId in current) || (expectedSessionId && current[taskId] !== expectedSessionId)) return current
    const next = { ...current }
    delete next[taskId]
    return next
  })
  if (!expectedSessionId) return
  for (const clear of [setFocusedRequestBySession, setSelectedSubagentBySession]) {
    clear((current) => {
      if (!(expectedSessionId in current)) return current
      const next = { ...current }
      delete next[expectedSessionId]
      return next
    })
  }
}

/** Consume the pending reveal for a session. It is a one-shot navigation command, like the composer
 *  focus below: once the transcript has been handed the request to scroll to, leaving it in the store
 *  would replay the scroll-and-focus on every later remount and pull a typing reader back to it. */
export function clearFocusedManagedRequest(sessionId: string): void {
  setFocusedRequestBySession((current) => {
    if (current[sessionId] === undefined) return current
    const next = { ...current }
    delete next[sessionId]
    return next
  })
}

export function openManagedSession(taskId: string, sessionId: string, requestId?: string): void {
  selectManagedSession(taskId, sessionId)
  setFocusedRequestBySession((current) => ({ ...current, [sessionId]: requestId }))
  dispatchLayout(taskId, { type: 'show', pane: 'agents' })
}

// The attention inbox's id for a session row, built in one place so the row and the acknowledgement
// that retires it cannot drift apart (client-core attentionInbox.ts).
export const agentAttentionItemId = (sessionId: string): string => `agents.sessions:${sessionId}`

export function activateManagedAgentNoticeTargets(): () => void {
  return registerNoticeTargetHandler('managed-agent', (taskId, target) => {
    openManagedSession(taskId, target.resourceId, target.subresourceId)
  })
}

// The other way in: a dashboard row for a session. The host activates the row's task and opens this
// pane with the row's id as a selection intent; what the id means is the one thing it can't know.
//
// A listener rather than a read inside the pane, because the selection is a module signal keyed by task,
// so setting it works whether the pane is mounted, mounting, or about to be. The intent is still
// consumed: one nobody collects would replay at whatever mounts into that slot next.
export function activateManagedAgentPaneIntents(): () => void {
  return clientEvents.on('presentation:pane-intent', (event) => {
    if (event.paneId !== AGENT_PANE_ID || event.intent.kind !== 'plugin:select') return
    consumePaneIntent(event.taskId, event.paneId)
    selectManagedSession(event.taskId, event.intent.item)
  })
}

// Selecting a session hands the caret to its composer, including selecting the session already on
// screen. One-shot and keyed by session, so later metadata updates do not replay the request.
const [pendingComposerFocus, setPendingComposerFocus] = createSignal<string>()

export function requestComposerFocus(sessionId: string): void {
  setPendingComposerFocus(sessionId)
}

/** True once, for the session the focus was asked for. */
export function consumeComposerFocus(sessionId: string): boolean {
  if (pendingComposerFocus() !== sessionId) return false
  setPendingComposerFocus(undefined)
  return true
}
