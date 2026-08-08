import type { NodePlugin } from '@acorn/node-core/server/plugin/types.ts'
import { openPluginDb } from '@acorn/node-core/main/pluginStorage.ts'
import { httpRoutes } from '../server/routes/http'
import { migrationsDir } from './migrations'

export const httpPlugin = (dataDir: string): NodePlugin => {
  let db: ReturnType<typeof openPluginDb> | null = null
  return {
    name: 'http',
    init: async (ctx) => {
      db = openPluginDb(dataDir, 'http', { migrationsFolder: migrationsDir() })
      ctx.routes.register(httpRoutes(db, ctx.core), { prefix: '', note: '/projects/:projectId/*' })
    },
    // One resource, this plugin's own WAL-mode SQLite file — closed before the data root's lock is
    // dropped (the composition root's teardown invariant). There is no bridge slot to clear: the router
    // is a factory closed over the handle, and the plugin host drops a re-registered plugin's previous
    // route contributions itself.
    dispose: () => {
      db?.close()
      db = null
    },
  }
}
