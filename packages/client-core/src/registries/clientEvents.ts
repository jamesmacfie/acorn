import { dispatchLayout } from '../tasks/tasks'
import type { NoteScope } from '@acorn/protocol/notes.ts'
import type { ExternalRef } from '@acorn/protocol/integrations.ts'
import { onScopeEvicted } from './scopeEviction'

export type PaneIntent =
  | { kind: 'notes:open'; slug: string; scope: NoteScope }
  | { kind: 'editor:reveal'; path: string; line: number; column?: number }
  | { kind: 'integration:show-ref'; ref: ExternalRef }
  | { kind: 'context:reveal'; sectionId: string; itemId?: string } // → pane 'context'
  // A row a plugin's declarative rail source was selected on, carried to that plugin's own pane
  // (docs/plugins.md). It reuses this mechanism
  // rather than inventing one because the problem is identical: the pane may not be mounted yet, and
  // the intent has to survive until it is.
  | { kind: 'plugin:select'; item: string }

export type ClientEventMap = {
  'boot:restored': { phases: ('workspace' | 'view' | 'panes')[] }
  'presentation:pane-intent': { taskId: string; paneId: string; intent: PaneIntent }
  'presentation:terminal-focus': { taskId: string; sessionId: string }
  'presentation:file-scroll': { routeKey: string; path: string }
  // Deep-link into a settings page from a pane. The shell owns the modal, and a pane cannot reach the
  // UiSlotContext's `openSettings` — so the request is an event rather than a prop threaded through
  // every pane that might ever need one.
  'presentation:open-settings': { tab: string }
  'runtime:task-archived': { taskId: string }
  'runtime:workspace-removed': { workspaceId: string }
  // A node left the fleet (unpaired or revoked). Emitted by the renderer AFTER main confirms the
  // removal, because main is the authority on membership.
  'runtime:node-removed': { nodeId: string }
  // The active node changed. Emitted by `setActiveNode` BEFORE the QueryClient provider swaps, so a
  // listener clearing module state runs while the outgoing node's components are still mounted rather
  // than after the incoming node has rendered against stale data.
  //
  // It exists because the per-node QueryClient partition covers cached QUERIES only. Feature state that
  // lives in module-level Solid signals — the managed-agent roster, terminal sessions, the notice feed,
  // per-workspace view memory — sat outside it, so switching nodes showed node A's agent sessions and
  // notices under node B, keyed by ids that may collide across nodes by construction.
  'runtime:node-switched': { from: string | null; to: string | null }
}

type Listener<T> = (payload: T) => void

class ClientEventBus {
  readonly #listeners = new Map<keyof ClientEventMap, Set<Listener<never>>>()

  on<K extends keyof ClientEventMap>(kind: K, listener: Listener<ClientEventMap[K]>): () => void {
    const listeners = this.#listeners.get(kind) ?? new Set()
    listeners.add(listener as Listener<never>)
    this.#listeners.set(kind, listeners)
    return () => listeners.delete(listener as Listener<never>)
  }

  emit<K extends keyof ClientEventMap>(kind: K, payload: ClientEventMap[K]): void {
    for (const listener of this.#listeners.get(kind) ?? []) {
      try {
        ;(listener as Listener<ClientEventMap[K]>)(payload)
      } catch (error) {
        console.error(`[client-event:${kind}]`, error)
      }
    }
  }
}

export const clientEvents = new ClientEventBus()

// Pane intents are retained until the target pane consumes them, closing the mount-order race. Payloads
// remain plain serializable data.
const pendingPaneIntents = new Map<string, PaneIntent>()
const paneIntentKey = (taskId: string, paneId: string) => `${taskId}:${paneId}`

export function openPane(taskId: string, paneId: string, intent?: PaneIntent, mode: 'show' | 'add' = 'show'): void {
  if (intent) pendingPaneIntents.set(paneIntentKey(taskId, paneId), intent)
  dispatchLayout(taskId, { type: mode, pane: paneId })
  if (intent) clientEvents.emit('presentation:pane-intent', { taskId, paneId, intent })
}

export function consumePaneIntent(taskId: string, paneId: string): PaneIntent | undefined {
  const key = paneIntentKey(taskId, paneId)
  const intent = pendingPaneIntents.get(key)
  pendingPaneIntents.delete(key)
  return intent
}

const pendingTerminalFocus = new Map<string, string>()
export function requestTerminalFocusIntent(taskId: string, sessionId: string): void {
  pendingTerminalFocus.set(taskId, sessionId)
  clientEvents.emit('presentation:terminal-focus', { taskId, sessionId })
}
export function consumeTerminalFocusIntent(taskId: string): string | undefined {
  const sessionId = pendingTerminalFocus.get(taskId)
  pendingTerminalFocus.delete(taskId)
  return sessionId
}

export function evictPendingIntents(taskId: string): void {
  const prefix = `${taskId}:`
  for (const key of pendingPaneIntents.keys()) if (key.startsWith(prefix)) pendingPaneIntents.delete(key)
  pendingTerminalFocus.delete(taskId)
}

// Registered here rather than listed in the shell's evictor file, so this signal and the thing that
// clears it are one edit apart (registries/scopeEviction.ts states the full argument).
onScopeEvicted((e) => {
  if (e.scope === 'task') evictPendingIntents(e.taskId)
})
