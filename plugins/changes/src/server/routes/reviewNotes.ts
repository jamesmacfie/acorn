import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import type { ReviewNote } from '@acorn/protocol/api.ts'
import type { CoreServices } from '@acorn/node-core/main/core/index.ts'
import type { PluginDatabase } from '@acorn/node-core/main/pluginStorage.ts'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import { respondError } from '@acorn/node-core/server/respond.ts'
import { reviewNotes as reviewNotesTable } from '../../node/schema'

// Local review notes (docs/panes.md): CRUD over this plugin's review_notes table. The send loop:
// create (unsent) → deliver via sendToAgent → POST /sent stamps sentAt → an edit clears it, so the UI
// always shows sent/unsent truthfully. Mounted under /v2/p/changes/tasks.
//
// A FACTORY over the plugin's own database, not a module-scope router reading getDb(c.env). Two
// reasons: the table lives in <data-root>/plugins/changes.sqlite now, and c.env deliberately does not
// carry per-plugin handles (docs/data-layer.md § Plugin DBs). The handle arrives at plugin init, so
// there is no request that can reach an unmigrated database.

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
    // Edit clears sentAt (orca's pattern) — an edited note is unsent again.
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
