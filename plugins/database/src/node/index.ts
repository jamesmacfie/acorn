import { type NodePlugin, openPluginDb } from '@acorn/plugin-api/node'
import { migrationsDir } from './migrations'
import { databaseBridge, endDbPools } from '../main/database'
import { databaseRoutes, DATABASE } from '../server/routes/database'

export const databasePlugin = (dataDir: string): NodePlugin => {
  let db: ReturnType<typeof openPluginDb> | null = null
  let capability: { dispose(): void } | null = null
  return {
    name: 'database',
    init: async (ctx) => {
      // Opened and migrated before the listener binds — the route factory closes over the handle, so
      // there is no moment where a request can reach an unmigrated database.
      db = openPluginDb(dataDir, 'database', { migrationsFolder: migrationsDir() })
      capability = ctx.capabilities.provide(DATABASE, databaseBridge(ctx.core))
      ctx.routes.register(databaseRoutes(db, ctx.core), { prefix: '/tasks', note: '/:id/database/*' })
    },
    // Two resources, both this plugin's: the pg pools it opened per task, and its own WAL-mode SQLite
    // file — which has to be closed before the data root's lock is dropped (the composition root's
    // teardown invariant).
    dispose: async () => {
      await endDbPools()
      db?.close()
      db = null
      capability?.dispose()
    },
  }
}
