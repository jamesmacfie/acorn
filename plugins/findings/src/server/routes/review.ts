import { Hono, type MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { type AppEnv, respondError } from '@acorn/plugin-api/node'
import { findingScopeSchema } from '../../contract/records'
import { FINDING_CANDIDATE_PAYLOAD_BYTES } from '../../contract/review'
import { FindingCaptureError } from '../capture'
import type { FindingsRuntime } from '../runtime'
import { requestContext } from './carrier'

const scopeFrom = (query: Record<string, string>): unknown => query.scope === 'private' ? { kind: 'private' }
  : query.scope === 'task' ? { kind: 'task', taskId: query.taskId }
    : query.scope === 'project' ? { kind: 'project', projectId: query.projectId }
      : query.scope === 'workspace' ? { kind: 'workspace', workspaceId: query.workspaceId } : null
const prepareBody = z.strictObject({ boundaryKey: z.string().trim().min(1).max(300), backendId: z.string().min(1).max(300).optional(), modelId: z.string().min(1).max(300).optional() })
const editBody = z.strictObject({ expectedRevision: z.number().int().min(1), payload: z.unknown(), idempotencyKey: z.string().min(1).max(300) })
const decisionBody = z.strictObject({ expectedRevision: z.number().int().min(1), action: z.enum(['dismiss', 'dismiss-reason', 'undo-dismiss', 'snooze']), reason: z.string().max(1_000).optional(), until: z.number().int().positive().optional(), idempotencyKey: z.string().min(1).max(300) })
const restoreBody = z.strictObject({ candidateId: z.string().min(1).max(300), expectedRevision: z.number().int().min(1), idempotencyKey: z.string().min(1).max(300) })
const splitBody = z.strictObject({ bundleId: z.string().min(1).max(300), expectedRevision: z.number().int().min(1), observationIds: z.array(z.string().min(1).max(300)).min(1).max(100), idempotencyKey: z.string().min(1).max(300) })

const deviceOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (requestContext(c).principal.kind !== 'device') return respondError(c, 403, 'interactive_user_required')
  await next()
}

const routeError = (c: Parameters<typeof respondError>[0], error: unknown): Response => {
  if (!(error instanceof FindingCaptureError)) return respondError(c, 500, 'internal', [error instanceof Error ? error.message : String(error)])
  const status = error.kind === 'not-found' ? 404 : error.kind === 'conflict' ? 409 : error.kind === 'forbidden' ? 403 : error.kind === 'unavailable' ? 503 : 400
  return respondError(c, status, error.kind === 'not-found' ? 'not_found' : error.kind === 'invalid-input' ? 'bad_request' : error.kind, [error.message])
}

export const findingsReviewRoutes = (runtime: FindingsRuntime) => new Hono<AppEnv>()
  .use('/review/*', deviceOnly)
  .use('/tasks/:id/review/*', deviceOnly)
  .use('/models', deviceOnly)
  .get('/review/bundles', (c) => {
    const scope = findingScopeSchema.safeParse(scopeFrom(c.req.query()))
    return scope.success ? c.json(runtime.bundles(scope.data, c.req.query('history') === 'true')) : respondError(c, 400, 'bad_request')
  })
  .get('/tasks/:id/review/bundles', async (c) => {
    try { return c.json(await runtime.bundlesForTask(c.req.param('id'), c.req.query('history') === 'true')) }
    catch (error) { return routeError(c, error) }
  })
  .get('/models', async (c) => c.json({ backends: await runtime.modelBackends(), missing: [] }))
  .post('/tasks/:id/review/prepare', async (c) => {
    const parsed = prepareBody.safeParse(await c.req.json().catch(() => null)); if (!parsed.success) return respondError(c, 400, 'bad_request')
    try { return c.json(await runtime.startPrepareTask(c.req.param('id'), parsed.data)) } catch (error) { return routeError(c, error) }
  })
  .get('/review/candidates/:id', (c) => {
    const candidate = runtime.candidate(c.req.param('id')); return candidate ? c.json({ ...candidate, observations: runtime.observations(candidate.sourceObservationIds) }) : respondError(c, 404, 'not_found')
  })
  .get('/review/candidates/:id/history', (c) => c.json({ items: runtime.history(c.req.param('id')) }))
  .post('/review/bundles/:id/cancel', (c) => { try { return c.json(runtime.cancelPreparation(c.req.param('id'))) } catch (error) { return routeError(c, error) } })
  .post('/review/bundles/:id/retry', async (c) => { try { return c.json(await runtime.retryPreparation(c.req.param('id'))) } catch (error) { return routeError(c, error) } })
  .post('/review/bundles/:id/outcomes/:observationId/restore', async (c) => {
    const parsed = restoreBody.safeParse(await c.req.json().catch(() => null)); if (!parsed.success) return respondError(c, 400, 'bad_request')
    try { return c.json(runtime.restoreObservation({ bundleId: c.req.param('id'), observationId: c.req.param('observationId'), actorId: requestContext(c).principal.deviceId!, ...parsed.data })) } catch (error) { return routeError(c, error) }
  })
  .post('/review/candidates/:id/edit', async (c) => {
    const raw = await c.req.json().catch(() => null)
    if (new TextEncoder().encode(JSON.stringify(raw)).byteLength > FINDING_CANDIDATE_PAYLOAD_BYTES) return respondError(c, 400, 'bad_request', ['candidate payload is too large'])
    const parsed = editBody.safeParse(raw); if (!parsed.success) return respondError(c, 400, 'bad_request')
    try { return c.json(await runtime.editCandidate({ id: c.req.param('id'), actorId: requestContext(c).principal.deviceId!, ...parsed.data })) } catch (error) { return routeError(c, error) }
  })
  .post('/review/candidates/:id/decision', async (c) => {
    const parsed = decisionBody.safeParse(await c.req.json().catch(() => null)); if (!parsed.success || (parsed.data.action === 'snooze' && !parsed.data.until)) return respondError(c, 400, 'bad_request')
    try { return c.json(runtime.decideCandidate({ candidateId: c.req.param('id'), actorId: requestContext(c).principal.deviceId!, ...parsed.data })) } catch (error) { return routeError(c, error) }
  })
  .post('/review/candidates/:id/split', async (c) => {
    const parsed = splitBody.safeParse(await c.req.json().catch(() => null)); if (!parsed.success) return respondError(c, 400, 'bad_request')
    try { return c.json(runtime.splitCandidate({ candidateId: c.req.param('id'), actorId: requestContext(c).principal.deviceId!, ...parsed.data })) } catch (error) { return routeError(c, error) }
  })
