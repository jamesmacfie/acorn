import Picker from './Picker'
import { resolveWorkspaceColor } from '@acorn/protocol/workspaceIdentity.ts'
import type { FleetWorkspace } from '../workspaces/fleetWorkspaces'

// The top-level workspace selector (docs/workspaces-and-tasks.md). Sits in the topbar; picking a workspace
// navigates to one of its repos (the caller derives "active" from the current repo). Reuses the
// shared Picker primitive, like RepoPicker. Rows carry the workspace identity (docs/workspaces-and-tasks.md):
// a colour dot (stored colour or name-hash default) and the emoji icon when one is set.
//
// Fleet-wide as of Phase 4: rows are (workspace, node) pairs. `grouped` decides whether the node label is
// rendered — with one node it names the only machine there is, which ui.md rules out. `active` is matched
// on the PAIR, not the workspace id: two nodes may hold the same workspace UUID by construction
// (architecture.md § Fleet semantics), so an id-only match would highlight the wrong row.
export default function WorkspacePicker(props: {
  workspaces: FleetWorkspace[]
  active: FleetWorkspace | null
  grouped: boolean
  onSelect: (entry: FleetWorkspace) => void
}) {
  const results = (query: string) => {
    const q = query.trim().toLowerCase()
    if (!q) return props.workspaces
    // The node label is part of the haystack when there is more than one node, for the same reason the ⌘L
    // palette does it: two "Default" workspaces are the normal case.
    return props.workspaces.filter((entry) =>
      `${entry.workspace.name}${props.grouped ? ` ${entry.node.label}` : ''}`.toLowerCase().includes(q))
  }
  const glyph = (entry: FleetWorkspace) => (entry.workspace.icon?.kind === 'emoji' ? `${entry.workspace.icon.value} ` : '')
  const rowLabel = (entry: FleetWorkspace) => {
    const repos = (entry.workspace.repos ?? []).length
    const node = props.grouped ? ` · ${entry.node.label}` : ''
    return `${glyph(entry)}${entry.workspace.name}${node}${repos ? ` (${repos})` : ''}`
  }
  return (
    <Picker<FleetWorkspace>
      label={props.active ? `${glyph(props.active)}${props.active.workspace.name}` : 'Select a workspace'}
      placeholder="Filter workspaces…"
      emptyText="No workspaces."
      results={results}
      rowLabel={rowLabel}
      isActive={(entry) => entry.workspace.id === props.active?.workspace.id && entry.nodeId === props.active?.nodeId}
      onSelect={props.onSelect}
      leading={(entry) => <span class="ws-color-dot" style={{ background: resolveWorkspaceColor(entry.workspace.color, entry.workspace.name) }} />}
    />
  )
}
