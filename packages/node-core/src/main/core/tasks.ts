// The task read seam (CoreServices.tasks). `tasks` is a CORE table, and before the database split
// nine plugins reached into it directly with `db.select().from(schema.tasks)` — which worked only
// because every plugin shared one SQLite file. Once each plugin owns its own file, a plugin cannot
// query core's tables at all (docs/vNext/data.md § Plugin DBs: "No cross-DB queries, no ATTACH…
// Cross-plugin references are plain IDs, validated by the owning plugin when dereferenced").
//
// So this is that validation seam: a plugin holds a taskId and asks core to resolve it.
//
// Deliberately NOT here yet: an `idsForWorkspace` for the three agents joins
// (`agent_sessions ⋈ tasks ⋈ workspace_repos`, the only real cross-DB joins in the codebase). It was
// written, had no caller — agents is not converted — and was removed. It belongs in the commit that
// converts agents, where its shape can be driven by the query that needs it rather than guessed.
import { eq } from 'drizzle-orm'
import type { AppDatabase } from '../../server/db'
import { schema } from '../../server/db'
import { loadTask, taskRoot, type TaskRow } from '../taskWorktree'

export type TaskService = {
  // The tasks row, or undefined when the id does not resolve — the "validated by the owning plugin"
  // half of a plain-ID reference.
  load(taskId: string): Promise<TaskRow | undefined>
  // The task's worktree root, resolving through the repo→checkout mapping and creating the worktree
  // lazily if needed. null when no checkout is mapped.
  root(taskId: string): Promise<string | null>
  // Every non-archived task. Two plugins need the whole set rather than one id: docker matches every
  // live container against every active task's worktree/branch to build the rail badge, and memory
  // reconciles its file index from every active worktree. Full rows because those two read different
  // columns (docker: id/worktreePath/branch; memory: worktreePath/repoOwner/repoName) and a narrowed
  // projection would just be the union of both.
  active(): Promise<TaskRow[]>
}

export function createTaskService(db: AppDatabase): TaskService {
  return {
    load: (taskId) => loadTask(db, taskId),
    root: (taskId) => taskRoot(db, taskId),
    active: () => db.select().from(schema.tasks).where(eq(schema.tasks.status, 'active')),
  }
}
