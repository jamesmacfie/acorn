// Rail selection state (docs/workspaces). The task *list* is a TanStack query (tasksOptions); this
// module tracks what the rail has selected — a Source browse view or an active task — plus each
// task's pane layout. Signals-only, like ../terminal/sessions.ts. The terminal drawer + topbar key
// off activeTaskId.
import { createSignal } from 'solid-js'
import { applyLayoutAction, defaultLayout, type LayoutAction, type PaneId, type TaskLayout } from './layout'
import { sourceRegistry } from '../../registries/sources'

export type { PaneId, TaskLayout } from './layout'

// Which browse Source is selected, or null when a task is the active view (docs/workspaces 04).
// Known core ids stay typed for contributions and UI construction. The live selection deliberately
// accepts an unknown string so a temporarily missing plugin source remains inert and round-trips
// through persistence until the user explicitly selects another source.
export type SourceId = string
export const isSourceId = (v: unknown): v is SourceId => typeof v === 'string' && (v === 'github' || !!sourceRegistry.get(v))
const [selectedSource, setSelectedSource] = createSignal<string | null>('github')

// Per-workspace memory of the last view — a rail source (browse) or a task — so switching workspaces
// returns you to exactly what you were looking at rather than always jumping back to GitHub.
// Session-only (not persisted); first-load restore is handled by the last_source/last_task prefs.
export type WorkspaceView = { source: string } | { taskId: string }
const viewByWorkspace = new Map<string, WorkspaceView>()
export const rememberWorkspaceView = (workspaceId: string, view: WorkspaceView): void => {
  viewByWorkspace.set(workspaceId, view)
}
export const workspaceView = (workspaceId: string): WorkspaceView | undefined => viewByWorkspace.get(workspaceId)
export const evictWorkspaceView = (workspaceId: string): void => {
  viewByWorkspace.delete(workspaceId)
}

// The active task (its terminals scope to this; its view shows when no Source is selected).
const [activeTaskId, setActiveTaskId] = createSignal<string | null>(null)

// Per-task pane layout (docs/panes.md): a left→right row of open panes. ALL transitions go
// through the pure reducer (applyLayoutAction) via dispatchLayout — the single-writer rule.
// Persisted to the `task_layouts` pref (App.tsx), replacing the old single-pane `task_panes`
// value (migrated on hydrate).
const [taskLayouts, setTaskLayouts] = createSignal<Record<string, TaskLayout>>({})

export const layoutForTask = (taskId: string): TaskLayout | undefined => taskLayouts()[taskId]
export const activeLayout = (): TaskLayout => taskLayouts()[activeTaskId() ?? ''] ?? defaultLayout()

export function dispatchLayout(taskId: string, action: LayoutAction): void {
  setTaskLayouts((prev) => {
    const cur = prev[taskId] ?? defaultLayout()
    const next = applyLayoutAction(cur, action)
    return next === cur ? prev : { ...prev, [taskId]: next }
  })
  const nextLayout = layoutForTask(taskId) ?? defaultLayout()
  const focused = focusedPane(taskId)
  const maximized = maximizedPane(taskId)
  // Focus/maximize are session state, but their ids must always belong to the durable layout.
  // Keep that invariant here at the layout's single write boundary so close, show, and replace
  // transitions cannot leave commands or rendering pointed at a pane that no longer exists.
  if (focused && !nextLayout.panes.includes(focused)) clearFocusedPane(taskId, focused)
  if (action.type === 'show' || (maximized && !nextLayout.panes.includes(maximized))) setMaximizedPane(taskId, null)
}
export const dispatchActiveLayout = (action: LayoutAction): void => {
  const id = activeTaskId()
  if (id) dispatchLayout(id, action)
}

// Seed from persisted prefs at startup without clobbering any layout the user changed pre-hydration.
export function hydrateTaskLayouts(map: Record<string, TaskLayout>): void {
  setTaskLayouts((p) => ({ ...map, ...p }))
}
export function hydrateTaskLayout(taskId: string, layout: TaskLayout): void {
  setTaskLayouts((current) => (current[taskId] ? current : { ...current, [taskId]: layout }))
}

// Recipe-resolved browser home URLs (docs/next 13 §C): a layout recipe points the browser pane at
// a run target's resolved URL. Session-only view state, per task.
const [recipeBrowserUrls, setRecipeBrowserUrls] = createSignal<Record<string, string>>({})
export const recipeBrowserUrl = (taskId: string): string | undefined => recipeBrowserUrls()[taskId]
export function setRecipeBrowserUrl(taskId: string, url: string): void {
  setRecipeBrowserUrls((p) => (p[taskId] === url ? p : { ...p, [taskId]: url }))
}

// The terminal drawer is per-task (session state, like activeTaskId): each task remembers whether
// its drawer is open, so switching tasks swaps it and a Source browse (no task) shows no terminal.
const [terminalOpenTasks, setTerminalOpenTasks] = createSignal<Set<string>>(new Set())
export const isTerminalOpen = (taskId: string | null | undefined): boolean => !!taskId && terminalOpenTasks().has(taskId)
export function setTerminalOpen(taskId: string, open: boolean): void {
  setTerminalOpenTasks((prev) => {
    if (open === prev.has(taskId)) return prev
    const next = new Set(prev)
    if (open) next.add(taskId)
    else next.delete(taskId)
    return next
  })
  if (!open) setTerminalMax(taskId, false) // a closed drawer is never maximized
}

// The drawer's third state (⌘⇧⏎): a maximized task drawer fills the whole pane region instead of the
// partial-height bottom slice. Session-only + per-task, mirroring open/closed above.
const [terminalMaxTasks, setTerminalMaxTasks] = createSignal<Set<string>>(new Set())
export const isTerminalMax = (taskId: string | null | undefined): boolean => !!taskId && terminalMaxTasks().has(taskId)
export function setTerminalMax(taskId: string, max: boolean): void {
  setTerminalMaxTasks((prev) => {
    if (max === prev.has(taskId)) return prev
    const next = new Set(prev)
    if (max) next.add(taskId)
    else next.delete(taskId)
    return next
  })
}

// Core-owned focused pane and session-only maximize state. Pane content never mutates these
// directly: the host's paneFocus directive marks focus on pointer/focusin, and commands read it.
const [focusedPanes, setFocusedPanes] = createSignal<Record<string, PaneId | undefined>>({})
export const focusedPane = (taskId: string | null | undefined): PaneId | undefined => (taskId ? focusedPanes()[taskId] : undefined)
export function setFocusedPane(taskId: string, pane: PaneId): void {
  setFocusedPanes((current) => (current[taskId] === pane ? current : { ...current, [taskId]: pane }))
}
function clearFocusedPane(taskId: string, pane?: PaneId): void {
  setFocusedPanes((current) => {
    if (!(taskId in current) || (pane && current[taskId] !== pane)) return current
    const next = { ...current }
    delete next[taskId]
    return next
  })
}

const [maximizedPanes, setMaximizedPanes] = createSignal<Record<string, PaneId | undefined>>({})
export const maximizedPane = (taskId: string | null | undefined): PaneId | undefined => (taskId ? maximizedPanes()[taskId] : undefined)
export function setMaximizedPane(taskId: string, pane: PaneId | null): void {
  setMaximizedPanes((current) => {
    if ((current[taskId] ?? null) === pane) return current
    const next = { ...current }
    if (pane) next[taskId] = pane
    else delete next[taskId]
    return next
  })
}
export function toggleFocusedPaneMax(taskId: string): void {
  const pane = focusedPane(taskId)
  if (!pane) return
  if (!(layoutForTask(taskId) ?? defaultLayout()).panes.includes(pane)) {
    clearFocusedPane(taskId, pane)
    setMaximizedPane(taskId, null)
    return
  }
  setMaximizedPane(taskId, maximizedPane(taskId) === pane ? null : pane)
}

// Lifecycle eviction is called by the event-bus subscriber in persistence/scopedEviction.ts.
// T3 layout removal also causes the descriptor persister to write a scoped tombstone.
export function evictTaskState(taskId: string): void {
  setTaskLayouts((current) => {
    if (!(taskId in current)) return current
    const next = { ...current }
    delete next[taskId]
    return next
  })
  setRecipeBrowserUrls((current) => {
    if (!(taskId in current)) return current
    const next = { ...current }
    delete next[taskId]
    return next
  })
  setTerminalOpenTasks((current) => {
    if (!current.has(taskId)) return current
    const next = new Set(current)
    next.delete(taskId)
    return next
  })
  setTerminalMaxTasks((current) => {
    if (!current.has(taskId)) return current
    const next = new Set(current)
    next.delete(taskId)
    return next
  })
  setFocusedPanes((current) => {
    if (!(taskId in current)) return current
    const next = { ...current }
    delete next[taskId]
    return next
  })
  setMaximizedPanes((current) => {
    if (!(taskId in current)) return current
    const next = { ...current }
    delete next[taskId]
    return next
  })
}

export { activeTaskId, setActiveTaskId, selectedSource, setSelectedSource, taskLayouts }
