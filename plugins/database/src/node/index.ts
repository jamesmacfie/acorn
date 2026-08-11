import type { NodePlugin, PluginDatabase } from '@acorn/plugin-api/node'
import { databaseBridge, endDbPools } from '../main/database'
import { createDatabaseFetch } from '../server/routes/database'

// database ships as a loaded plugin, so BOTH host seams here are the manifest-bound ones:
//
//   ctx.storage.open()  the plugin database, with the id bound from the manifest and the DDL chain
//                       confined to the installed package. `<dataRoot>/plugins/database.sqlite` is still
//                       the file, because the id did not change — which is the whole reason the id must
//                       never change: it IS the filename, and renaming it orphans every saved query on
//                       the machine.
//
//   ctx.routes.fetch()  the portable route carrier. A Hono instance cannot cross a process boundary and
//                       a (Request) → Response function can.
//
// What is NOT here any more: `ctx.capabilities.provide(DATABASE, …)`. The route capability existed to
// cross the old main/renderer boundary; the bridge is now a closure argument to the route factory
// (server/routes/database.ts says why at length). Nothing outside this plugin ever consumed it.
export const databasePlugin = (): NodePlugin => {
  let db: PluginDatabase | null = null
  return {
    name: 'database',
    init: (ctx) => {
      // Opened and migrated before the listener binds — the route factory closes over the handle, so
      // there is no moment where a request can reach an unmigrated database.
      db = ctx.storage.open()
      ctx.routes.fetch(createDatabaseFetch(db, ctx.core, databaseBridge(ctx.core)), { prefix: '', note: '/tasks/:taskId/*' })
    },
    // Two resources, both this plugin's: the pg pools it opened per task, and its own WAL-mode SQLite
    // file — which has to be closed before the data root's lock is dropped (the composition root's
    // teardown invariant).
    dispose: async () => {
      await endDbPools()
      db?.close()
      db = null
    },
  }
}
