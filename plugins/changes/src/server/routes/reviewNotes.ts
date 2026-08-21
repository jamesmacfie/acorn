import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import type { ReviewNote } from '../../shared/api'
import { type AppEnv, type CoreServices, type PluginDatabase, respondError } from '@acorn/plugin-api/node'
import { reviewNotes as reviewNotesTable } from '../../node/schema'

// CRUD over this plugin's review_notes table, mounted under /v2/p/changes/tasks. The send loop:
// create as unsent, deliver via sendToAgent, POST /sent stamps sentAt, and an edit clears it again,
// so the UI always shows sent/unsent truthfully.
//
// A factory over the plugin's own database, not a module-scope router reading getDb(c.env); see
// docs/data-layer.md § Plugin databases.

type Row = typeof reviewNotesTable.$inferSelect

const rowToNote = (r: Row): ReviewNote => ({
  id: r.id,
  taskId: r.taskId,
  path: r.path,
  side: r.side as ReviewNote['side'],
  startLine: r.startLine,
  endLine: r.endLine,
  snippet: r.snippet,
  body: r.body,
  sentAt: r.sentAt,
  createdAt: r.createdAt,
})

export const reviewNotesRoutes = (db: PluginDatabase, core: Pick<CoreServices, 'tasks'>) =>
  new Hono<AppEnv>()
    .get('/:id/review-notes', async (c) => {
      const rows = await db.select().from(reviewNotesTable).where(eq(reviewNotesTable.taskId, c.req.param('id'))).orderBy(reviewNotesTable.createdAt)
      return c.json(rows.map(rowToNote))
    })
    .post('/:id/review-notes', async (c) => {
      const taskId = c.req.param('id')
      const body = (await c.req.json().catch(() => ({}))) as Partial<ReviewNote>
      const startLine = Number(body.startLine)
      const endLine = Number(body.endLine ?? body.startLine)
      if (
        !body.path ||
        typeof body.path !== 'string' ||
        (body.side !== 'additions' && body.side !== 'deletions') ||
        !Number.isInteger(startLine) ||
        startLine < 1 ||
        !Number.isInteger(endLine) ||
        endLine < startLine ||
        !body.body?.trim()
      )
        return respondError(c, 400, 'bad_request')
      if (!(await core.tasks.load(taskId))) return respondError(c, 404, 'not_found')
      const row: Row = {
        id: randomUUID(),
        taskId,
        path: body.path,
        side: body.side,
        startLine,
        endLine,
        snippet: typeof body.snippet === 'string' ? body.snippet : null,
        body: body.body.trim(),
        sentAt: null,
        createdAt: Date.now(),
      }
      await db.insert(reviewNotesTable).values(row)
      return c.json(rowToNote(row))
    })
    // Edit clears sentAt, so an edited note counts as unsent again (orca's pattern).
    .patch('/:id/review-notes/:noteId', async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as { body?: string }
      if (!body.body?.trim()) return respondError(c, 400, 'bad_request')
      await db
        .update(reviewNotesTable)
        .set({ body: body.body.trim(), sentAt: null })
        .where(and(eq(reviewNotesTable.id, c.req.param('noteId')), eq(reviewNotesTable.taskId, c.req.param('id'))))
      return c.json({ ok: true })
    })
    .delete('/:id/review-notes/:noteId', async (c) => {
      await db
        .delete(reviewNotesTable)
        .where(and(eq(reviewNotesTable.id, c.req.param('noteId')), eq(reviewNotesTable.taskId, c.req.param('id'))))
      return c.json({ ok: true })
    })
    // Stamp sentAt on confirmed delivery (the send loop's final step).
    .post('/:id/review-notes/sent', async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as { ids?: string[] }
      const ids = (body.ids ?? []).filter((x): x is string => typeof x === 'string')
      if (!ids.length) return respondError(c, 400, 'bad_request')
      await db
        .update(reviewNotesTable)
        .set({ sentAt: Date.now() })
        .where(and(eq(reviewNotesTable.taskId, c.req.param('id')), inArray(reviewNotesTable.id, ids)))
      return c.json({ ok: true })
    })
