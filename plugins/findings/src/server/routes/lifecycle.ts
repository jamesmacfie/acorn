import { Hono, type MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { respondError, type AppEnv } from '@acorn/plugin-api/node'
import type { FindingsLifecycle } from '../lifecycle'
import type { FindingsLegacyMigration } from '../migration'
import { requestContext } from './carrier'

const settingsSchema = z.strictObject({
  automaticPreparation: z.boolean(),
  notifyWhenReady: z.boolean(),
  backendId: z.string().min(1).nullable(),
  modelId: z.string().min(1).nullable(),
})

const deviceOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (requestContext(c).principal.kind !== 'device') return respondError(c, 403, 'interactive_user_required')
  await next()
}

export const findingsLifecycleRoutes = (lifecycle: FindingsLifecycle, migration: FindingsLegacyMigration) => new Hono<AppEnv>()
  .use('/settings', deviceOnly)
  .use('/migration/*', deviceOnly)
  .use('/export', deviceOnly)
  .get('/settings', (c) => lifecycle.settings(requestContext(c).userId).then((value) => c.json(value)))
  .put('/settings', async (c) => {
    const parsed = settingsSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return c.json(await lifecycle.setSettings(requestContext(c).userId, parsed.data))
  })
  .get('/migration/report', (c) => c.json(migration.report()))
  .get('/export', (c) => c.json(migration.export()))
