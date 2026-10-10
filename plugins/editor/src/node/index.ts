import type { NodePlugin } from '@acorn/plugin-api/node'
import { lazyEditorBridge } from '../server/lazyEditorBridge'
import { registerEditorWsChannel } from '../server/wsChannel'
import { lazySearchBridge } from '../server/lazySearchBridge'
import { editor, EDITOR } from '../server/routes/editor'
import { search, SEARCH } from '../server/routes/search'
import { EDITOR_LINE_MARKERS } from '../contract/lineMarkers'
import { EDITOR_FILE_STATUS } from '../contract/fileStatus'
import { EDITOR_FILES } from '../contract/files'

export const editorPlugin = (): NodePlugin => {
  let routeDisposables: { dispose(): void }[] = []
  return {
    name: 'editor',
    label: 'Editor',
    init: (ctx) => {
      ctx.extensionPoints.declare(EDITOR_LINE_MARKERS, 'Editor line markers')
      ctx.extensionPoints.declare(EDITOR_FILE_STATUS, 'Editor file status')
      // The one decision this plugin opens to other plugins (docs/plugins/hooks.md § Hooks): a formatter's
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
        ctx.capabilities.provide(EDITOR, lazyEditorBridge(
          ctx.core,
          ctx.events.worktreeStatus,
          ctx.hooks,
          () => ctx.extensionPoints.handlers(EDITOR_LINE_MARKERS).map((entry) => entry.value),
          () => ctx.extensionPoints.handlers(EDITOR_FILE_STATUS).map((entry) => entry.value),
        )),
        ctx.capabilities.provide(SEARCH, lazySearchBridge(ctx.core)),
        // Read-only bytes for a plugin that draws a file in the editor (../contract/files.ts). Loaded on
        // first use, like the route bridge above.
        ctx.capabilities.provide(EDITOR_FILES, {
          read: async (input) => (await import('../server/editor')).editorFiles(ctx.core).read(input),
        }),
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
