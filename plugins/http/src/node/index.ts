import type { NodePlugin } from '@acorn/node-core/server/plugin/types.ts'
import { openPluginDb } from '@acorn/node-core/main/pluginStorage.ts'
import { httpRoutes } from '../server/routes/http'
import { protectLegacyHttpStorage } from '../server/storage'
import { migrationsDir } from './migrations'
import { backfillLegacyHttpData } from './legacyPairs'

export const httpPlugin = (dataDir: string): NodePlugin => {
  let db: ReturnType<typeof openPluginDb> | null = null
  return {
    name: 'http',
    init: async (ctx) => {
      db = openPluginDb(dataDir, 'http', { migrationsFolder: migrationsDir() })
      await backfillLegacyHttpData(db, ctx.core.projects)
      // AWAITED, and that matters: rows written by releases that stored drafts in plaintext are
      // encrypted here, and a request served before this finishes would read half-migrated rows and hand
      // the plaintext back as if it were ciphertext. NodePlugin.init is awaited before the listener binds
      // for exactly this case (server/plugin/types.ts).
      //
      // A failure is deliberately NOT caught: a secret variable that will not decrypt means the node's
      // encryption key changed, and continuing would silently re-seal garbage.
      await protectLegacyHttpStorage(db, ctx.core.secrets, ctx.core.identity)
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
