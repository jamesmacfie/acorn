import { createQuery } from '@tanstack/solid-query'
import type { Task } from '../../../core/client/queries'
import { workspacesOptions } from '../../../core/client/queries'
import type { PaneContribution } from '../../../core/client/registries/panes'
import { workspaceForRepo } from '../../../core/client/workspaces/activeWorkspace'
import NotesPane from './NotesPane'

export function NotesTaskPane(props: { task: Task }) {
  const workspaces = createQuery(() => workspacesOptions(true))
  const workspace = () => workspaceForRepo(workspaces.data, props.task.repoOwner, props.task.repoName)
  return <NotesPane task={props.task} workspace={workspace()} />
}

export const notesPaneContribution: PaneContribution = {
  id: 'notes', label: 'Notes', glyph: '✐', description: 'Workspace scratchpad', order: 30,
  defaultChord: 'meta+shift+d', requires: 'desktop', component: NotesTaskPane,
}
