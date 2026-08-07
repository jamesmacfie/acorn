import type { NodePlugin } from '@acorn/node-core/server/plugin/types.ts'
import { openPluginDb } from '@acorn/node-core/main/pluginStorage.ts'
import { httpRoutes } from '../server/routes/http'
import { protectLegacyHttpStorage } from '../server/storage'
import { migrationsDir } from './migrations'

export const httpPlugin = (dataDir: string): NodePlugin => {
  let db: ReturnType<typeof openPluginDb> | null = null
  return {
    name: 'http',
    init: async (ctx) => {
      db = openPluginDb(dataDir, 'http', { migrationsFolder: migrationsDir() })
      // AWAITED, and that matters: rows written by releases that stored drafts in plaintext are
      // encrypted here, and a request served before this finishes would read half-migrated rows and hand
      // the plaintext back as if it were ciphertext. NodePlugin.init is awaited before the listener binds
      // for exactly this case (server/plugin/types.ts).
      //
      // A failure is deliberately NOT caught: a secret variable that will not decrypt means the node's
      // encryption key changed, and continuing would silently re-seal garbage.
      ctx.routes.register(httpRoutes(db, ctx.core), { prefix: '', note: '/:owner/:repo/*' })
    },
    // In `ready`, not `init`, and that is the whole point: the claim asks core's identity service whether
    // this node knows exactly ONE owner, and that answer is only correct once github has filled core's
    // mirror slot from its own init. In `init` it worked by alphabetical luck — github sorts before http
    // in the plugin list — and reordering that list by domain would have silently stopped claiming the
    // owner's saved API requests. Fail-closed, so never a wrong write, but invisible data.
    //
    // Still before the listener binds (server/plugin/host.ts runs this pass first), which is the guarantee
    // the listener binds.
    ready: async (ctx) => {
      if (!db) return
      await protectLegacyHttpStorage(db, ctx.core.secrets, ctx.core.identity)
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
