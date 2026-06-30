import Picker from './Picker'
import type { Workspace } from './queries'

// The top-level workspace selector (docs/workspaces). Sits in the topbar; picking a workspace
// navigates to one of its repos (the caller derives "active" from the current repo). Reuses the
// shared Picker primitive, like RepoPicker.
export default function WorkspacePicker(props: {
  workspaces: Workspace[]
  active: Workspace | null
  onSelect: (w: Workspace) => void
}) {
  const results = (query: string) => {
    const q = query.trim().toLowerCase()
    return q ? props.workspaces.filter((w) => w.name.toLowerCase().includes(q)) : props.workspaces
  }
  return (
    <Picker<Workspace>
      label={props.active?.name ?? 'Select a workspace'}
      placeholder="Filter workspaces…"
      emptyText="No workspaces."
      results={results}
      rowLabel={(w) => `${w.name}${(w.repos ?? []).length ? ` (${w.repos.length})` : ''}`}
      isActive={(w) => w.id === props.active?.id}
      onSelect={props.onSelect}
    />
  )
}
