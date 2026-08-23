import { randomUUID } from 'node:crypto'
import { and, desc, eq, notInArray } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import { browserCaptures } from '../node/schema'
import type { Capture, CaptureStore } from './driver'

// The plugin's own capture table, as the driver's narrow store seam (./driver.ts).

// How many captures one task keeps. A screenshot is a few hundred kilobytes and an agent in a loop
// takes a lot of them, so the newest few are the evidence and the rest are noise on the owner's disk.
//
// ponytail: newest-N per task, swept on write, because the write is the only moment the count can
// change. If retention ever needs to be a policy — an age, a byte ceiling, an owner setting — it
// belongs beside the other data-retention settings rather than here.
const KEEP_PER_TASK = 20

export function captureStore(db: PluginDatabase): CaptureStore & { read(id: string): Promise<Capture | null> } {
  return {
    async put({ taskId, mime, bytes }) {
      const id = randomUUID()
      await db.insert(browserCaptures).values({ id, taskId, mime, bytes: bytes.byteLength, body: bytes, createdAt: Date.now() })
      const keep = await db
        .select({ id: browserCaptures.id })
        .from(browserCaptures)
        .where(eq(browserCaptures.taskId, taskId))
        .orderBy(desc(browserCaptures.createdAt))
        .limit(KEEP_PER_TASK)
      await db.delete(browserCaptures).where(and(eq(browserCaptures.taskId, taskId), notInArray(browserCaptures.id, keep.map((row) => row.id))))
      return { id }
    },

    async read(id) {
      const [row] = await db.select().from(browserCaptures).where(eq(browserCaptures.id, id)).limit(1)
      return row ? { id: row.id, taskId: row.taskId, mime: row.mime, bytes: Buffer.from(row.body) } : null
    },
  }
}
