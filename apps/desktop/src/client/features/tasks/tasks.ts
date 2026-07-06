// Rail selection state (docs/workspaces). The task *list* is a TanStack query (tasksOptions); this
// module tracks what the rail has selected — a Source browse view or an active task — plus each
// task's pane layout. Signals-only, like ../terminal/sessions.ts. The terminal drawer + topbar key
// off activeTaskId.
import { createSignal } from 'solid-js'
import { applyLayoutAction, defaultLayout, type LayoutAction, type TaskLayout } from './layout'

export type { PaneId, TaskLayout } from './layout'

// Which browse Source is selected, or null when a task is the active view (docs/workspaces 04).
// The id list is the one source of truth — isSourceId validates persisted values (last_source)
// against it so a new source can't be forgotten in the restore path.
export const SOURCE_IDS = ['github', 'linear', 'rollbar'] as const
export type SourceId = (typeof SOURCE_IDS)[number]
export const isSourceId = (v: unknown): v is SourceId => typeof v === 'string' && (SOURCE_IDS as readonly string[]).includes(v)
const [selectedSource, setSelectedSource] = createSignal<SourceId | null>('github')

// Per-workspace memory of the last view — a rail source (browse) or a task — so switching workspaces
// returns you to exactly what you were looking at rather than always jumping back to GitHub.
// Session-only (not persisted); first-load restore is handled by the last_source/last_task prefs.
export type WorkspaceView = { source: SourceId } | { taskId: string }
const viewByWorkspace = new Map<string, WorkspaceView>()
export const rememberWorkspaceView = (workspaceId: string, view: WorkspaceView): void => {
  viewByWorkspace.set(workspaceId, view)
}
export const workspaceView = (workspaceId: string): WorkspaceView | undefined => viewByWorkspace.get(workspaceId)

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
}
export const dispatchActiveLayout = (action: LayoutAction): void => {
  const id = activeTaskId()
  if (id) dispatchLayout(id, action)
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

export { activeTaskId, setActiveTaskId, selectedSource, setSelectedSource, taskLayouts }
