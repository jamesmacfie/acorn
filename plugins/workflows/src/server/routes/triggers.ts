import { Hono } from 'hono'
import { z } from 'zod'
import { dataBindingSchema, dataPointerSchema } from '@acorn/protocol/dataBindings.ts'
import { queryReferenceSchema } from '@acorn/protocol/dataQueries.ts'
import { DATA_LIMITS, parseDataValue } from '@acorn/protocol/dataValues.ts'
import { cadenceSchema } from '@acorn/protocol/schedules.ts'
import { requireDevice, respondError, routeCapability, viaBridge, type AppEnv } from '@acorn/plugin-api/node'
import type { WorkflowTriggerDraftInput, WorkflowTriggerFirstCheck } from '../../shared/workflowTriggers'

export type WorkflowTriggersBridge = {
  list(): Promise<unknown> | unknown
  get(id: string): Promise<unknown> | unknown
  defaults(): Promise<unknown> | unknown
  prepare(input: WorkflowTriggerDraftInput): Promise<unknown> | unknown
  preview(input: WorkflowTriggerDraftInput): Promise<unknown> | unknown
  save(input: WorkflowTriggerDraftInput): Promise<unknown> | unknown
  approve(id: string, firstCheck: WorkflowTriggerFirstCheck, freshEpoch: boolean): Promise<unknown>
  pause(id: string, paused: boolean): Promise<unknown>
  runNow(id: string): Promise<unknown>
  remove(id: string): Promise<unknown>
}

export const WORKFLOW_TRIGGERS_ROUTE = routeCapability<WorkflowTriggersBridge>('workflows.triggers.route')

const dataValue = z.unknown().transform((value, ctx) => {
  try {
    return parseDataValue(value, DATA_LIMITS.selectionBytes)
  } catch {
    ctx.addIssue({ code: 'custom', message: 'Expected a bounded typed value' })
    return z.NEVER
  }
})
// Clients built before triggers call /workflows/schedules, the alias below, and send `timezone` where
// `when` now goes (docs/api-reference/versioning.md § Mixed builds). Mixed-version path until 2027-01-19.
const legacyTimezone = (body: unknown): unknown => {
  if (!body || typeof body !== 'object' || 'when' in body || !('timezone' in body)) return body
  const { timezone, ...rest } = body as { timezone: unknown }
  return { ...rest, when: { kind: 'clock', timezone } }
}
const draftBody = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().min(1).max(120).optional(),
    projectId: z.string().min(1),
    workflowId: z.string().min(1),
    inputs: z.record(z.string(), dataValue).optional(),
    when: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('clock'), timezone: z.string().min(1) }).strict(),
      z
        .object({
          kind: z.literal('records'),
          query: queryReferenceSchema,
          change: z.discriminatedUnion('on', [
            z.object({ on: z.literal('new') }).strict(),
            z.object({ on: z.literal('enters') }).strict(),
            z.object({ on: z.literal('changes'), fields: z.array(dataPointerSchema).max(DATA_LIMITS.fields) }).strict(),
          ]),
          incremental: z.boolean().optional(),
          bindings: z.record(z.string().min(1).max(200), dataBindingSchema).optional(),
          // Circuit breakers can come down from their defaults, never up.
          runsPerCheck: z.number().int().min(1).max(10).optional(),
          runsPerDay: z.number().int().min(1).max(50).optional(),
        })
        .strict(),
    ]),
    cadence: cadenceSchema.optional(),
    loops: z
      .array(
        z
          .object({
            loopId: z.string().min(1).max(2048),
            repeat: z
              .object({
                mode: z.enum(['every-match', 'unseen', 'changed']),
                fields: z.array(z.string().max(2048)).max(DATA_LIMITS.fields).optional(),
              })
              .strict(),
            incremental: z.boolean(),
          })
          .strict(),
      )
      .max(100)
      .optional(),
    limits: z
      .object({
        maxDescendants: z.number().int().min(1).max(500).optional(),
        maxConcurrency: z.number().int().min(1).max(4).optional(),
        budget: z
          .object({
            maxWallTimeMs: z.number().positive().finite().optional(),
            maxCostUsd: z.number().nonnegative().finite().optional(),
            maxInputTokens: z.number().int().nonnegative().optional(),
            maxOutputTokens: z.number().int().nonnegative().optional(),
            maxTurns: z.number().int().nonnegative().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
const saveBody = z.preprocess(legacyTimezone, draftBody)
const approveBody = z
  .object({
    firstCheck: z.enum(['process-current', 'track-now']),
    freshEpoch: z.boolean().default(false),
  })
  .strict()
const pauseBody = z.object({ paused: z.boolean() }).strict()

export const workflowTriggerRoutes = new Hono<AppEnv>()
  // Both mount forms: `/` is the bare list path this router is mounted at.
  .use('/', requireDevice)
  .use('*', requireDevice)
  .get('/', (c) => viaBridge(c, WORKFLOW_TRIGGERS_ROUTE, async (bridge) => bridge.list()))
  .get('/defaults', (c) => viaBridge(c, WORKFLOW_TRIGGERS_ROUTE, async (bridge) => bridge.defaults()))
  .post('/prepare', async (c) => {
    const parsed = saveBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success)
      return respondError(c, 400, 'bad_request', [
        'Complete the project, published workflow, when it starts, and typed inputs.',
      ])
    return viaBridge(c, WORKFLOW_TRIGGERS_ROUTE, async (bridge) => bridge.prepare(parsed.data))
  })
  .post('/preview', async (c) => {
    const parsed = draftBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request', ['Choose the records this trigger watches.'])
    return viaBridge(c, WORKFLOW_TRIGGERS_ROUTE, async (bridge) => bridge.preview(parsed.data))
  })
  .post('/', async (c) => {
    const parsed = saveBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request', ['Invalid workflow trigger draft.'])
    return viaBridge(c, WORKFLOW_TRIGGERS_ROUTE, async (bridge) => bridge.save(parsed.data))
  })
  .get('/:id', (c) => viaBridge(c, WORKFLOW_TRIGGERS_ROUTE, async (bridge) => bridge.get(c.req.param('id'))))
  .post('/:id/approve', async (c) => {
    const parsed = approveBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request', ['Choose the first-check behavior.'])
    return viaBridge(c, WORKFLOW_TRIGGERS_ROUTE, (bridge) =>
      bridge.approve(c.req.param('id'), parsed.data.firstCheck, parsed.data.freshEpoch),
    )
  })
  .post('/:id/pause', async (c) => {
    const parsed = pauseBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request', ['Choose whether to pause this trigger.'])
    return viaBridge(c, WORKFLOW_TRIGGERS_ROUTE, (bridge) => bridge.pause(c.req.param('id'), parsed.data.paused))
  })
  .post('/:id/run', (c) => viaBridge(c, WORKFLOW_TRIGGERS_ROUTE, (bridge) => bridge.runNow(c.req.param('id'))))
  .delete('/:id', (c) => viaBridge(c, WORKFLOW_TRIGGERS_ROUTE, (bridge) => bridge.remove(c.req.param('id'))))

/** Answers a client built before triggers, which reads `timezone` on each trigger it gets back.
 *  Mixed-version path until 2027-01-19. */
const withTimezone = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withTimezone)
  const when = (value as { when?: { timezone?: unknown } } | null)?.when
  return when ? { ...(value as object), timezone: when.timezone } : value
}

export const legacyWorkflowScheduleRoutes = new Hono<AppEnv>()
  .use('*', async (c, next) => {
    await next()
    if (!c.res.ok || !c.res.headers.get('content-type')?.includes('application/json')) return
    c.res = new Response(JSON.stringify(withTimezone(await c.res.json())), c.res)
  })
  .route('/', workflowTriggerRoutes)
