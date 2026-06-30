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

export { activeTaskId, setActiveTaskId, selectedSource, setSelectedSource, activePane, setActivePane }
