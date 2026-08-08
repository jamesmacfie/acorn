import { lazy } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { type PaneContribution, type Task, workspaceForProject, workspacesOptions } from '@acorn/plugin-api/client'

const NotesPane = lazy(() => import('./NotesPane'))

export function NotesTaskPane(props: { task: Task }) {
  const workspaces = createQuery(() => workspacesOptions(true))
  const workspace = () => workspaceForProject(workspaces.data, props.task.projectId)
  return <NotesPane task={props.task} workspace={workspace()} />
}

export const notesPaneContribution: PaneContribution = {
  id: 'notes', label: 'Notes', glyph: 'notepad-text', description: 'Workspace scratchpad', order: 30,
  defaultChord: 'meta+shift+d', requires: 'desktop', component: NotesTaskPane,
}
