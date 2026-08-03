// The database plugin's node part (docs/vNext/plugins.md § The plugin API).
//
// What the composition root used to do by hand: apps/node/src/server/routes.ts registered the router,
// apps/node/src/wiring/serverBridges.ts connected it to its pg implementation, core owned the
// `db_saved_queries` table, and apps/node/src/service/runtime.ts remembered to call endDbPools() during
// teardown. All four are here now, and the plugin owns its own SQLite file.
import type { NodePlugin } from '@acorn/node-core/server/plugin/types.ts'
import { openPluginDb } from '@acorn/node-core/main/pluginStorage.ts'
import { migrationsDir } from './migrations'
import { databaseBridge, endDbPools } from '../main/database'
import { databaseRoutes, setDatabaseBridge } from '../server/routes/database'

export const databasePlugin = (dataDir: string): NodePlugin => {
  let db: ReturnType<typeof openPluginDb> | null = null
  return {
    name: 'database',
    init: (ctx) => {
      // Opened and migrated before the listener binds — the route factory closes over the handle, so
      // there is no moment where a request can reach an unmigrated database.
      db = openPluginDb(dataDir, 'database', { migrationsFolder: migrationsDir() })
      setDatabaseBridge(databaseBridge(ctx.core))
      ctx.routes.register(databaseRoutes(db, ctx.core), { prefix: '/tasks', note: '/:id/database/*' })
    },
    // Two resources, both this plugin's: the pg pools it opened per task, and its own WAL-mode SQLite
    // file — which has to be closed before the data root's lock is dropped (the composition root's
    // teardown invariant).
    dispose: async () => {
      await endDbPools()
      db?.close()
      db = null
      setDatabaseBridge(null)
    },
  }
}
