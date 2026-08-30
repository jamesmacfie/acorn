import { pluginChannel } from '@acorn/protocol/plugin/state.ts'
import { randomUUID } from 'node:crypto'
import { and, desc, eq, notInArray } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import { browserCaptures } from '../node/schema'
import type { Capture, CaptureStore } from './driver'

// The plugin's own capture table, as the driver's narrow store seam (./driver.ts).

// How many captures one task keeps. A screenshot is a few hundred kilobytes and an agent in a loop
// takes a lot of them.
//
// ponytail: newest-N per task, swept on write, because a write is the only moment the count changes.
// If retention ever needs to be a policy, an age or a byte ceiling or an owner setting, it belongs
// beside the other data-retention settings.
const KEEP_PER_TASK = 20

export function captureStore(db: PluginDatabase, emit?: (frame: { channel: string } & Record<string, unknown>) => void): CaptureStore & { read(id: string): Promise<Capture | null> } {
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
      // ponytail: no page url in the payload; the store never sees one. Add it when a consumer asks.
      emit?.({ channel: pluginChannel('browser', 'capture-created'), taskId, captureId: id })
      return { id }
    },

    async read(id) {
      const [row] = await db.select().from(browserCaptures).where(eq(browserCaptures.id, id)).limit(1)
      return row ? { id: row.id, taskId: row.taskId, mime: row.mime, bytes: Buffer.from(row.body) } : null
    },
  }
}
