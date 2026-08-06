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
import { eq, max } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { dedupeBranch, slugifyBranch } from '@acorn/protocol/branch.ts'
import type { LayoutRecipe, RunTarget } from '../runConfig'
import type { AppDatabase } from '../../server/db'
import { schema } from '../../server/db'
import { broadcastStatus } from '../notify'
import { loadTask, resolveTaskCwd, taskRoot, taskRunConfig, workspaceIdFor, type TaskRow } from '../taskWorktree'

// What `taskRunConfig` answers: the merged run-target config plus the cwd to run it in. Restated as a
// named type because it is now a CoreServices return value rather than an internal helper's.
export type TaskRunConfig =
  | { targets: RunTarget[]; cwd: string; errors: { source: string; message: string }[]; layouts: LayoutRecipe[]; repoTargetIds: string[] }
  | { error: string }

// The three columns a `task_links` row is actually read for outside core: which provider, through which
// stored connection, under which identifier. Deliberately narrower than the row — `refJson` is parsed
// through the integration provider registry (server/routes/tasks.ts), which is core's job, not a
// consumer's.
export type TaskLinkRef = { provider: string; integrationId: string; identifier: string }

// What a fan-out child needs to exist at all. `branch` is a suggestion, not a value: it is slugged and
// de-duped against every existing task before it is written, because two children of the same plan
// routinely propose the same name.
export type ChildTaskSeed = { title: string; branch: string }

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
  //
  // `userId` carries the same weight it does on `root` above — worktree creation consults the per-repo
  // `base_ref` preference, which is user-owned — so a caller that HAS an authorizing identity (the
  // workflow runner resolves it from the node's active GitHub identity) passes it, and one that does not
  // (terminal's spawn path, which runs for whoever is at the keyboard) omits it and gets git's fallback.
  resolveCwd(task: TaskRow | undefined, baseCheckout: string | undefined, userId?: string | null): Promise<{ cwd: string; isWorktree: boolean; created: boolean }>
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
  // The workspace a task belongs to, resolved task → repo → `workspace_repos`. Throws when the task or
  // its membership is missing, because the one caller (plugins/notes' `notes_*` tools with
  // `scope: 'workspace'`) has no meaningful degraded answer: a workspace-scoped note has to land in a
  // directory named after a real workspace, and inventing one would silently write notes nobody reads.
  //
  // This is the seam whose absence was the second of the two blockers recorded against moving those
  // tools out of apps/node/src/wiring/agentToolsWiring.ts.
  workspaceId(taskId: string): Promise<string>
  // The external tickets/errors linked to a task (`task_links`). plugins/notes' seeding pass renders one
  // note per linked Linear ticket, and it needs the connection id as well as the identifier: the same
  // ticket reachable through two Linear connections is two different rows, and refetching it needs to
  // name which one.
  links(taskId: string): Promise<TaskLinkRef[]>
  // Materialise a fan-out child task under a parent (docs/workflows.md, 14 P4) and return its id. Its
  // worktree is deliberately NOT created here — `resolveCwd` does that lazily the moment the child's
  // first step runs, which is the same path every other surface takes.
  //
  // A WRITE on CoreServices, unlike everything above it, and that is the point: `tasks` is core's table,
  // so a plugin that wants a task to exist asks core to create it rather than inserting into a file it
  // has no handle to. Throws when the parent does not resolve.
  createChild(parentTaskId: string, seed: ChildTaskSeed): Promise<string>
  // Cancel a task — the child-task half of cancelling a fan-out run. A distinct verb rather than a
  // general `setStatus`, so the seam cannot become a way for a plugin to archive or un-archive a task
  // behind core's lifecycle routes.
  cancel(taskId: string): Promise<void>
}

export function createTaskService(db: AppDatabase): TaskService {
  return {
    load: (taskId) => loadTask(db, taskId),
    root: (taskId, userId = null) => taskRoot(db, taskId, userId),
    resolveCwd: (task, baseCheckout, userId = null) => resolveTaskCwd(db, task, baseCheckout, userId),
    runConfig: (taskId) => taskRunConfig(db, taskId),
    active: () => db.select().from(schema.tasks).where(eq(schema.tasks.status, 'active')),
    workspaceId: (taskId) => workspaceIdFor(db, taskId),
    links: (taskId) =>
      db
        .select({ provider: schema.taskLinks.provider, integrationId: schema.taskLinks.integrationId, identifier: schema.taskLinks.identifier })
        .from(schema.taskLinks)
        .where(eq(schema.taskLinks.taskId, taskId)),
    createChild: async (parentTaskId, seed) => {
      const parent = await loadTask(db, parentTaskId)
      if (!parent) throw new Error('Parent task not found.')
      // Branch names are de-duped against EVERY task, not just this parent's children: a worktree is
      // keyed on the branch, so a collision with an unrelated task would hand two tasks one checkout.
      const existing = (await db.select({ branch: schema.tasks.branch }).from(schema.tasks)).map((row) => row.branch)
      const branch = dedupeBranch(slugifyBranch(seed.branch || seed.title) || `child-${parentTaskId.slice(0, 8)}`, existing)
      const [{ value }] = await db.select({ value: max(schema.tasks.sort) }).from(schema.tasks)
      const id = randomUUID()
      const at = Date.now()
      await db.insert(schema.tasks).values({
        id,
        title: seed.title,
        origin: 'local',
        repoOwner: parent.repoOwner,
        repoName: parent.repoName,
        branch,
        pullNumber: null,
        worktreePath: null,
        status: 'active',
        parentId: parentTaskId,
        sort: (value ?? -1) + 1,
        createdAt: at,
        updatedAt: at,
        archivedAt: null,
      })
      broadcastStatus()
      return id
    },
    cancel: async (taskId) => {
      await db.update(schema.tasks).set({ status: 'cancelled', updatedAt: Date.now() }).where(eq(schema.tasks.id, taskId))
      broadcastStatus()
    },
  }
}
