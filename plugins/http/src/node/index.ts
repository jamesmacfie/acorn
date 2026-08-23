import type { NodePlugin } from '@acorn/plugin-api/node'
import { createHttpFetch } from '../server/routes/http'

// http ships as a loaded plugin, so both host seams here are the manifest-bound ones
// (docs/data-layer.md § Plugin databases; docs/http-client.md):
//
//   ctx.storage.open()  the plugin database, with the id bound from the manifest and the DDL chain
//                       confined to the installed package. The id must never change: it is the
//                       filename, and renaming it orphans real rows.
//
//   ctx.routes.fetch()  the portable route carrier. A Hono instance cannot cross a process boundary
//                       and a (Request) -> Response function can.
//
// No dispose. The host closes what it opened through `ctx.storage`, and drops a re-registered
// plugin's previous route contributions itself.
export const httpPlugin = (): NodePlugin => ({
  name: 'http',
  init: (ctx) => {
    const db = ctx.storage.open()
    ctx.routes.fetch(createHttpFetch(db, ctx.core), { prefix: '', note: '/projects/:projectId/*' })
  },
})
