import { pluginChannel } from '@acorn/protocol/plugin/state.ts'
import { randomUUID } from 'node:crypto'
import { and, desc, eq, notInArray } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import { browserCaptures } from '../node/schema'
import type { Capture, CaptureStore } from './driver'
import type { CaptureMetadata } from '../contract/captures'

// The plugin's own capture table, as the driver's narrow store seam (./driver.ts).

// How many captures one task keeps. A screenshot is a few hundred kilobytes and an agent in a loop
// takes a lot of them.
//
// ponytail: newest-N per task, swept on write, because a write is the only moment the count changes.
// If retention ever needs to be a policy, an age or a byte ceiling or an owner setting, it belongs
// beside the other data-retention settings.
const KEEP_PER_TASK = 20

export function captureStore(db: PluginDatabase, emit?: (frame: { channel: string } & Record<string, unknown>) => void): CaptureStore & {
  read(id: string): Promise<Capture | null>
  list(taskId: string): Promise<CaptureMetadata[]>
} {
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
      // The collection is the durable contract: announce it only after the newest-20 sweep, so a
      // subscriber can immediately re-read the exact ordered answer. Keep the id event for one
      // compatibility period while existing consumers migrate.
      emit?.({ channel: pluginChannel('browser', 'captures-changed'), taskId })
      emit?.({ channel: pluginChannel('browser', 'capture-created'), taskId, captureId: id })
      return { id }
    },

    async read(id) {
      const [row] = await db.select().from(browserCaptures).where(eq(browserCaptures.id, id)).limit(1)
      return row ? { id: row.id, taskId: row.taskId, mime: row.mime, bytes: Buffer.from(row.body) } : null
    },

    async list(taskId) {
      return db
        .select({
          id: browserCaptures.id,
          taskId: browserCaptures.taskId,
          mime: browserCaptures.mime,
          bytes: browserCaptures.bytes,
          createdAt: browserCaptures.createdAt,
        })
        .from(browserCaptures)
        .where(eq(browserCaptures.taskId, taskId))
        .orderBy(desc(browserCaptures.createdAt))
    },
  }
}
