import type { NodePlugin } from '@acorn/plugin-api/node'
import { editorBridge } from '../server/editor'
import { registerEditorWsChannel } from '../server/wsChannel'
import { searchBridge } from '../server/search'
import { editor, EDITOR } from '../server/routes/editor'
import { search, SEARCH } from '../server/routes/search'

export const editorPlugin = (): NodePlugin => {
  let routeDisposables: { dispose(): void }[] = []
  return {
    name: 'editor',
    init: (ctx) => {
      // The one decision this plugin opens to other plugins (docs/plugins.md § Hooks): a formatter's
      // turn at the text on its way to disk. A veto is allowed too, so a lint-on-save can refuse.
      ctx.hooks.declare({
        id: 'before-save',
        label: 'save a file',
        payload: { taskId: 'string', path: 'string', text: 'string' },
        allows: ['observe', 'transform', 'veto'],
        // A save is on the typing path. Two seconds is the archive dialog's budget, and this has less
        // patience than a dialog does.
        timeoutMs: 2_000,
      })
      routeDisposables = [
        ctx.capabilities.provide(EDITOR, editorBridge(ctx.core, ctx.events.status, ctx.hooks)),
        ctx.capabilities.provide(SEARCH, searchBridge(ctx.core)),
      ]
      // `$EDITOR` in a throwaway PTY, for a reader who edits in terminal mode. It rides the one
      // authenticated WebSocket, so it is part of this plugin's surface: drop it and the routes keep
      // working while terminal mode opens onto a box that never fills.
      registerEditorWsChannel(ctx.events, ctx.core)
      ctx.routes.register(search, { prefix: '/tasks', note: '/:id/search' })
      ctx.routes.register(editor, { prefix: '/tasks', note: '/:id/editor/*' })
    },
    dispose: () => {
      for (const disposable of routeDisposables) disposable.dispose()
      routeDisposables = []
    },
  }
}
