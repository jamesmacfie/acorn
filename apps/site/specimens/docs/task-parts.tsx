import { KIT_NODE_COMPONENTS } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'What a task owns',
  caption: 'A task, and what it owns. Archiving it stops its agents and terminals and removes its worktree.',
  terminal: { columns: 60, rows: 4 },
  width: 680,
}

// Graph has no named SDK export, so this reaches it by name, as the kit's graph specimen does. Two
// ranks, placed by hand, because jsdom measures nothing and Graph can't fit a taller view to its canvas.
const { Graph } = KIT_NODE_COMPONENTS

const parts = [
  { id: 'worktree', label: 'Branch and worktree', detail: 'Its own copy of the files' },
  { id: 'agents', label: 'Agents and terminals', detail: 'Running in the worktree' },
  { id: 'panes', label: 'Panes', detail: 'Changes, Notes, Editor…' },
]

export default function TaskParts() {
  return (
    <Graph
      id="task-parts"
      ariaLabel="What a task owns"
      nodes={[
        { id: 'task', label: 'Task', detail: 'One piece of work on one project', tone: 'accent' as const },
        ...parts,
      ]}
      edges={parts.map(({ id }) => ({ from: 'task', to: id }))}
      positions={{
        task: { x: 210, y: 0 },
        ...Object.fromEntries(parts.map(({ id }, lane) => [id, { x: lane * 210, y: 130 }])),
      }}
    />
  )
}
