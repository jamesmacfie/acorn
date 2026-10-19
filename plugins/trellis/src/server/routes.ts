import { Hono } from 'hono'
import { z } from 'zod'
import { type AppEnv, requireDevice, respondError } from '@acorn/plugin-api/node'
import { appIdSchema, publishModeSchema, type AppListing } from '../shared/api'
import { publishToProject, startDraft, type ProjectAppDeps } from './projectApps'
import { MAX_STATE_BYTES } from './store'

// What the card, the Apps pane, and the Apps source read, Restore, an app's saved state, and publishing
// to the project (docs/agent-built-apps.md). Device only: an agent works through the app tools, and only
// the person restores, ticks, publishes, or deletes.

const revision = z.coerce.number().int().positive()
const stateBody = z.object({ state: z.record(z.string().regex(/^\$/), z.unknown()) })
const sessionBody = z.object({ sessionId: z.string().min(1).max(200) })
const publishBody = z.object({ mode: publishModeSchema.default('safe') })
const draftBody = z.object({ taskId: z.string().min(1).max(200) })
const deletedBody = z.object({ deleted: z.boolean() })

export type AppRouteDeps = ProjectAppDeps & {
  /** The task's project, or undefined when there's no such task. */
  loadTask(taskId: string): Promise<{ id: string; projectId: string } | undefined>
}

export const appRoutes = (deps: AppRouteDeps) => {
  const { store, changed } = deps
  return (
    new Hono<AppEnv>()
      .use('/apps', requireDevice)
      .use('/apps/*', requireDevice)
      // Every shown app on the Node: the pane's gate is synchronous, so it answers from this list.
      .get('/apps', async (c) =>
        c.json(
          (await store.all())
            .filter((meta) => meta.head > 0)
            .map(({ createdAt, updatedAt, ...meta }): AppListing => ({ ...meta, updatedAt: updatedAt ?? createdAt })),
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
        if (Buffer.byteLength(JSON.stringify(body.data.state)) > MAX_STATE_BYTES)
          return respondError(c, 413, 'too_large')
        if (!(await store.meta(appId.data))) return respondError(c, 404, 'not_found')
        await store.saveState(appId.data, body.data.state)
        return c.body(null, 204)
      })
      .put('/apps/:appId/session', async (c) => {
        const appId = appIdSchema.safeParse(c.req.param('appId'))
        const body = sessionBody.safeParse(await c.req.json().catch(() => null))
        if (!appId.success || !body.success) return respondError(c, 400, 'bad_request')
        if (!(await store.update(appId.data, { sessionId: body.data.sessionId })))
          return respondError(c, 404, 'not_found')
        return c.body(null, 204)
      })
      // A task app's head to its task's project. 409 when its project app moved since the draft started,
      // so the person chooses between replacing it and publishing a new app.
      .post('/apps/:appId/publish', async (c) => {
        const appId = appIdSchema.safeParse(c.req.param('appId'))
        const body = publishBody.safeParse(await c.req.json().catch(() => ({})))
        if (!appId.success || !body.success) return respondError(c, 400, 'bad_request')
        const taskId = (await store.meta(appId.data))?.taskId
        const task = taskId ? await deps.loadTask(taskId) : undefined
        const outcome = task ? await publishToProject(deps, appId.data, task.projectId, body.data.mode) : null
        if (outcome === 'conflict') return respondError(c, 409, 'conflict')
        return outcome ? c.json(outcome) : respondError(c, 404, 'not_found')
      })
      // A draft of a project app in a task of its project.
      .post('/apps/:appId/drafts', async (c) => {
        const appId = appIdSchema.safeParse(c.req.param('appId'))
        const body = draftBody.safeParse(await c.req.json().catch(() => null))
        if (!appId.success || !body.success) return respondError(c, 400, 'bad_request')
        const task = await deps.loadTask(body.data.taskId)
        const draft = task ? await startDraft(deps, appId.data, task) : null
        return draft ? c.json({ appId: draft.appId }) : respondError(c, 404, 'not_found')
      })
      // Delete moves a project app to the archived list, and Restore brings it back at its head.
      .put('/apps/:appId/deleted', async (c) => {
        const appId = appIdSchema.safeParse(c.req.param('appId'))
        const body = deletedBody.safeParse(await c.req.json().catch(() => null))
        if (!appId.success || !body.success) return respondError(c, 400, 'bad_request')
        const meta = await store.meta(appId.data)
        if (!meta?.projectId) return respondError(c, 404, 'not_found')
        await store.update(appId.data, { deletedAt: body.data.deleted ? Date.now() : undefined })
        changed(meta)
        return c.body(null, 204)
      })
      // Remove for good, only once deleted.
      .delete('/apps/:appId', async (c) => {
        const appId = appIdSchema.safeParse(c.req.param('appId'))
        const meta = appId.success ? await store.meta(appId.data) : null
        if (!meta?.projectId || !meta.deletedAt) return respondError(c, 404, 'not_found')
        await store.remove(meta.appId)
        changed(meta)
        return c.body(null, 204)
      })
  )
}
