import { Hono } from 'hono'
import { z } from 'zod'
import type { NoteKind, NoteLocation } from '@acorn/protocol/notes.ts'
import { NOTES_STORE } from '../../contract/store'
import { viaBridge } from '@acorn/node-core/server/bridge.ts'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import { requireDevice } from '@acorn/node-core/server/middleware/requireUser.ts'
import { respondError } from '@acorn/node-core/server/respond.ts'

// Notes owns this route surface. The memory plugin keeps the old /v2/p/memory/* note paths as a
// compatibility alias for clients and agent prompts that may have retained them.
const createBody = z.object({ title: z.string(), kind: z.enum(['scratch', 'plan', 'finding', 'handoff']).optional() })
const writeBody = z.object({ body: z.string() })
const includedBody = z.object({ included: z.boolean() })
const titleBody = z.object({ title: z.string().trim().min(1) })
const workspaceLocation = (id: string): NoteLocation => (id === 'global' ? { scope: 'global' } : { scope: 'workspace', workspaceId: id })
const taskLocation = (id: string): NoteLocation => ({ scope: 'task', taskId: id })

export const notes = new Hono<AppEnv>()
  .use('/workspaces/:wsId/notes/*', requireDevice)
  .get('/workspaces/:wsId/notes', (c) => viaBridge(c, NOTES_STORE, (store) => store.list(workspaceLocation(c.req.param('wsId')))))
  .get('/workspaces/:wsId/notes/:slug', (c) => viaBridge(c, NOTES_STORE, (store) => store.read(workspaceLocation(c.req.param('wsId')), c.req.param('slug'))))
  .post('/workspaces/:wsId/notes', async (c) => {
    const parsed = createBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, NOTES_STORE, (store) => store.create(workspaceLocation(c.req.param('wsId')), parsed.data.title, { kind: parsed.data.kind as NoteKind | undefined }))
  })
  .put('/workspaces/:wsId/notes/:slug', async (c) => {
    const parsed = writeBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, NOTES_STORE, (store) => store.write(workspaceLocation(c.req.param('wsId')), c.req.param('slug'), parsed.data.body))
  })
  .post('/workspaces/:wsId/notes/:slug/included', async (c) => {
    const parsed = includedBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, NOTES_STORE, (store) => store.setIncluded(workspaceLocation(c.req.param('wsId')), c.req.param('slug'), parsed.data.included))
  })
  .post('/workspaces/:wsId/notes/:slug/title', async (c) => {
    const parsed = titleBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, NOTES_STORE, (store) => store.setTitle(workspaceLocation(c.req.param('wsId')), c.req.param('slug'), parsed.data.title))
  })
  .delete('/workspaces/:wsId/notes/:slug', (c) => viaBridge(c, NOTES_STORE, (store) => store.remove(workspaceLocation(c.req.param('wsId')), c.req.param('slug'))))
  .get('/tasks/:id/notes', (c) => viaBridge(c, NOTES_STORE, (store) => store.list(taskLocation(c.req.param('id')))))
  .get('/tasks/:id/notes/:slug', (c) => viaBridge(c, NOTES_STORE, (store) => store.read(taskLocation(c.req.param('id')), c.req.param('slug'))))
  .post('/tasks/:id/notes', async (c) => {
    const parsed = createBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, NOTES_STORE, (store) => store.create(taskLocation(c.req.param('id')), parsed.data.title, { kind: parsed.data.kind as NoteKind | undefined }))
  })
  .put('/tasks/:id/notes/:slug', async (c) => {
    const parsed = writeBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, NOTES_STORE, (store) => store.write(taskLocation(c.req.param('id')), c.req.param('slug'), parsed.data.body))
  })
  .post('/tasks/:id/notes/:slug/included', async (c) => {
    const parsed = includedBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, NOTES_STORE, (store) => store.setIncluded(taskLocation(c.req.param('id')), c.req.param('slug'), parsed.data.included))
  })
  .post('/tasks/:id/notes/:slug/title', async (c) => {
    const parsed = titleBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, NOTES_STORE, (store) => store.setTitle(taskLocation(c.req.param('id')), c.req.param('slug'), parsed.data.title))
  })
  .delete('/tasks/:id/notes/:slug', (c) => viaBridge(c, NOTES_STORE, (store) => store.remove(taskLocation(c.req.param('id')), c.req.param('slug'))))
