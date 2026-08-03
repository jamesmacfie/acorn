// The task read seam (CoreServices.tasks). `tasks` is a CORE table, and before the database split
// nine plugins reached into it directly with `db.select().from(schema.tasks)` — which worked only
// because every plugin shared one SQLite file. Once each plugin owns its own file, a plugin cannot
// query core's tables at all (docs/vNext/data.md § Plugin DBs: "No cross-DB queries, no ATTACH…
// Cross-plugin references are plain IDs, validated by the owning plugin when dereferenced").
//
// So this is that validation seam: a plugin holds a taskId and asks core to resolve it.
//
// `idsForWorkspace` exists for one specific query shape. The agents plugin had three real SQL joins —
// `agent_sessions ⋈ tasks ⋈ workspace_repos`, all to answer "sessions in workspace X" — and those are
// the only cross-DB joins in the codebase. They become an id round trip: resolve the workspace's task
// ids in core, then `inArray` inside the plugin's own database.
import { and, eq, or } from 'drizzle-orm'
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
  // Task ids belonging to a workspace, via that workspace's repos. Ordered and de-duplicated so a
  // caller can page over them deterministically.
  idsForWorkspace(workspaceId: string): Promise<string[]>
}

export function createTaskService(db: AppDatabase): TaskService {
  return {
    load: (taskId) => loadTask(db, taskId),
    root: (taskId) => taskRoot(db, taskId),
    idsForWorkspace: async (workspaceId) => {
      const repos = await db
        .select({ owner: schema.workspaceRepos.repoOwner, name: schema.workspaceRepos.repoName })
        .from(schema.workspaceRepos)
        .where(eq(schema.workspaceRepos.workspaceId, workspaceId))
      if (!repos.length) return []
      // One query for the whole workspace rather than one per repo: the pair list is small (a
      // workspace groups a handful of repos) and `tasks` is indexed on (repo_owner, repo_name).
      const rows = await db
        .select({ id: schema.tasks.id })
        .from(schema.tasks)
        .where(or(...repos.map((repo) => and(eq(schema.tasks.repoOwner, repo.owner), eq(schema.tasks.repoName, repo.name)))))
        .orderBy(schema.tasks.createdAt, schema.tasks.id)
      return rows.map((row) => row.id)
    },
  }
}
