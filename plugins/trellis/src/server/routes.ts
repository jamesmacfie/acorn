import { Hono } from 'hono'
import { z } from 'zod'
import { type AppEnv, requireDevice, respondError } from '@acorn/plugin-api/node'
import { appIdSchema, type AppListing } from '../shared/api'
import { MAX_STATE_BYTES, type AppMeta, type AppStore } from './store'

// What the card and the Apps pane read, Restore, and an app's saved state (docs/agent-built-apps.md).
// Device only: an agent works through the app tools, and only the person restores or ticks.

const revision = z.coerce.number().int().positive()
const stateBody = z.object({ state: z.record(z.string().regex(/^\$/), z.unknown()) })
const sessionBody = z.object({ sessionId: z.string().min(1).max(200) })

export const appRoutes = (store: AppStore, changed: (meta: AppMeta) => void) =>
  new Hono<AppEnv>()
    .use('/apps', requireDevice)
    .use('/apps/*', requireDevice)
    // Every shown app on the Node: the pane's gate is synchronous, so it answers from this list.
    .get('/apps', async (c) =>
      c.json(
        (await store.all())
          .filter((meta) => meta.head > 0)
          .map(({ appId, taskId, name, description, head, createdAt, updatedAt, sessionId }): AppListing => ({
            appId,
            taskId,
            name,
            description,
            head,
            updatedAt: updatedAt ?? createdAt,
            ...(sessionId ? { sessionId } : {}),
          })),
      ),
    )
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
      const meta = await store.meta(appId.data)
      if (meta) changed(meta)
      return c.json({ revision: restored })
    })
    .get('/apps/:appId/state', async (c) => {
      const appId = appIdSchema.safeParse(c.req.param('appId'))
      if (!appId.success || !(await store.meta(appId.data))) return respondError(c, 404, 'not_found')
      return c.json({ state: await store.state(appId.data) })
    })
    .put('/apps/:appId/state', async (c) => {
      const appId = appIdSchema.safeParse(c.req.param('appId'))
      const body = stateBody.safeParse(await c.req.json().catch(() => null))
      if (!appId.success || !body.success) return respondError(c, 400, 'bad_request')
      if (Buffer.byteLength(JSON.stringify(body.data.state)) > MAX_STATE_BYTES) return respondError(c, 413, 'too_large')
      if (!(await store.meta(appId.data))) return respondError(c, 404, 'not_found')
      await store.saveState(appId.data, body.data.state)
      return c.body(null, 204)
    })
    .put('/apps/:appId/session', async (c) => {
      const appId = appIdSchema.safeParse(c.req.param('appId'))
      const body = sessionBody.safeParse(await c.req.json().catch(() => null))
      if (!appId.success || !body.success) return respondError(c, 400, 'bad_request')
      if (!(await store.setSession(appId.data, body.data.sessionId))) return respondError(c, 404, 'not_found')
      return c.body(null, 204)
    })
