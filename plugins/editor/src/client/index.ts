// The editor plugin's client part (docs/plugins.md § The plugin API).
//
// Two panes, not one: the file editor and find-in-files are separate panes with separate chords, but
// one plugin — they share the ripgrep/read-file routes and the Monaco setup.
import { lazy } from 'solid-js'
import type { ClientPlugin } from '@acorn/client-core/registries/plugin.ts'
import { editorOpenFilesSlice } from './openFilesSlice'
import { editorPaneContribution } from './paneContribution'
import { searchPaneContribution } from './search/paneContribution'

const FilePalette = lazy(() => import('./FilePalette'))

export const editorClientPlugin: ClientPlugin = {
  name: 'editor',
  init: (ctx) => {
    ctx.panes.register(editorPaneContribution)
    ctx.panes.register(searchPaneContribution)
    // ⌘P. An overlay slot rather than a pane: it opens over whatever is on screen and closes on pick.
    // The palette's own keybinding is registered when it mounts, which is where it belongs.
    ctx.slots.register({
      id: 'palette.files', slot: 'overlay', order: 20, requires: 'desktop', component: FilePalette,
    })
    ctx.persistedState.register(editorOpenFilesSlice)
  },
}
