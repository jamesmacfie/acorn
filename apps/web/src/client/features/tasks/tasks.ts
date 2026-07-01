// Rail selection state (docs/workspaces). The task *list* is a TanStack query (tasksOptions); this
// module tracks what the rail has selected — a Source browse view or an active task — plus which
// pane that task is showing. Signals-only, like ../terminal/sessions.ts. The terminal drawer +
// topbar key off activeTaskId.
import { createSignal } from 'solid-js'

// Which browse Source is selected, or null when a task is the active view (docs/workspaces 04).
export type SourceId = 'github' | 'linear'
const [selectedSource, setSelectedSource] = createSignal<SourceId | null>('github')

// The active task (its terminals scope to this; its view shows when no Source is selected).
const [activeTaskId, setActiveTaskId] = createSignal<string | null>(null)

// Which pane each task shows (docs/workspaces 02). Terminal is the bottom drawer, toggled
// separately; this is the main-area pane. Per-task (like terminalOpenTasks) so switching tasks
// restores the pane you left on; persisted to prefs (App.tsx) so it also survives a relaunch.
export type PaneId = 'pr' | 'linear' | 'preview' | 'editor'
const [taskPanes, setTaskPanes] = createSignal<Record<string, PaneId>>({})
const activePane = (): PaneId => taskPanes()[activeTaskId() ?? ''] ?? 'pr'
export const paneForTask = (taskId: string): PaneId | undefined => taskPanes()[taskId]
export function setPaneForTask(taskId: string, pane: PaneId): void {
  setTaskPanes((p) => (p[taskId] === pane ? p : { ...p, [taskId]: pane }))
}
// setActivePane targets the active task (call sites set activeTaskId first).
const setActivePane = (pane: PaneId): void => {
  const id = activeTaskId()
  if (id) setPaneForTask(id, pane)
}
// Seed from persisted prefs at startup without clobbering any pane the user changed pre-hydration.
export function hydrateTaskPanes(map: Record<string, PaneId>): void {
  setTaskPanes((p) => ({ ...map, ...p }))
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

export { activeTaskId, setActiveTaskId, selectedSource, setSelectedSource, activePane, setActivePane, taskPanes }
