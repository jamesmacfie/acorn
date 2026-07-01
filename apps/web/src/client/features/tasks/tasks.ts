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

// Which pane the active task shows (docs/workspaces 02). Terminal is the bottom drawer, toggled
// separately; this is the main-area pane.
export type PaneId = 'pr' | 'linear' | 'preview'
const [activePane, setActivePane] = createSignal<PaneId>('pr')

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

export { activeTaskId, setActiveTaskId, selectedSource, setSelectedSource, activePane, setActivePane }
