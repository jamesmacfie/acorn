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
import type { LayoutRecipe, RunTarget } from '../runConfig'
import type { AppDatabase } from '../../server/db'
import { schema } from '../../server/db'
import { loadTask, resolveTaskCwd, taskRoot, taskRunConfig, type TaskRow } from '../taskWorktree'

// What `taskRunConfig` answers: the merged run-target config plus the cwd to run it in. Restated as a
// named type because it is now a CoreServices return value rather than an internal helper's.
export type TaskRunConfig =
  | { targets: RunTarget[]; cwd: string; errors: { source: string; message: string }[]; layouts: LayoutRecipe[]; repoTargetIds: string[] }
  | { error: string }

export type TaskService = {
  // The tasks row, or undefined when the id does not resolve — the "validated by the owning plugin"
  // half of a plain-ID reference.
  load(taskId: string): Promise<TaskRow | undefined>
  // The task's worktree root, resolving through the repo→checkout mapping and creating the worktree
  // lazily if needed. null when no checkout is mapped.
  //
  // `userId` is not decoration: creating a worktree consults the per-repo `base_ref:<owner>/<repo>`
  // preference, which is user-owned state, and a missing identity fails closed to git's origin/main
  // fallback rather than selecting another login's preference. Callers that HAVE an authorizing
  // identity (plugins/http's send resolves it from the request principal) must pass it.
  root(taskId: string, userId?: string | null): Promise<string | null>
  // The cwd a task's commands run in, creating the worktree on first use (docs/workspaces-and-tasks.md
  // Flow C). Takes the row rather than the id because the one caller — plugins/terminal's spawn path —
  // already loaded it to derive the session's repo/PR context, and re-reading would be a second query
  // across a database boundary.
  resolveCwd(task: TaskRow | undefined, baseCheckout: string | undefined): Promise<{ cwd: string; isWorktree: boolean; created: boolean }>
  // Run targets + cwd for a task: `repo_paths` settings merged with the repo's committed
  // `.acorn/config.toml`. plugins/terminal's RuntimeService is the only consumer, and it cannot read
  // either source itself — one is a core table, the other needs the lazily-created worktree.
  runConfig(taskId: string): Promise<TaskRunConfig>
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
    root: (taskId, userId = null) => taskRoot(db, taskId, userId),
    resolveCwd: (task, baseCheckout) => resolveTaskCwd(db, task, baseCheckout),
    runConfig: (taskId) => taskRunConfig(db, taskId),
    active: () => db.select().from(schema.tasks).where(eq(schema.tasks.status, 'active')),
  }
}
