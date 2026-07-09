import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import type { ReviewNote } from '../../shared/api'
import { getDb, schema } from '../db'
import type { AppEnv } from '../middleware/auth'
import { respondError } from '../respond'

// Local review notes (docs/panes.md): CRUD over the machine-scoped review_notes table. The send
// loop: create (unsent) → deliver via sendToAgent → POST /sent stamps sentAt → an edit clears it,
// so the UI always shows sent/unsent truthfully. Mounted under /api/tasks.

type Row = typeof schema.reviewNotes.$inferSelect

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

export const reviewNotes = new Hono<AppEnv>()
  .get('/:id/review-notes', async (c) => {
    const db = getDb(c.env)
    const rows = await db.select().from(schema.reviewNotes).where(eq(schema.reviewNotes.taskId, c.req.param('id'))).orderBy(schema.reviewNotes.createdAt)
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
    const db = getDb(c.env)
    const [t] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId))
    if (!t) return respondError(c, 404, 'not_found')
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
    await db.insert(schema.reviewNotes).values(row)
    return c.json(rowToNote(row))
  })
  // Edit clears sentAt (orca's pattern) — an edited note is unsent again.
  .patch('/:id/review-notes/:noteId', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { body?: string }
    if (!body.body?.trim()) return respondError(c, 400, 'bad_request')
    const db = getDb(c.env)
    await db
      .update(schema.reviewNotes)
      .set({ body: body.body.trim(), sentAt: null })
      .where(and(eq(schema.reviewNotes.id, c.req.param('noteId')), eq(schema.reviewNotes.taskId, c.req.param('id'))))
    return c.json({ ok: true })
  })
  .delete('/:id/review-notes/:noteId', async (c) => {
    const db = getDb(c.env)
    await db
      .delete(schema.reviewNotes)
      .where(and(eq(schema.reviewNotes.id, c.req.param('noteId')), eq(schema.reviewNotes.taskId, c.req.param('id'))))
    return c.json({ ok: true })
  })
  // Stamp sentAt on confirmed delivery (the send loop's final step).
  .post('/:id/review-notes/sent', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { ids?: string[] }
    const ids = (body.ids ?? []).filter((x): x is string => typeof x === 'string')
    if (!ids.length) return respondError(c, 400, 'bad_request')
    const db = getDb(c.env)
    await db
      .update(schema.reviewNotes)
      .set({ sentAt: Date.now() })
      .where(and(eq(schema.reviewNotes.taskId, c.req.param('id')), inArray(schema.reviewNotes.id, ids)))
    return c.json({ ok: true })
  })
