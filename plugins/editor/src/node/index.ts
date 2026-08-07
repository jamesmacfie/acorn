import type { NodePlugin } from '@acorn/node-core/server/plugin/types.ts'
import { editorBridge } from '../main/editor'
import { searchBridge } from '../main/search'
import { editor, setEditorBridge } from '../server/routes/editor'
import { search, setSearchBridge } from '../server/routes/search'

export const editorPlugin = (): NodePlugin => ({
  name: 'editor',
  init: (ctx) => {
    setEditorBridge(editorBridge(ctx.core))
    setSearchBridge(searchBridge(ctx.core))
    ctx.routes.register(search, { prefix: '/tasks', note: '/:id/search' })
    ctx.routes.register(editor, { prefix: '/tasks', note: '/:id/editor/*' })
  },
  // Nothing long-lived to release — ripgrep runs per request and every read is stateless — but the
  // slots are cleared so a second boot in one process cannot serve through the previous boot's
  // closures (the plugin host re-registers routes for exactly this reason).
  dispose: () => {
    setEditorBridge(null)
    setSearchBridge(null)
  },
})
