// The task read seam (CoreServices.tasks). Plugins hold task IDs and ask core to resolve them through
// this service; database handles remain private to their owning layer.
import { and, eq, isNull, max, or, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { dedupeBranch, slugifyBranch } from '@acorn/protocol/branch.ts'
import type { LayoutRecipe, RunTarget } from '../../runConfig'
import type { AppDatabase } from '../../../server/db'
import { schema } from '../../../server/db'
import { broadcastStatus } from '../../notify'
import { loadTask, projectForTask, resolveTaskCwd, TASK_REF_COLUMNS, taskRoot, taskRunConfig, toTaskRef, workspaceIdFor, type TaskRef } from '../../taskWorktree'
import { normalizeGithubPart } from '../../projects'
import type { CapabilityRegistry } from '../../../server/plugin/capabilities'

// What `taskRunConfig` answers: the merged run-target config plus the cwd to run it in. Restated as a
// named type because it is now a CoreServices return value rather than an internal helper's.
export type TaskRunConfig =
  | { targets: RunTarget[]; cwd: string; errors: { source: string; message: string }[]; layouts: LayoutRecipe[]; repoTargetIds: string[] }
  | { error: string }

// The three columns a `task_links` row is actually read for outside core: which provider, through
// which stored connection, under which identifier. This is narrower than the row: `refJson` is
// parsed through the integration provider registry (server/routes/tasks.ts), which is core's job,
// not a consumer's.
export type TaskLinkRef = { provider: string; integrationId: string; identifier: string }

// What a fan-out child needs to exist at all. `branch` is a suggestion, not a value: it is slugged and
// de-duped against every existing task before it is written, because two children of the same plan
// routinely propose the same name.
export type ChildTaskSeed = { title: string; branch: string }

export type TaskService = {
  // The task's plugin-facing projection (main/taskWorktree.ts § TaskRef), or undefined when the id
  // does not resolve, the "validated by the owning plugin" half of a plain-id reference. A TaskRef,
  // not the `tasks` row (docs/plugins.md § What is published, and what acorn promises about it).
  load(taskId: string): Promise<TaskRef | undefined>
  // The task's worktree root, resolving through the project checkout and creating the worktree
  // lazily if needed. null when no checkout is mapped.
  //
  // `userId` is not decoration: creating a worktree consults the per-project base-ref preference,
  // which is user-owned state, and a missing identity fails closed to git's origin/main fallback
  // rather than selecting another login's preference. A caller that has an authorizing identity
  // (plugins/http's send resolves it from the request principal) must pass it.
  root(taskId: string, userId?: string | null): Promise<string | null>
  // The cwd a task's commands run in, creating the worktree on first use
  // (docs/workspaces-and-tasks.md § Worktrees and setup). Takes the row rather than the id because
  // the one caller, plugins/terminal's spawn path, already loaded it to derive the session's
  // project/PR context, and re-reading would be a second query across a database boundary.
  //
  // `userId` carries the same weight it does on `root` above: worktree creation consults the
  // per-repo `base_ref` preference, which is user-owned. A caller that has an authorizing identity
  // (the workflow runner resolves it from the node's active owner identity) passes it, and one that
  // does not (terminal's spawn path, which runs for whoever is at the keyboard) omits it and gets
  // git's fallback.
  resolveCwd(task: TaskRef | undefined, baseCheckout: string | undefined, userId?: string | null): Promise<{ cwd: string; isWorktree: boolean; created: boolean }>
  // Run targets + cwd for a task: project settings merged with the project's committed
  // `.acorn/config.toml`. plugins/terminal's RuntimeService is the only consumer, and it cannot read
  // either source itself: one is a core table, the other needs the lazily-created worktree.
  runConfig(taskId: string): Promise<TaskRunConfig>
  // Every non-archived task. Two plugins need the whole set rather than one id: docker matches every
  // live container against every active task's worktree/branch to build the rail badge, and memory
  // reconciles its file index from every active worktree. The union of what those two read (docker:
  // id/worktreePath/branch; memory: worktreePath/projectId) is a subset of TaskRef, so they get refs
  // like every other reader; `status` stays core's because the filter is already applied here.
  active(): Promise<TaskRef[]>
  // The workspace a task belongs to, resolved task → project → workspace membership. Throws when the task or
  // its membership is missing, because the one caller (plugins/notes' `notes_*` tools with
  // `scope: 'workspace'`) has no meaningful degraded answer: a workspace-scoped note has to land in a
  // directory named after a real workspace, and inventing one would silently write notes nobody reads.
  //
  workspaceId(taskId: string): Promise<string>
  // The same lookup, with "no workspace" as a value rather than a throw.
  //
  // Added for plugins/notes' context section, which walks task → workspace → global and must skip
  // the middle scope when the task's project has no workspace yet. It was written as
  // `ctx.core.tasks.workspaceId(taskId).catch(() => null)`, and that catch is too wide: `workspaceId`
  // throws for "task not found", for "no membership", and for any genuine database failure, so a
  // broken query degraded into "this task has no workspace" and every included workspace note
  // silently vanished from the prompt with no error anywhere. A prompt quietly missing its context
  // is the worst kind of failure this seam can produce.
  //
  // So null means the two answers that really are "no workspace", and a real failure still throws.
  // This stays a second method rather than a change to `workspaceId`'s signature, because the
  // `notes_*` tools' caller has no degraded answer at all: a workspace-scoped note must land in a
  // directory named after a real workspace, and making the type nullable there would push a decision
  // onto a call site that has already made it.
  workspaceIdOrNull(taskId: string): Promise<string | null>
  // The inverse of `workspaceId`: return every task id in a workspace. Callers use the IDs to filter
  // their own data, and an empty array means the workspace has no tasks.
  //
  // Not status-filtered. The joins it replaces had no `status` predicate either: an archived task's
  // agent transcripts still belong to the workspace, and the session's own `archivedAt` is what the
  // list and search queries filter on.
  idsForWorkspace(workspaceId: string): Promise<string[]>
  // The external tickets/errors linked to a task (`task_links`). plugins/notes' seeding pass renders one
  // note per linked Linear ticket, and it needs the connection id as well as the identifier: the same
  // ticket reachable through two Linear connections is two different rows, and refetching it needs to
  // name which one.
  links(taskId: string): Promise<TaskLinkRef[]>
  adoptPullNumbers(repoOwner: string, repoName: string, branchToPull: ReadonlyMap<string, number>): Promise<number>
  // Materialise a fan-out child task under a parent (docs/workflows.md) and return its id. Its
  // worktree is not created here: `resolveCwd` does that lazily the moment the child's first step
  // runs, the same path every other surface takes.
  //
  // A write on CoreServices: plugins ask core to create a task rather than writing core-owned rows.
  // Throws when the parent does not resolve.
  createChild(parentTaskId: string, seed: ChildTaskSeed): Promise<string>
  // Cancel a task, the child-task half of cancelling a fan-out run. A distinct verb rather than a
  // general `setStatus`, so the seam cannot become a way for a plugin to archive or restore a task
  // outside core's own routes.
  cancel(taskId: string): Promise<void>
}

export function createTaskService(db: AppDatabase, capabilities?: Pick<CapabilityRegistry, 'get'>): TaskService {
  return {
    adoptPullNumbers: async (repoOwner, repoName, branchToPull) => {
      if (!branchToPull.size) return 0
      const candidates = await db
        .select({ id: schema.tasks.id, branch: schema.tasks.branch })
        .from(schema.tasks)
        .leftJoin(schema.projects, eq(schema.projects.id, schema.tasks.projectId))
        .where(
          and(
            // Adoption is a GitHub-domain operation: every local project clone with this facet
            // participates, rather than only the oldest project.
            and(
              sql`lower(${schema.projects.githubOwner}) = ${normalizeGithubPart(repoOwner)}`,
              sql`lower(${schema.projects.githubName}) = ${normalizeGithubPart(repoName)}`,
            ),
            eq(schema.tasks.status, 'active'),
            isNull(schema.tasks.pullNumber),
          ),
        )
      const now = Date.now()
      const updates = candidates.flatMap((task) => {
        const pullNumber = task.branch ? branchToPull.get(task.branch) : undefined
        return pullNumber == null
          ? []
          : [db.update(schema.tasks).set({ pullNumber, updatedAt: now }).where(eq(schema.tasks.id, task.id))]
      })
      if (!updates.length) return 0
      // One batch within core's file, which is all the atomicity docs/data-layer.md permits here.
      await db.batch(updates as [(typeof updates)[number], ...(typeof updates)[number][]])
      return updates.length
    },
    load: async (taskId) => {
      const row = await loadTask(db, taskId)
      return row && toTaskRef(row)
    },
    root: (taskId, userId = null) => taskRoot(db, taskId, userId, capabilities),
    resolveCwd: (task, baseCheckout, userId = null) => resolveTaskCwd(db, task, baseCheckout, userId, capabilities),
    runConfig: (taskId) => taskRunConfig(db, taskId, capabilities),
    active: () => db.select(TASK_REF_COLUMNS).from(schema.tasks).where(eq(schema.tasks.status, 'active')),
    workspaceId: (taskId) => workspaceIdFor(db, taskId),
    // Built from the same two queries as `workspaceIdFor` rather than by catching its throw: catching cannot tell
    // "no membership" from "the database is broken", which is the whole point of this method existing.
    workspaceIdOrNull: async (taskId) => {
      const task = await loadTask(db, taskId)
      if (!task) return null
      const project = await projectForTask(db, task)
      return project?.workspaceId ?? null
    },
    idsForWorkspace: async (workspaceId) => {
      const projectIds = (await db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.workspaceId, workspaceId))).map((row) => row.id)
      const projectTasks = projectIds.length
        ? await db.selectDistinct({ id: schema.tasks.id }).from(schema.tasks).where(or(...projectIds.map((id) => eq(schema.tasks.projectId, id))))
        : []
      return projectTasks.map((row) => row.id)
    },
    links: (taskId) =>
      db
        .select({ provider: schema.taskLinks.provider, integrationId: schema.taskLinks.integrationId, identifier: schema.taskLinks.identifier })
        .from(schema.taskLinks)
        .where(eq(schema.taskLinks.taskId, taskId)),
    createChild: async (parentTaskId, seed) => {
      const parent = await loadTask(db, parentTaskId)
      if (!parent) throw new Error('Parent task not found.')
      const project = await projectForTask(db, parent)
      if (!project) throw new Error('Parent task has no project.')
      // Branch names are de-duped against every task, not just this parent's children: a worktree is
      // keyed on the branch, so a collision with an unrelated task would hand two tasks one checkout.
      const existing = (await db.select({ branch: schema.tasks.branch }).from(schema.tasks)).flatMap((row) => row.branch ? [row.branch] : [])
      const branch = project.vcs === 'git'
        ? dedupeBranch(slugifyBranch(seed.branch || seed.title) || `child-${parentTaskId.slice(0, 8)}`, existing)
        : null
      const [{ value }] = await db.select({ value: max(schema.tasks.sort) }).from(schema.tasks)
      const id = randomUUID()
      const at = Date.now()
      await db.insert(schema.tasks).values({
        id,
        title: seed.title,
        origin: 'local',
        // A child works in the parent's repo by definition, so it inherits the project id too.
        projectId: project.id,
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
