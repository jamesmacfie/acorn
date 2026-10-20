import type { NodePlugin } from '@acorn/plugin-api/node'
import { linearProvider } from '../server/provider'
import { createLinearFetch } from '../server/routes/linear'
import { issueSource, issueSourceDescription } from '../shared/issueSource'
import { cycleSource, cycleSourceDescription } from '../shared/cycleSource'
import { projectSource, projectSourceDescription } from '../shared/projectSource'
import { createLinearSourceHandler } from '../server/data/sourceHandler'
import { readIssueOptions, readIssues } from '../server/data/issueRead'
import { readCycleOptions, readCycles } from '../server/data/cycleRead'
import { readProjects } from '../server/data/projectRead'
import { setLinearApiTelemetry } from '../server/index'

export const linearPlugin = (): NodePlugin => ({
  name: 'linear',
  // The routes own this provider's whole namespace, so the mount is /v1/p/linear with no prefix. The
  // segment comes from the declared provider id, never from a prefix string. It stays behind
  // `requireProviderAccess` in the projection: a task-scoped internal token may not spend the owner's
  // Linear credential.
  //
  // Always the portable fetch carrier (docs/plugins/loaded-plugins.md § Loaded plugins): linear ships loaded, and a
  // bundled Hono instance cannot cross the contract.
  init: (ctx) => {
    setLinearApiTelemetry(ctx.telemetry)
    ctx.routes.fetch(createLinearSourceHandler(issueSourceDescription, readIssues, readIssueOptions), {
      prefix: '/data/issues',
    })
    ctx.routes.fetch(createLinearSourceHandler(cycleSourceDescription, readCycles, readCycleOptions), {
      prefix: '/data/cycles',
    })
    ctx.routes.fetch(createLinearSourceHandler(projectSourceDescription, readProjects), { prefix: '/data/projects' })
    ctx.dataSources.register(issueSource)
    ctx.dataSources.register(cycleSource)
    ctx.dataSources.register(projectSource)
    ctx.providers.integration(
      linearProvider,
      createLinearFetch(ctx.core.projects, ctx.events.send, ctx.core.codeHostLabel),
    )
  },
})
