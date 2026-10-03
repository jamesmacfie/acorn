import { Hono } from 'hono'
import { dashboardLibraryRequestSchema } from '@acorn/protocol/dashboards.ts'
import { getDb } from '../db'
import type { AppEnv } from '../middleware/auth'
import { readSeries, type MeasureSeries } from '../dashboards/history'
import { respondError } from '../respond'
import { authorizeQueryScope } from '../queries/runtime'
import { dashboardStore, DashboardLibraryError } from '../dashboards/store'
import { dashboardContentProblems, deleteDashboard, publishDashboard } from '../dashboards/publication'
import { runDashboard } from '../dashboards/run'
import { describeDashboardProblem } from '@acorn/dashboards-core/projection'

// The measure-history read route (docs/dashboards.md § Trends).
//
// One route, GET only. There is no write route: the sampler and the store share a process, so the
// only writer is `core:sample-measures`. An earlier design had clients PUT samples while panels
// rendered, with last-write-wins buckets to make several clients converge, all of it compensating for
// the wrong writer and obsoleted by the scheduler.
//
// Behind the ordinary `requireUser` gate rather than `requireDevice`, unlike the schedules routes it
// sits beside: this is read-only panel data, not node administration, and a task-scoped agent
// rendering a dashboard is a legitimate reader.

export const dashboards = new Hono<AppEnv>().get('/history', async (c) => {
  const panelId = c.req.query('panelId')
  if (!panelId) return respondError(c, 400, 'bad_request', ['Name the panel whose history you want: ?panelId=…'])
  const raw = c.req.query('since')
  const since = raw === undefined ? undefined : Number(raw)
  if (since !== undefined && !Number.isFinite(since)) {
    return respondError(c, 400, 'bad_request', ['`since` is an epoch-millisecond bucket bound.'])
  }
  // An empty series answers 200 with an empty array, never 404: absence is data. A panel that has
  // just been given a trend has a cold state to render ("collecting since …"), and a 404 would make
  // the client branch on an error to draw it.
  return c.json(await readSeries(getDb(c.env), panelId, since) satisfies MeasureSeries)
}).post('/:operation', async c => {
  try {
    const parsed = dashboardLibraryRequestSchema.safeParse(await c.req.json())
    if (!parsed.success || parsed.data.operation !== c.req.param('operation')) return respondError(c, 400, 'invalid-request')
    const input = parsed.data
    const principal = c.get('principal')!
    if (principal.kind !== 'device') return respondError(c, 403, 'interactive_user_required')
    const invocation = { principal, signal: c.req.raw.signal }
    await authorizeQueryScope(c.env, input.scope, invocation)
    const store = dashboardStore(getDb(c.env))
    switch (input.operation) {
      case 'list': return c.json(store.list(input.scope))
      case 'get': return c.json(store.get(input.scope, input.id))
      case 'create': return c.json(store.create(input.scope, input.content))
      case 'save': return c.json(store.save(input.scope, input.id, input.expectedRevision, input.content))
      case 'validate': return c.json({ problems: (await dashboardContentProblems(c.env, input.scope, input.content, invocation)).map(describeDashboardProblem) })
      case 'run': return c.json(await runDashboard(c.env, input, invocation))
      case 'publish': return c.json(await publishDashboard(c.env, input.scope, input.id, input.expectedRevision, invocation))
      case 'published': return c.json(store.published(input.scope, input.id, input.revision))
      case 'delete': deleteDashboard(c.env, input.scope, input.id, input.expectedRevision); return c.json({ ok: true })
    }
  } catch (error) {
    if (error instanceof DashboardLibraryError) {
      return respondError(c, error.code === 'not-found' ? 404 : error.code === 'invalid-dashboard' ? 400 : 409, error.code, error.problems.map(describeDashboardProblem))
    }
    return respondError(c, 400, 'invalid-dashboard')
  }
})
