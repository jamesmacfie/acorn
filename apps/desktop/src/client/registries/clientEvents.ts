import { dispatchLayout } from '../features/tasks/tasks'
import type { NoteScope } from '../../shared/notes'

export type PaneIntent =
  | { kind: 'notes:open'; slug: string; scope: NoteScope }
  | { kind: 'editor:reveal'; path: string; line: number }

export type ClientEventMap = {
  'boot:restored': { phases: ('workspace' | 'view' | 'panes')[] }
  'presentation:pane-intent': { taskId: string; paneId: string; intent: PaneIntent }
  'presentation:terminal-focus': { taskId: string; sessionId: string }
  'presentation:file-scroll': { routeKey: string; path: string }
  'runtime:task-archived': { taskId: string }
  'runtime:workspace-removed': { workspaceId: string }
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

// Pane intents are retained until the target pane consumes them, closing the mount-order race that
// the old one-shot signals encoded. Payloads remain plain serializable data.
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
