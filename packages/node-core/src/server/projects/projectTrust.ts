// Trusting a project (docs/workspaces-and-tasks/projects.md § Untrusted projects). Loaded on first use,
// to stay inside the service boot budget (apps/node/scripts/check-service-budget.mjs).
import { eq } from 'drizzle-orm'
import { schema, type AppDatabase } from '../db'
import { broadcastProjectChanged } from '../notify'

/** Marks the project trusted, and says whether there was such a project. Sessions and tasks that
 *  started before keep how they started. */
export async function trustProject(db: AppDatabase, projectId: string): Promise<boolean> {
  const [row] = await db
    .update(schema.projects)
    .set({ trusted: true, updatedAt: Date.now() })
    .where(eq(schema.projects.id, projectId))
    .returning()
  if (row) broadcastProjectChanged({ projectId })
  return !!row
}
