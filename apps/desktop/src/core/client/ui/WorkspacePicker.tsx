import Picker from './Picker'
import type { Workspace } from '../queries'
import { resolveWorkspaceColor } from '../../shared/workspaceIdentity'

// The top-level workspace selector (docs/workspaces-and-tasks.md). Sits in the topbar; picking a workspace
// navigates to one of its repos (the caller derives "active" from the current repo). Reuses the
// shared Picker primitive, like RepoPicker. Rows carry the workspace identity (docs/workspaces-and-tasks.md):
// a colour dot (stored colour or name-hash default) and the emoji icon when one is set.
export default function WorkspacePicker(props: {
  workspaces: Workspace[]
  active: Workspace | null
  onSelect: (w: Workspace) => void
}) {
  const results = (query: string) => {
    const q = query.trim().toLowerCase()
    return q ? props.workspaces.filter((w) => w.name.toLowerCase().includes(q)) : props.workspaces
  }
  const glyph = (w: Workspace) => (w.icon?.kind === 'emoji' ? `${w.icon.value} ` : '')
  return (
    <Picker<Workspace>
      label={props.active ? `${glyph(props.active)}${props.active.name}` : 'Select a workspace'}
      placeholder="Filter workspaces…"
      emptyText="No workspaces."
      results={results}
      rowLabel={(w) => `${glyph(w)}${w.name}${(w.repos ?? []).length ? ` (${w.repos.length})` : ''}`}
      isActive={(w) => w.id === props.active?.id}
      onSelect={props.onSelect}
      leading={(w) => <span class="ws-color-dot" style={{ background: resolveWorkspaceColor(w.color, w.name) }} />}
    />
  )
}
