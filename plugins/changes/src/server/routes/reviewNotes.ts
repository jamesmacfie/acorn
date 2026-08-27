import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
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

// A note anchors to a range in a diff, so `endLine >= startLine` is part of the shape rather than a
// follow-up check: a note that ends before it starts is not a note. `endLine` defaults to `startLine`
// for the single-line case the client sends most often.
const noteBody = z
  .object({
    path: z.string().min(1),
    side: z.enum(['additions', 'deletions']),
    startLine: z.number().int().min(1),
    endLine: z.number().int().min(1).optional(),
    snippet: z.string().nullish(),
    body: z.string(),
  })
  .transform((note) => ({ ...note, endLine: note.endLine ?? note.startLine }))
  .refine((note) => note.endLine >= note.startLine, { message: 'endLine must not precede startLine' })

const editBody = z.object({ body: z.string() })
const sentBody = z.object({ ids: z.array(z.string()).default([]) })

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
      const parsed = noteBody.safeParse(await c.req.json().catch(() => null))
      if (!parsed.success || !parsed.data.body.trim()) return respondError(c, 400, 'bad_request')
      const note = parsed.data
      if (!(await core.tasks.load(taskId))) return respondError(c, 404, 'not_found')
      const row: Row = {
        id: randomUUID(),
        taskId,
        path: note.path,
        side: note.side,
        startLine: note.startLine,
        endLine: note.endLine,
        snippet: note.snippet ?? null,
        body: note.body.trim(),
        sentAt: null,
        createdAt: Date.now(),
      }
      await db.insert(reviewNotesTable).values(row)
      return c.json(rowToNote(row))
    })
    // Edit clears sentAt, so an edited note counts as unsent again (orca's pattern).
    .patch('/:id/review-notes/:noteId', async (c) => {
      const parsed = editBody.safeParse(await c.req.json().catch(() => null))
      if (!parsed.success || !parsed.data.body.trim()) return respondError(c, 400, 'bad_request')
      await db
        .update(reviewNotesTable)
        .set({ body: parsed.data.body.trim(), sentAt: null })
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
      const parsed = sentBody.safeParse(await c.req.json().catch(() => null))
      const ids = parsed.success ? parsed.data.ids : []
      if (!ids.length) return respondError(c, 400, 'bad_request')
      await db
        .update(reviewNotesTable)
        .set({ sentAt: Date.now() })
        .where(and(eq(reviewNotesTable.taskId, c.req.param('id')), inArray(reviewNotesTable.id, ids)))
      return c.json({ ok: true })
    })
