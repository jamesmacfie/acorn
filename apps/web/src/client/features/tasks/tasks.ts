// Rail selection state (docs/workspaces). The task *list* is a TanStack query (tasksOptions); this
// module tracks what the rail has selected — a Source browse view or an active task — plus each
// task's pane layout. Signals-only, like ../terminal/sessions.ts. The terminal drawer + topbar key
// off activeTaskId.
import { createSignal } from 'solid-js'
import { applyLayoutAction, defaultLayout, type LayoutAction, type PaneId, type TaskLayout } from './layout'

export type { PaneId, TaskLayout } from './layout'

// Which browse Source is selected, or null when a task is the active view (docs/workspaces 04).
export type SourceId = 'github' | 'linear'
const [selectedSource, setSelectedSource] = createSignal<SourceId | null>('github')

// The active task (its terminals scope to this; its view shows when no Source is selected).
const [activeTaskId, setActiveTaskId] = createSignal<string | null>(null)

// Per-task pane layout (docs/next 03): 1–2 panes + ratio + pin + maximise. ALL transitions go
// through the pure reducer (applyLayoutAction) via dispatchLayout — the single-writer rule that
// keeps panes/pinned/maximised atomic. Persisted to the `task_layouts` pref (App.tsx), replacing
// the old single-pane `task_panes` value (migrated on hydrate).
const [taskLayouts, setTaskLayouts] = createSignal<Record<string, TaskLayout>>({})

export const layoutForTask = (taskId: string): TaskLayout | undefined => taskLayouts()[taskId]
export const activeLayout = (): TaskLayout => taskLayouts()[activeTaskId() ?? ''] ?? defaultLayout()

export function dispatchLayout(taskId: string, action: LayoutAction): void {
  setTaskLayouts((prev) => {
    const cur = prev[taskId] ?? defaultLayout()
    const next = applyLayoutAction(cur, action)
    return next === cur ? prev : { ...prev, [taskId]: next }
  })
}
export const dispatchActiveLayout = (action: LayoutAction): void => {
  const id = activeTaskId()
  if (id) dispatchLayout(id, action)
}

// --- Single-pane compatibility surface (ported call sites; docs/next 03 P1 = no visible change) ---
// The "active" pane is the maximised pane, else the right-most slot (the one `show` targets).
const activePane = (): PaneId => {
  const layout = activeLayout()
  return layout.maximised ?? layout.panes[layout.panes.length - 1]
}
export const paneForTask = (taskId: string): PaneId | undefined => {
  const layout = taskLayouts()[taskId]
  return layout ? layout.panes[layout.panes.length - 1] : undefined
}
export function setPaneForTask(taskId: string, pane: PaneId): void {
  dispatchLayout(taskId, { type: 'show', pane })
}
// setActivePane targets the active task (call sites set activeTaskId first).
const setActivePane = (pane: PaneId): void => {
  const id = activeTaskId()
  if (id) dispatchLayout(id, { type: 'show', pane })
}
// Seed from persisted prefs at startup without clobbering any layout the user changed pre-hydration.
export function hydrateTaskLayouts(map: Record<string, TaskLayout>): void {
  setTaskLayouts((p) => ({ ...map, ...p }))
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
}

export { activeTaskId, setActiveTaskId, selectedSource, setSelectedSource, activePane, setActivePane, taskLayouts }
