// Rail selection state (docs/workspaces P1/P2/P4). The workspace *list* is a TanStack query
// (workspacesOptions); this module tracks what the rail has selected — a Source browse view or an
// active workspace — plus which pane that workspace is showing. Signals-only, like
// ../terminal/sessions.ts. The terminal drawer + topbar key off activeWorkspaceId.
import { createSignal } from 'solid-js'

// Which browse Source is selected, or null when a workspace is the active view (docs/workspaces 04).
export type SourceId = 'github' | 'linear'
const [selectedSource, setSelectedSource] = createSignal<SourceId | null>('github')

// The active workspace (its terminals scope to this; its view shows when no Source is selected).
const [activeWorkspaceId, setActiveWorkspaceId] = createSignal<string | null>(null)

// Which pane the active workspace shows (docs/workspaces 02). Terminal is the bottom drawer, toggled
// separately; this is the main-area pane.
export type PaneId = 'pr' | 'linear' | 'preview'
const [activePane, setActivePane] = createSignal<PaneId>('pr')

export { activeWorkspaceId, setActiveWorkspaceId, selectedSource, setSelectedSource, activePane, setActivePane }
