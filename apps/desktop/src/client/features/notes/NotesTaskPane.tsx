import { createQuery } from '@tanstack/solid-query'
import type { Task } from '../../queries'
import { workspacesOptions } from '../../queries'
import type { PaneContribution } from '../../registries/panes'
import { workspaceForRepo } from '../workspaces/activeWorkspace'
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
