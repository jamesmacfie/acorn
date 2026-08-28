import type { NodePlugin } from '@acorn/plugin-api/node'
import { databaseBridge, endDbPools } from '../main/database'
import { createDatabaseFetch } from '../server/routes/database'

// database ships as a loaded plugin, so both host seams here are the manifest-bound ones:
//
//   ctx.storage.open()  the plugin database, with the id bound from the manifest and the DDL chain
//                       confined to the installed package. `<dataRoot>/plugins/database.sqlite` is
//                       still the file, since the id did not change; renaming it would orphan every
//                       saved query on the machine.
//
//   ctx.routes.fetch()  the portable route carrier. A Hono instance cannot cross a process boundary and
//                       a (Request) → Response function can.
//
// No route capability. The bridge is a closure argument to the route factory, so nothing outside this
// plugin can reach it.
export const databasePlugin = (): NodePlugin => ({
  name: 'database',
  init: (ctx) => {
    // Opened and migrated before the listener binds. The route factory closes over the handle, so
    // there is no moment where a request can reach an unmigrated database.
    const db = ctx.storage.open()
    ctx.routes.fetch(createDatabaseFetch(db, ctx.core, databaseBridge(ctx.core, ctx.events.send), ctx.events.send), { prefix: '', note: '/tasks/:taskId/*' })
  },
  // One resource to release: the pg pools opened per task. The host closes this plugin's SQLite file
  // itself, right after this resolves and before the data root's lock drops.
  dispose: () => endDbPools(),
})
