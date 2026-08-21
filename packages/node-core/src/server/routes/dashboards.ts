import { Hono } from 'hono'
import { getDb } from '../db'
import type { AppEnv } from '../middleware/auth'
import { readSeries, type MeasureSeries } from '../dashboards/history'
import { respondError } from '../respond'

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
})
