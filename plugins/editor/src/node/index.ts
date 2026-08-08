import type { NodePlugin } from '@acorn/node-core/server/plugin/types.ts'
import { editorBridge } from '../main/editor'
import { searchBridge } from '../main/search'
import { editor, EDITOR } from '../server/routes/editor'
import { search, SEARCH } from '../server/routes/search'

export const editorPlugin = (): NodePlugin => {
  let routeDisposables: { dispose(): void }[] = []
  return {
    name: 'editor',
    init: (ctx) => {
      routeDisposables = [
        ctx.capabilities.provide(EDITOR, editorBridge(ctx.core)),
        ctx.capabilities.provide(SEARCH, searchBridge(ctx.core)),
      ]
      ctx.routes.register(search, { prefix: '/tasks', note: '/:id/search' })
      ctx.routes.register(editor, { prefix: '/tasks', note: '/:id/editor/*' })
    },
    dispose: () => {
      for (const disposable of routeDisposables) disposable.dispose()
      routeDisposables = []
    },
  }
}
