// The editor plugin's client part (docs/plugins.md § The plugin API).
//
// One pane: find-in-files is a panel in its sidebar rather than a pane of its own
// (docs/panes.md § Contributions).
import { lazy } from 'solid-js'
import { activeTaskId, openPane, type ClientPlugin } from '@acorn/plugin-api/client'
import { editorOpenFilesSlice } from './openFilesSlice'
import { editorPaneContribution } from './paneContribution'

const FilePalette = lazy(() => import('./FilePalette'))

export const editorClientPlugin: ClientPlugin = {
  name: 'editor',
  init: (ctx) => {
    ctx.panes.register(editorPaneContribution)
    // ⌘P: an overlay slot, not a pane (docs/plugins.md § Frame authoring and the UI kit), so it
    // opens over whatever is on screen and closes on pick. Its own keybinding registers when it
    // mounts.
    ctx.slots.register({
      id: 'palette.files', slot: 'overlay', order: 20, requires: 'desktop', component: FilePalette,
    })
    // The entry point that had to survive the fold, so searching does not start with "open the
    // editor first" (docs/panes.md § Contributions).
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
