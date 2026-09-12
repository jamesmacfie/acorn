import { dispatchLayout } from '../../../features/tasks/tasks'
import type { NoteScope } from '@acorn/protocol/notes.ts'
import type { ExternalRef } from '@acorn/protocol/integrations.ts'
import { onScopeEvicted } from '../shell/scopeEviction'
import type { AgentSessionChangedEvent, ConnectionChangedEvent, HeadChangedEvent, ProjectChangedEvent, RunTargetChangedEvent, TaskChangedEvent, WorkspaceChangedEvent, WorkspaceProjectsChangedEvent } from '@acorn/protocol/nodeEvents.ts'
import { createLogger } from '../../../infra/telemetry/logger'

const log = createLogger('client-event')

export type PaneIntent =
  | { kind: 'notes:open'; slug: string; scope: NoteScope }
  | { kind: 'editor:reveal'; path: string; line: number; column?: number }
  // Show the editor pane's find-in-files panel and focus its box (docs/panes.md § Contributions
  // covers the fold into the editor pane). It has to be an intent for the same reason `editor:reveal`
  // is: the pane may not be mounted yet, and the request has to survive until it is.
  | { kind: 'editor:search' }
  | { kind: 'integration:show-ref'; ref: ExternalRef }
  | { kind: 'context:reveal'; sectionId: string; itemId?: string } // → pane 'context'
  // A row a plugin's declarative rail source was selected on, carried to that plugin's own pane
  // (docs/plugins.md § "Loaded plugins: the client half"). It reuses this mechanism rather than
  // inventing one because the problem is identical: the pane may not be mounted yet, and the intent
  // has to survive until it is.
  | { kind: 'plugin:select'; item: string }
  // Open a workflow run in the workflows pane, at one node when the sender knows which
  // (docs/workflows.md § Routes and UI). Sent by a bell row, an attention row, the rail's recent
  // runs and the agent pane's chip, all of which name a run and none of which can be sure the pane
  // is mounted.
  | { kind: 'workflows:show-run'; runId: string; stepId?: string }

export type ClientEventMap = {
  'boot:restored': { phases: ('workspace' | 'view' | 'panes')[] }
  'presentation:pane-intent': { taskId: string; paneId: string; intent: PaneIntent }
  'presentation:terminal-focus': { taskId: string; sessionId: string }
  'presentation:file-scroll': { routeKey: string; path: string }
  // Deep-link into a settings page from a pane. The shell owns the modal, and a pane cannot reach the
  // UiSlotContext's `openSettings`, so the request is an event rather than a prop threaded through
  // every pane that might ever need one.
  'presentation:open-settings': { tab: string }
  // A surface-scoped plugin command, on its way to the frame region of a composed pane
  // (docs/editor.md § Communication between regions). Not retained like a pane intent:
  // an intent describes a destination the reader is being taken to, so it waits for the pane to
  // exist, whereas this is a verb fired at a frame that is already on screen. Replaying "run the
  // query" into a pane that opens ten minutes later would be a surprise, not a fix.
  'plugin:surface-action': { pluginId: string; surface: string; command: string }
  'runtime:task-archived': { taskId: string }
  'runtime:workspace-removed': { workspaceId: string }
  // A node left the fleet (unpaired or revoked). Emitted by the renderer after main confirms the
  // removal, because main is the authority on membership.
  'runtime:node-removed': { nodeId: string }
  // The active node changed. Emitted by `setActiveNode` before the QueryClient provider swaps, so a
  // listener clearing module state runs while the outgoing node's components are still mounted rather
  // than after the incoming node has rendered against stale data.
  //
  // It exists because the per-node QueryClient partition covers cached queries only. Feature state
  // that lives in module-level Solid signals, such as the managed-agent roster, terminal sessions, the
  // notice feed, and per-workspace view memory, sat outside it, so switching nodes showed node A's
  // agent sessions and notices under node B, keyed by ids that may collide across nodes by
  // construction.
  'runtime:node-switched': { from: string | null; to: string | null }
  // Focus moved to another region of another pane. Renderer-local like the rest of this family, and
  // for a stronger reason than the others: focus is a fact about one window, so the node has nothing
  // to say about it and never broadcasts one. Coarse on purpose — the region, not the node inside it
  // — because a per-keystroke feed is on the refused list
  // (docs/plugins/forward-compatibility.md § What is not an event).
  //
  // The one emit point is the region focus store (keys/regions.ts); the full contract lives in
  // docs/command-palette-and-shortcuts.md § Focus and typing.
  'runtime:focus-changed': { taskId: string | null; paneId: string; regionId: string }
  // ── Node-emitted facts ──────────────────────────────────────────────────────────────────────────
  //
  // The other family (plugins/frames/channels.ts explains the split). Everything above is emitted in
  // the renderer that caused it and means "something you were displaying is gone or moved". These
  // arrive over the socket from the node and mean "something happened there you may want to act on",
  // so they reach every window, not just the one that acted.
  //
  // The task id is an addressable invalidation; null says the writer changed a batch or could not
  // narrow the scope. It remains a "go re-read" hint, not an event log.
  'tasks:changed': TaskChangedEvent
  // Connection carries more state, and the reason is the audience. Every integration plugin
  // hears this one, and almost all of them are looking at a different provider, so three fields let a
  // listener drop the frame without a round trip. Still state rather than a delta: `status` is what the
  // connection now is (node-core/server/notify.ts § broadcastConnectionChanged).
  'connection:changed': ConnectionChangedEvent
  // The rest of the core catalogue (docs/plugins.md § Hearing a core event), each carrying the state it is
  // about rather than a delta, for the same reason `connection:changed` does.
  'head:changed': HeadChangedEvent
  'run:changed': RunTargetChangedEvent
  'agent-session:changed': AgentSessionChangedEvent
  'project:changed': ProjectChangedEvent
  'workspace:changed': WorkspaceChangedEvent
  'workspace-projects:changed': WorkspaceProjectsChangedEvent
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
        log.error(String(kind), error, { 'event.kind': String(kind) })
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
