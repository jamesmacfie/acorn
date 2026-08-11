// The editor plugin's client part (docs/plugins.md § The plugin API).
//
// ONE pane. Find-in-files used to be a second one; it is now a panel in the editor pane's sidebar
// (docs/panes.md), because a result click already opened a file in this pane and that made it a
// cross-pane hop for a selection inside one mental model. The ripgrep route underneath is unchanged —
// Monaco has no filesystem and no process access, so project-wide search is a subprocess either way.
import { lazy } from 'solid-js'
import { activeTaskId, openPane, type ClientPlugin } from '@acorn/plugin-api/client'
import { editorOpenFilesSlice } from './openFilesSlice'
import { editorPaneContribution } from './paneContribution'

const FilePalette = lazy(() => import('./FilePalette'))

export const editorClientPlugin: ClientPlugin = {
  name: 'editor',
  init: (ctx) => {
    ctx.panes.register(editorPaneContribution)
    // ⌘P. An overlay slot rather than a pane: it opens over whatever is on screen and closes on pick.
    // The palette's own keybinding is registered when it mounts, which is where it belongs.
    ctx.slots.register({
      id: 'palette.files', slot: 'overlay', order: 20, requires: 'desktop', component: FilePalette,
    })
    // The entry point that survived the fold. Searching used to mean opening the search pane, and after
    // the fold it would have meant opening the editor first — so the chord and the palette row open the
    // editor pane with its search panel focused, which is the same one gesture it always was.
    ctx.commands.register({
      id: 'editor.search.open',
      title: 'Find in files…',
      category: 'navigation',
      palette: true,
      requires: 'desktop',
      when: () => !!activeTaskId(),
      run: () => {
        const taskId = activeTaskId()
        if (taskId) openPane(taskId, 'editor', { kind: 'editor:search' }, 'add')
      },
    })
    ctx.keybindings.register({
      id: 'editor.search.open',
      command: 'editor.search.open',
      description: 'Find in files',
      category: 'Panes',
      defaultChord: 'meta+shift+f',
      when: 'task',
    })
    ctx.persistedState.register(editorOpenFilesSlice)
  },
}
