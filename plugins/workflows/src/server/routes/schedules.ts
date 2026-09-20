import { Hono } from 'hono'
import { z } from 'zod'
import { DATA_LIMITS, parseDataValue } from '@acorn/protocol/dataValues.ts'
import { cadenceSchema } from '@acorn/protocol/schedules.ts'
import { requireDevice, respondError, routeCapability, viaBridge, type AppEnv } from '@acorn/plugin-api/node'
import type { WorkflowScheduleDraftInput, WorkflowScheduleFirstCheck } from '../../shared/workflowSchedules'

export type WorkflowSchedulesBridge = {
  list(): Promise<unknown> | unknown
  get(id: string): Promise<unknown> | unknown
  defaults(): Promise<unknown> | unknown
  prepare(input: WorkflowScheduleDraftInput): Promise<unknown> | unknown
  save(input: WorkflowScheduleDraftInput): Promise<unknown> | unknown
  approve(id: string, firstCheck: WorkflowScheduleFirstCheck, freshEpoch: boolean): Promise<unknown>
  pause(id: string, paused: boolean): Promise<unknown>
  runNow(id: string): Promise<unknown>
  remove(id: string): Promise<unknown>
}

export const WORKFLOW_SCHEDULES_ROUTE = routeCapability<WorkflowSchedulesBridge>('workflows.schedules.route')

const dataValue = z.unknown().transform((value, ctx) => {
  try { return parseDataValue(value, DATA_LIMITS.selectionBytes) }
  catch { ctx.addIssue({ code: 'custom', message: 'Expected a bounded typed value' }); return z.NEVER }
})
const saveBody = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).max(120).optional(),
  projectId: z.string().min(1),
  workflowId: z.string().min(1),
  inputs: z.record(z.string(), dataValue).optional(),
  timezone: z.string().min(1),
  cadence: cadenceSchema.optional(),
  loops: z.array(z.object({
    loopId: z.string().min(1).max(2048),
    repeat: z.object({
      mode: z.enum(['every-match', 'unseen', 'changed']),
      fields: z.array(z.string().max(2048)).max(DATA_LIMITS.fields).optional(),
    }).strict(),
    incremental: z.boolean(),
  }).strict()).max(100).optional(),
  limits: z.object({
    maxDescendants: z.number().int().min(1).max(500).optional(),
    maxConcurrency: z.number().int().min(1).max(4).optional(),
    budget: z.object({
      maxWallTimeMs: z.number().positive().finite().optional(),
      maxCostUsd: z.number().nonnegative().finite().optional(),
      maxInputTokens: z.number().int().nonnegative().optional(),
      maxOutputTokens: z.number().int().nonnegative().optional(),
      maxTurns: z.number().int().nonnegative().optional(),
    }).strict().optional(),
  }).strict().optional(),
}).strict()
const approveBody = z.object({
  firstCheck: z.enum(['process-current', 'track-now']),
  freshEpoch: z.boolean().default(false),
}).strict()
const pauseBody = z.object({ paused: z.boolean() }).strict()

export const workflowScheduleRoutes = new Hono<AppEnv>()
  .use('*', requireDevice)
  .get('/', c => viaBridge(c, WORKFLOW_SCHEDULES_ROUTE, async bridge => bridge.list()))
  .get('/defaults', c => viaBridge(c, WORKFLOW_SCHEDULES_ROUTE, async bridge => bridge.defaults()))
  .post('/prepare', async c => {
    const parsed = saveBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request', ['Complete the project, published workflow, timezone, and typed inputs.'])
    return viaBridge(c, WORKFLOW_SCHEDULES_ROUTE, async bridge => bridge.prepare(parsed.data))
  })
  .post('/', async c => {
    const parsed = saveBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request', ['Invalid workflow schedule draft.'])
    return viaBridge(c, WORKFLOW_SCHEDULES_ROUTE, async bridge => bridge.save(parsed.data))
  })
  .get('/:id', c => viaBridge(c, WORKFLOW_SCHEDULES_ROUTE, async bridge => bridge.get(c.req.param('id'))))
  .post('/:id/approve', async c => {
    const parsed = approveBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request', ['Choose the first-check behavior.'])
    return viaBridge(c, WORKFLOW_SCHEDULES_ROUTE, bridge => bridge.approve(c.req.param('id'), parsed.data.firstCheck, parsed.data.freshEpoch))
  })
  .post('/:id/pause', async c => {
    const parsed = pauseBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request', ['Choose whether to pause this schedule.'])
    return viaBridge(c, WORKFLOW_SCHEDULES_ROUTE, bridge => bridge.pause(c.req.param('id'), parsed.data.paused))
  })
  .post('/:id/run', c => viaBridge(c, WORKFLOW_SCHEDULES_ROUTE, bridge => bridge.runNow(c.req.param('id'))))
  .delete('/:id', c => viaBridge(c, WORKFLOW_SCHEDULES_ROUTE, bridge => bridge.remove(c.req.param('id'))))
