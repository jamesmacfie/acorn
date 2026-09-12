import type { NodePlugin } from '@acorn/plugin-api/node'
import { WORKFLOW_STEP_KIND } from '@acorn/plugin-workflows/contract/extensions.ts'
import { createHttpFetch } from '../server/routes/http'
import { describeHttpStep, httpStepHandler, validateHttpStep } from '../server/workflowStep'

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
    ctx.routes.fetch(createHttpFetch(db, ctx.core, ctx.events.send), { prefix: '', note: '/projects/:projectId/*' })
    // The `http:request` workflow step (./workflowStep.ts). Contributed rather than granted: workflows
    // opens the point and any plugin may fill it, so this needs no special case in that package.
    //
    // Nothing happens on a node with workflows disabled — the point is never opened, so the entry is
    // never read — and nothing here throws if workflows inits after this plugin does.
    ctx.extensionPoints.handle(WORKFLOW_STEP_KIND, {
      id: 'request',
      value: { handler: httpStepHandler(db, ctx.core, ctx.audit.record), validate: validateHttpStep, describe: describeHttpStep },
    })
  },
})
