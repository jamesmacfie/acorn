// The editor plugin's node part (docs/vNext/plugins.md § The plugin API).
//
// No tables, so no plugin SQLite file: both surfaces are stateless views of the task's worktree on
// disk, keyed by a taskId that core resolves. The only persisted state involved is core's `tasks`,
// reached through CoreServices.
//
// TWO routers, deliberately under one plugin: the file tree/editor and find-in-files are one pane
// family (docs/panes.md) sharing the same "taskId is the capability, re-derive the root per call"
// contract. What the composition root used to do by hand: two registerRoute calls in
// apps/node/src/server/routes.ts and two setXBridge calls in apps/node/src/wiring/serverBridges.ts.
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
