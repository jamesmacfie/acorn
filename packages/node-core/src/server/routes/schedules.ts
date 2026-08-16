import { Hono } from 'hono'
import { z } from 'zod'
import { cadenceSchema, type ScheduleTargetOption, type ScheduleTargetsResponse } from '@acorn/protocol/schedules.ts'
import { nodeActions, riskOf } from '../nodeActions/registry'
import { viaBridge } from '../bridge'
import type { AppEnv } from '../middleware/auth'
import { respondError } from '../respond'
import { SCHEDULER } from '../schedules'

// Settings → Schedules (docs/schedules.md). The whole node↔client contract for periodic work: one
// merged list over the three declarers, and the verbs a person needs — pause, retune, run now, delete.
//
// Gated with requireDevice by MOUNT in server/index.ts, alongside plugins/audit/security: a schedule is
// code this node runs unattended, so creating one is node administration and a task-scoped agent must
// not reach it. Same class of decision as "which plugins does this node run".
//
// The scheduler throws BridgeError for every owner-fixable refusal — an unknown target kind, a declared
// schedule someone tried to delete, a job already running — so viaBridge turns each into its own 4xx
// and nothing here maintains a status table.

const createBody = z.strictObject({
  name: z.string().min(1).max(120),
  kind: z.string().min(1).max(64),
  target: z.unknown(),
  cadence: cadenceSchema,
})

const patchBody = z.strictObject({
  enabled: z.boolean().optional(),
  cadence: cadenceSchema.optional(),
  name: z.string().min(1).max(120).optional(),
})

const pauseBody = z.strictObject({ paused: z.boolean() })

export const schedules = new Hono<AppEnv>()
  .get('/', (c) => viaBridge(c, SCHEDULER, async (scheduler) => ({ paused: scheduler.paused(), schedules: await scheduler.list() })))
  // The global kill switch, on the COLLECTION rather than a key: it stops the loop without touching a
  // single row, which is what makes it the "something is wrong and I don't know what yet" lever.
  .patch('/', async (c) => {
    const body = pauseBody.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return respondError(c, 400, 'bad_request', ['Send { "paused": true } or { "paused": false }.'])
    return viaBridge(c, SCHEDULER, async (scheduler) => {
      await scheduler.setPaused(body.data.paused)
      return { paused: scheduler.paused(), schedules: await scheduler.list() }
    })
  })
  .post('/', async (c) => {
    const body = createBody.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return respondError(c, 400, 'bad_request', ['A schedule needs a name, a target kind, its target, and a cadence.'])
    return viaBridge(c, SCHEDULER, (scheduler) => scheduler.create(body.data))
  })
  // What the creation flow may offer, and nothing else. Read straight off the node-side registry
  // rather than through the scheduler bridge: this is a question about what CAN be scheduled, which
  // the registry answers, and routing it through the scheduler would mean the scheduler holding a
  // catalogue it never reads.
  //
  // Declared BEFORE '/:key/runs' — Hono matches in registration order, and `targets` would otherwise
  // be read as a key.
  .get('/targets', (c) => {
    const targets: ScheduleTargetOption[] = nodeActions().map((action) => ({
      kind: 'node-action',
      pluginId: action.pluginId,
      actionId: action.actionId,
      name: action.name,
      risk: riskOf(action),
    }))
    return c.json({ targets } satisfies ScheduleTargetsResponse)
  })
  .get('/:key/runs', (c) => viaBridge(c, SCHEDULER, (scheduler) => scheduler.runs(c.req.param('key'))))
  .post('/:key/run', (c) => viaBridge(c, SCHEDULER, (scheduler) => scheduler.runNow(c.req.param('key'))))
  // Re-arm after a tier rise. No body: the node re-stamps from the registry, so a client can only ever
  // accept the tier the host just showed it.
  .post('/:key/confirm', (c) => viaBridge(c, SCHEDULER, (scheduler) => scheduler.confirm(c.req.param('key'))))
  .patch('/:key', async (c) => {
    const body = patchBody.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return respondError(c, 400, 'bad_request', ['Send some combination of enabled, cadence and name.'])
    return viaBridge(c, SCHEDULER, (scheduler) => scheduler.patch(c.req.param('key'), body.data))
  })
  .delete('/:key', (c) =>
    viaBridge(c, SCHEDULER, async (scheduler) => {
      await scheduler.remove(c.req.param('key'))
      return { deleted: true }
    }),
  )
