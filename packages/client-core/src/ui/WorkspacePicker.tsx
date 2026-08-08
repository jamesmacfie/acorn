import Picker from './Picker'
import { resolveWorkspaceColor } from '@acorn/protocol/workspaceIdentity.ts'
import type { FleetWorkspace } from '../workspaces/fleetWorkspaces'

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
    const projects = entry.workspace.projects.length
    const node = props.grouped ? ` · ${entry.node.label}` : ''
    return `${glyph(entry)}${entry.workspace.name}${node}${projects ? ` (${projects})` : ''}`
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
