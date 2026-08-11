import type { NodePlugin } from '@acorn/plugin-api/node'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import { createHttpFetch } from '../server/routes/http'

// http ships as a loaded plugin, so BOTH host seams here are the manifest-bound ones:
//
//   ctx.storage.open()  the plugin database, with the id bound from the manifest and the DDL chain
//                       confined to the installed package. The plugin no longer chooses either — it used
//                       to pass its own id and walk its ancestors for a `migrations/` directory, which
//                       worked because the chain shipped with the app. A loaded package's chain travels
//                       inside it (build-plugin.mjs stages it), and `<dataRoot>/plugins/http.sqlite` is
//                       still the file, because the id did not change. That is the whole reason the id
//                       must never change: it IS the filename, and renaming it orphans real rows.
//
//   ctx.routes.fetch()  the portable route carrier. A Hono instance cannot cross a process boundary and
//                       a (Request) → Response function can.
export const httpPlugin = (): NodePlugin => {
  let db: PluginDatabase | null = null
  return {
    name: 'http',
    init: (ctx) => {
      db = ctx.storage.open()
      ctx.routes.fetch(createHttpFetch(db, ctx.core), { prefix: '', note: '/projects/:projectId/*' })
    },
    // One resource, this plugin's own WAL-mode SQLite file — closed before the data root's lock is
    // dropped (the composition root's teardown invariant). There is no bridge slot to clear: the handler
    // is a closure over the handle, and the plugin host drops a re-registered plugin's previous route
    // contributions itself.
    dispose: () => {
      db?.close()
      db = null
    },
  }
}
