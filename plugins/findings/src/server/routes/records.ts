import { Hono, type MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { type AppEnv, respondError } from '@acorn/plugin-api/node'
import { FINDING_LIMITS, findingRecordInputSchema, findingScopeSchema } from '../../contract/records'
import { FindingCaptureError } from '../capture'
import type { FindingsRuntime } from '../runtime'
import { requestContext } from './carrier'

const listQuery = z.strictObject({
  cursor: z.string().max(400).optional(),
  limit: z.coerce.number().int().min(1).max(FINDING_LIMITS.pageSize).optional(),
  state: z.enum(['active', 'history']).default('history'),
})
const batchBody = z.strictObject({ observations: z.array(findingRecordInputSchema).min(1).max(FINDING_LIMITS.observationsPerBatch) })
const scopedRecordBody = z.strictObject({ scope: findingScopeSchema, observation: findingRecordInputSchema })
const scopedBatchBody = z.strictObject({ scope: findingScopeSchema, observations: z.array(findingRecordInputSchema).min(1).max(FINDING_LIMITS.observationsPerBatch) })
const withdrawBody = z.strictObject({ reason: z.string().max(FINDING_LIMITS.reasonChars).optional() })

const deviceOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (requestContext(c).principal.kind !== 'device') return respondError(c, 403, 'interactive_user_required')
  await next()
}

const routeError = (c: Parameters<typeof respondError>[0], error: unknown): Response => {
  if (!(error instanceof FindingCaptureError)) return respondError(c, 500, 'internal')
  const status = error.kind === 'not-found' ? 404 : error.kind === 'conflict' ? 409 : error.kind === 'forbidden' ? 403 : error.kind === 'unavailable' ? 503 : 400
  const code = error.kind === 'conflict' ? 'conflict' : error.kind === 'unavailable' ? 'unavailable' : error.kind === 'forbidden' ? 'forbidden' : error.kind === 'not-found' ? 'not_found' : 'bad_request'
  return respondError(c, status, code, [error.message])
}

export const findingsRecordRoutes = (runtime: FindingsRuntime) =>
  new Hono<AppEnv>()
    // The pane is owner history. Agent reads go through the task-confined tool projection instead.
    .use('/observations', deviceOnly)
    .use('/observations/*', deviceOnly)
    .use('/tasks/:id/observations', deviceOnly)
    .use('/tasks/:id/observations/*', deviceOnly)
    .post('/observations', async (c) => {
      const parsed = scopedRecordBody.safeParse(await c.req.json().catch(() => null))
      if (!parsed.success) return respondError(c, 400, 'bad_request', [parsed.error.message])
      try {
        return c.json(await runtime.record({
          scope: parsed.data.scope,
          origin: { kind: 'device', deviceId: requestContext(c).principal.deviceId! },
          producerId: 'findings:device-route',
          input: parsed.data.observation,
        }))
      } catch (error) {
        return routeError(c, error)
      }
    })
    .post('/observations/batch', async (c) => {
      const parsed = scopedBatchBody.safeParse(await c.req.json().catch(() => null))
      if (!parsed.success) return respondError(c, 400, 'bad_request', [parsed.error.message])
      try {
        return c.json({ items: await runtime.recordBatch({
          scope: parsed.data.scope,
          origin: { kind: 'device', deviceId: requestContext(c).principal.deviceId! },
          producerId: 'findings:device-route',
          inputs: parsed.data.observations,
        }) })
      } catch (error) {
        return routeError(c, error)
      }
    })
    .get('/tasks/:id/observations', async (c) => {
      const parsed = listQuery.safeParse(c.req.query())
      if (!parsed.success) return respondError(c, 400, 'bad_request', [parsed.error.message])
      try {
        return c.json(await runtime.listTask(c.req.param('id'), parsed.data))
      } catch (error) {
        return routeError(c, error)
      }
    })
    .get('/tasks/:id/observations/:observationId', async (c) => {
      const found = runtime.getTask(c.req.param('id'), c.req.param('observationId'))
      return found ? c.json(found) : respondError(c, 404, 'not_found')
    })
    // Device capture exists for explicit owner-authored evidence and for HTTP contract testing. It
    // stamps device identity from the principal; neither scope nor origin is accepted in the body.
    .post('/tasks/:id/observations', async (c) => {
      const parsed = findingRecordInputSchema.safeParse(await c.req.json().catch(() => null))
      if (!parsed.success) return respondError(c, 400, 'bad_request', [parsed.error.message])
      try {
        return c.json(await runtime.record({
          scope: { kind: 'task', taskId: c.req.param('id') },
          origin: { kind: 'device', deviceId: requestContext(c).principal.deviceId! },
          producerId: 'findings:device-route',
          input: parsed.data,
        }))
      } catch (error) {
        return routeError(c, error)
      }
    })
    .post('/tasks/:id/observations/batch', async (c) => {
      const parsed = batchBody.safeParse(await c.req.json().catch(() => null))
      if (!parsed.success) return respondError(c, 400, 'bad_request', [parsed.error.message])
      try {
        return c.json({ items: await runtime.recordBatch({
          scope: { kind: 'task', taskId: c.req.param('id') },
          origin: { kind: 'device', deviceId: requestContext(c).principal.deviceId! },
          producerId: 'findings:device-route',
          inputs: parsed.data.observations,
        }) })
      } catch (error) {
        return routeError(c, error)
      }
    })
    .post('/tasks/:id/observations/:observationId/withdraw', async (c) => {
      const parsed = withdrawBody.safeParse(await c.req.json().catch(() => ({})))
      if (!parsed.success) return respondError(c, 400, 'bad_request', [parsed.error.message])
      try {
        return c.json(runtime.withdrawTask({
          taskId: c.req.param('id'),
          observationId: c.req.param('observationId'),
          actor: { kind: 'device', id: requestContext(c).principal.deviceId! },
          ...(parsed.data.reason === undefined ? {} : { reason: parsed.data.reason }),
        }))
      } catch (error) {
        return routeError(c, error)
      }
    })
