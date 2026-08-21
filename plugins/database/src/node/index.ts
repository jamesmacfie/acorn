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
// `ctx.capabilities.provide(DATABASE, …)` is gone. The route capability existed to cross the old
// main/renderer boundary; the bridge is now a closure argument to the route factory
// (server/routes/database.ts explains why). Nothing outside this plugin ever consumed it.
export const databasePlugin = (): NodePlugin => ({
  name: 'database',
  init: (ctx) => {
    // Opened and migrated before the listener binds. The route factory closes over the handle, so
    // there is no moment where a request can reach an unmigrated database.
    const db = ctx.storage.open()
    ctx.routes.fetch(createDatabaseFetch(db, ctx.core, databaseBridge(ctx.core)), { prefix: '', note: '/tasks/:taskId/*' })
  },
  // One resource left to release: the pg pools it opened per task. Its own WAL-mode SQLite file is the
  // host's to close, and it does so right after this resolves, still before the data root's lock drops.
  dispose: () => endDbPools(),
})
