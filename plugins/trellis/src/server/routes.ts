import { Hono } from 'hono'
import { z } from 'zod'
import { type AppEnv, requireDevice, respondError } from '@acorn/plugin-api/node'
import { appIdSchema } from '../shared/api'
import type { AppStore } from './store'

// What the card reads, and Restore (docs/agent-built-apps.md § Cards). Device only: an agent works
// through the app tools, and only the person's click restores.

const revision = z.coerce.number().int().positive()

export const appRoutes = (store: AppStore) =>
  new Hono<AppEnv>()
    .use('/apps/*', requireDevice)
    .get('/apps/:appId', async (c) => {
      const appId = appIdSchema.safeParse(c.req.param('appId'))
      const summary = appId.success ? await store.summary(appId.data) : null
      return summary ? c.json(summary) : respondError(c, 404, 'not_found')
    })
    .get('/apps/:appId/revisions/:revision', async (c) => {
      const appId = appIdSchema.safeParse(c.req.param('appId'))
      const number = revision.safeParse(c.req.param('revision'))
      const files = appId.success && number.success ? await store.revisionFiles(appId.data, number.data) : null
      return files ? c.json(files) : respondError(c, 404, 'not_found')
    })
    .post('/apps/:appId/restore', async (c) => {
      const appId = appIdSchema.safeParse(c.req.param('appId'))
      const body = z.object({ revision }).safeParse(await c.req.json().catch(() => null))
      if (!appId.success || !body.success) return respondError(c, 400, 'bad_request')
      const old = await store.revision(appId.data, body.data.revision)
      if (!old) return respondError(c, 404, 'not_found')
      const restored = await store.publish(
        appId.data,
        old.files,
        { note: `Restored v${body.data.revision}.`, library: old.meta.library, restoredFrom: body.data.revision },
        { toWorking: true },
      )
      return c.json({ revision: restored })
    })
