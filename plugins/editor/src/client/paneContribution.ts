import { lazy } from 'solid-js'
import type { PaneContribution } from '@acorn/plugin-api/client'
import { prefetchEditorRoot } from './editorClient'

const EditorPane = lazy(() => import('./EditorPane'))

export const editorPaneContribution: PaneContribution = {
  id: 'editor', label: 'Editor', glyph: 'pencil', description: 'In-app code editor', order: 50,
  defaultChord: 'meta+shift+e', requires: { plugin: 'editor' }, component: EditorPane, minWidth: 320,
  // The checkout path, which is the first thing the pane awaits and the one request a remount can
  // avoid entirely. The remembered file's text is not warmed here: the agent shares the worktree, so
  // that read has to be fresh when the pane actually opens.
  prefetch: (task, queryClient) => prefetchEditorRoot(queryClient, task.id),
}
