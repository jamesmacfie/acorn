import type { NodePlugin } from '@acorn/plugin-api/node'
import { WORKFLOW_STEP_KIND } from '@acorn/plugin-workflows/contract/extensions.ts'
import { DATABASE_QUERY } from '../contract/query'
import { databaseBridge, endDbPools } from '../server/database'
import { createDatabaseFetch } from '../server/routes/database'
import { databaseQuery, generateStep, queryStep } from '../server/workflowSteps'

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
// One capability, and it is inside this plugin's own namespace, which is the only namespace a loaded
// plugin may publish in: `database.query`, a capped read-only read (../contract/query.ts). The route
// bridge stays a closure argument to the route factory, so nothing outside this plugin can reach the
// pane's write path.
export const databasePlugin = (): NodePlugin => ({
  name: 'database',
  init: (ctx) => {
    // Opened and migrated before the listener binds. The route factory closes over the handle, so
    // there is no moment where a request can reach an unmigrated database.
    const db = ctx.storage.open()
    const bridge = databaseBridge(ctx.core, ctx.events.send)
    ctx.routes.fetch(createDatabaseFetch(db, ctx.core, bridge, ctx.events.send), { prefix: '', note: '/tasks/:taskId/*' })
    // One read path for the two workflow steps and for anything later that wants a repo's data, so
    // the row cap and the read-only refusal are written once (docs/database.md § Workflow steps).
    const query = databaseQuery(bridge)
    ctx.capabilities.provide(DATABASE_QUERY, query)
    // Contributed rather than granted, like http's step: workflows opens the point and any plugin may
    // fill it. Nothing happens on a node with workflows disabled.
    const services = { db, core: ctx.core, bridge, query }
    ctx.extensionPoints.handle(WORKFLOW_STEP_KIND, { id: 'query', value: queryStep(services) })
    ctx.extensionPoints.handle(WORKFLOW_STEP_KIND, { id: 'generate', value: generateStep(services) })
  },
  // One resource to release: the pg pools opened per task. The host closes this plugin's SQLite file
  // itself, right after this resolves and before the data root's lock drops.
  dispose: () => endDbPools(),
})
