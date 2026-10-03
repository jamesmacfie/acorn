// Review notes written straight into this plugin's table, for the large-surface fixture
// (docs/testing/desktop.md § The large-surface fixture). The same row the POST route writes, minus the task
// lookup: the seeder writes the task into core itself and runs before the node is up.
//
// Test scaffolding: imported by tests and the agent-automation seeder only.
import { randomUUID } from 'node:crypto'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import { reviewNotes } from '../node/schema'

export type SeedReviewNote = { path: string; side: 'additions' | 'deletions'; line: number; snippet: string | null; body: string }

/** Insert the notes unsent, in order, in batches small enough for one statement each. */
export async function seedReviewNotes(db: PluginDatabase, taskId: string, notes: readonly SeedReviewNote[]): Promise<number> {
  const created = Date.now()
  const rows = notes.map((note, index) => ({
    id: randomUUID(),
    taskId,
    path: note.path,
    side: note.side,
    startLine: note.line,
    endLine: note.line,
    snippet: note.snippet,
    body: note.body,
    sentAt: null,
    createdAt: created + index,
  }))
  for (let start = 0; start < rows.length; start += 100) await db.insert(reviewNotes).values(rows.slice(start, start + 100))
  return rows.length
}
