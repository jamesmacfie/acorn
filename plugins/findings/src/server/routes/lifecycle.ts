import { Hono, type MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { respondError, type AppEnv } from '@acorn/plugin-api/node'
import type { FindingsLifecycle } from '../lifecycle'
import { requestContext } from './carrier'

const settingsSchema = z.strictObject({
  automaticPreparation: z.boolean(),
  notifyWhenReady: z.boolean(),
  backendId: z.string().min(1).nullable(),
  modelId: z.string().min(1).nullable(),
  targetId: z.string().min(1).nullable(),
})
const archiveReviewSchema = z.strictObject({
  taskId: z.string().min(1), sessionIds: z.array(z.string().max(200)).max(64),
  terminalOutput: z.string().max(16_384), diff: z.string().max(12_000),
  captureStatus: z.literal('pending'),
})

const deviceOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (requestContext(c).principal.kind !== 'device') return respondError(c, 403, 'interactive_user_required')
  await next()
}

export const findingsLifecycleRoutes = (lifecycle: FindingsLifecycle, exportData: () => unknown) => new Hono<AppEnv>()
  .post('/runtime/hooks/archive-review', async (c) => {
    const principal = requestContext(c).principal
    if (principal.kind !== 'internal' || principal.scope !== 'service') return respondError(c, 403, 'internal_service_required')
    const parsed = archiveReviewSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    try {
      await lifecycle.archiveReview(parsed.data)
      return c.json({ payload: { ...parsed.data, captureStatus: 'captured' } })
    } catch {
      return c.json({ payload: { ...parsed.data, captureStatus: 'failed' } })
    }
  })
  .use('/settings', deviceOnly)
  .use('/export', deviceOnly)
  .get('/settings', (c) => lifecycle.settings(requestContext(c).userId).then((value) => c.json(value)))
  .put('/settings', async (c) => {
    const parsed = settingsSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return c.json(await lifecycle.setSettings(requestContext(c).userId, parsed.data))
  })
  .get('/export', (c) => c.json(exportData()))
