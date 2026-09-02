// The task read seam (CoreServices.tasks). Plugins hold task ids and ask core to resolve them here,
// so database handles stay private to their owning layer.
import { and, eq, isNull, max, or, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { dedupeBranch, slugifyBranch } from '@acorn/protocol/branch.ts'
import type { LayoutRecipe, RunTarget } from '../runConfig'
import type { AppDatabase } from '../db'
import { schema } from '../db'
import { broadcastTasksChanged, broadcastWorktreeStatusChanged } from '../notify'
import { loadTask, projectForTask, resolveTaskCwd, TASK_REF_COLUMNS, taskRoot, taskRunConfig, toTaskRef, workspaceIdFor, type TaskRef } from '../worktrees/taskWorktree'
import { normalizeGithubPart } from '../projects'

// What `taskRunConfig` answers: the merged run-target config plus the cwd to run it in. Named,
// because it is a CoreServices return value rather than an internal helper's.
export type TaskRunConfig =
  | { targets: RunTarget[]; cwd: string; errors: { source: string; message: string }[]; layouts: LayoutRecipe[]; repoTargetIds: string[] }
  | { error: string }

// The three columns a `task_links` row is read for outside core: which provider, through which
// stored connection, under which identifier. Narrower than the row, because `refJson` is parsed
// through the integration provider registry, which is core's job.
export type TaskLinkRef = { provider: string; integrationId: string; identifier: string }

// What a fan-out child needs to exist. `branch` is a suggestion: it is slugged and de-duped against
// every existing task before it is written, because two children of one plan often propose the same
// name.
export type ChildTaskSeed = { title: string; branch: string }

export type TaskPullRelation = {
  taskId: string
  repoOwner: string
  repoName: string
  pullNumber: number
  role: 'primary' | 'related'
  provenance: 'agent'
  sessionId: string
  requestId?: string
}

export type AttachTaskPullInput = {
  repoOwner: string
  repoName: string
  pullNumber: number
  sessionId: string
  requestId?: string
}

export type TaskService = {
  // The task's plugin-facing projection (server/worktrees/taskWorktree.ts § TaskRef), or undefined when the id
  // does not resolve. A TaskRef, never the `tasks` row (docs/plugins.md § What is published, and
  // what acorn promises about it).
  load(taskId: string): Promise<TaskRef | undefined>
  // The task's worktree root, resolving through the project checkout and creating the worktree
  // lazily if needed. null when no checkout is mapped.
  //
  // `userId` matters: creating a worktree reads the per-project base-ref preference, which is
  // user-owned, and a missing identity falls back to git's origin/main rather than picking another
  // login's preference. A caller holding an authorizing identity must pass it.
  root(taskId: string, userId?: string | null): Promise<string | null>
  // The cwd a task's commands run in, creating the worktree on first use
  // (docs/workspaces-and-tasks.md § Worktrees and setup). Takes the row rather than the id, because
  // the one caller already loaded it and re-reading would be a second query across a database
  // boundary.
  //
  // `userId` carries the same weight it does on `root`. The workflow runner passes the node's active
  // owner identity. Terminal's spawn path runs for whoever is at the keyboard, omits it, and gets
  // git's fallback.
  resolveCwd(task: TaskRef | undefined, baseCheckout: string | undefined, userId?: string | null): Promise<{ cwd: string; isWorktree: boolean; created: boolean }>
  // Run targets and cwd for a task: project settings merged with the project's committed
  // `.acorn/config.toml`. plugins/terminal's RuntimeService is the only consumer, and it can read
  // neither source itself, since one is a core table and the other needs the lazy worktree.
  runConfig(taskId: string): Promise<TaskRunConfig>
  // Every non-archived task. Two plugins need the whole set rather than one id: docker matches live
  // containers against every active task's worktree and branch for the rail badge, and memory
  // reconciles its file index from every active worktree. What those two read is a subset of
  // TaskRef, so they get refs like every other reader.
  active(): Promise<TaskRef[]>
  // The workspace a task belongs to, resolved task to project to workspace membership. Throws when
  // the task or its membership is missing, because the caller, plugins/notes' `notes_*` tools with
  // `scope: 'workspace'`, has no degraded answer. A workspace-scoped note has to land in a directory
  // named after a real workspace.
  workspaceId(taskId: string): Promise<string>
  // The same lookup, with "no workspace" as a value rather than a throw, for plugins/notes' context
  // section, which walks task to workspace to global and skips the middle scope when the project has
  // no workspace.
  //
  // Do not write this as `workspaceId(taskId).catch(() => null)`. That catch is too wide:
  // `workspaceId` throws for "task not found", for "no membership", and for a database failure, so a
  // broken query degrades into "this task has no workspace" and every workspace note vanishes from
  // the prompt with no error anywhere. Here null means the two answers that really are "no
  // workspace", and a real failure still throws.
  workspaceIdOrNull(taskId: string): Promise<string | null>
  // The inverse of `workspaceId`: every task id in a workspace. Callers filter their own data with
  // the ids, and an empty array means the workspace has no tasks.
  //
  // Not status-filtered. An archived task's agent transcripts still belong to the workspace, and the
  // session's own `archivedAt` is what the list and search queries filter on.
  idsForWorkspace(workspaceId: string): Promise<string[]>
  // The external tickets and errors linked to a task (`task_links`). plugins/notes' seeding pass
  // renders one note per linked Linear ticket, and it needs the connection id as well as the
  // identifier, because the same ticket through two Linear connections is two rows.
  links(taskId: string): Promise<TaskLinkRef[]>
  pulls(taskId: string): Promise<TaskPullRelation[]>
  // Attach a PR created through a task-scoped agent tool. The task's scalar primary remains the
  // operational truth; the first transaction that finds it empty claims it and later creates become
  // related. The durable row retains provenance for both outcomes.
  attachPull(taskId: string, input: AttachTaskPullInput): Promise<TaskPullRelation>
  adoptPullNumbers(repoOwner: string, repoName: string, branchToPull: ReadonlyMap<string, number>): Promise<number>
  // Materialise a fan-out child task under a parent (docs/workflows.md) and return its id. The
  // worktree is not created here. `resolveCwd` does that when the child's first step runs, the same
  // path every other surface takes.
  //
  // A write on CoreServices: plugins ask core to create a task rather than writing core-owned rows.
  // Throws when the parent does not resolve.
  createChild(parentTaskId: string, seed: ChildTaskSeed): Promise<string>
  // Cancel a task, the child-task half of cancelling a fan-out run. A distinct verb rather than a
  // general `setStatus`, so a plugin cannot archive or restore a task outside core's own routes.
  cancel(taskId: string): Promise<void>
}

export function createTaskService(db: AppDatabase): TaskService {
  return {
    adoptPullNumbers: async (repoOwner, repoName, branchToPull) => {
      if (!branchToPull.size) return 0
      const candidates = await db
        .select({ id: schema.tasks.id, branch: schema.tasks.branch })
        .from(schema.tasks)
        .leftJoin(schema.projects, eq(schema.projects.id, schema.tasks.projectId))
        .where(
          and(
            // Adoption is a GitHub-domain operation, so every local project clone with this facet
            // participates, not only the oldest project.
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
    root: (taskId, userId = null) => taskRoot(db, taskId, userId),
    resolveCwd: (task, baseCheckout, userId = null) => resolveTaskCwd(db, task, baseCheckout, userId),
    runConfig: (taskId) => taskRunConfig(db, taskId),
    active: () => db.select(TASK_REF_COLUMNS).from(schema.tasks).where(eq(schema.tasks.status, 'active')),
    workspaceId: (taskId) => workspaceIdFor(db, taskId),
    // Built from the same two queries as `workspaceIdFor` rather than by catching its throw, because
    // catching cannot tell "no membership" from "the database is broken".
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
    pulls: async (taskId) => {
      const rows = await db.select().from(schema.taskPulls).where(eq(schema.taskPulls.taskId, taskId)).orderBy(schema.taskPulls.createdAt)
      return rows.map((row) => ({
        taskId: row.taskId,
        repoOwner: row.repoOwner,
        repoName: row.repoName,
        pullNumber: row.pullNumber,
        role: row.role as TaskPullRelation['role'],
        provenance: row.provenance as TaskPullRelation['provenance'],
        sessionId: row.sessionId,
        ...(row.requestId ? { requestId: row.requestId } : {}),
      }))
    },
    attachPull: async (taskId, input) => {
      if (!Number.isSafeInteger(input.pullNumber) || input.pullNumber <= 0) throw new Error('Pull number must be a positive integer.')
      if (!input.sessionId.trim()) throw new Error('A managed agent session is required to attach a pull request.')
      const repoOwner = normalizeGithubPart(input.repoOwner)
      const repoName = normalizeGithubPart(input.repoName)

      return db.transaction((tx) => {
        const task = tx.select({
          id: schema.tasks.id,
          pullNumber: schema.tasks.pullNumber,
          projectOwner: schema.projects.githubOwner,
          projectName: schema.projects.githubName,
        })
          .from(schema.tasks)
          .leftJoin(schema.projects, eq(schema.projects.id, schema.tasks.projectId))
          .where(eq(schema.tasks.id, taskId))
          .get()
        if (!task) throw new Error('Task not found.')
        if (
          !task.projectOwner || !task.projectName
          || normalizeGithubPart(task.projectOwner) !== repoOwner
          || normalizeGithubPart(task.projectName) !== repoName
        ) throw new Error('Pull request repository does not match the task project.')

        const existing = tx.select().from(schema.taskPulls).where(and(
          eq(schema.taskPulls.taskId, taskId),
          eq(schema.taskPulls.repoOwner, repoOwner),
          eq(schema.taskPulls.repoName, repoName),
          eq(schema.taskPulls.pullNumber, input.pullNumber),
        )).get()
        if (existing) {
          return {
            taskId: existing.taskId,
            repoOwner: existing.repoOwner,
            repoName: existing.repoName,
            pullNumber: existing.pullNumber,
            role: existing.role as TaskPullRelation['role'],
            provenance: existing.provenance as TaskPullRelation['provenance'],
            sessionId: existing.sessionId,
            ...(existing.requestId ? { requestId: existing.requestId } : {}),
          }
        }

        const claimsPrimary = task.pullNumber == null || task.pullNumber === input.pullNumber
        const role: TaskPullRelation['role'] = claimsPrimary ? 'primary' : 'related'
        if (claimsPrimary) {
          // A user may have cleared or replaced the scalar primary since an older agent attachment.
          // Demote that historical row before recording the new winner so the partial unique index
          // and the operational scalar agree again.
          tx.update(schema.taskPulls)
            .set({ role: 'related' })
            .where(and(eq(schema.taskPulls.taskId, taskId), eq(schema.taskPulls.role, 'primary')))
            .run()
        }
        if (task.pullNumber == null) {
          tx.update(schema.tasks)
            .set({ pullNumber: input.pullNumber, updatedAt: Date.now() })
            .where(and(eq(schema.tasks.id, taskId), isNull(schema.tasks.pullNumber)))
            .run()
        }
        const relation: TaskPullRelation = {
          taskId,
          repoOwner,
          repoName,
          pullNumber: input.pullNumber,
          role,
          provenance: 'agent',
          sessionId: input.sessionId,
          ...(input.requestId ? { requestId: input.requestId } : {}),
        }
        tx.insert(schema.taskPulls).values({ ...relation, requestId: relation.requestId ?? null, createdAt: Date.now() }).run()
        return relation
      })
    },
    createChild: async (parentTaskId, seed) => {
      const parent = await loadTask(db, parentTaskId)
      if (!parent) throw new Error('Parent task not found.')
      const project = await projectForTask(db, parent)
      if (!project) throw new Error('Parent task has no project.')
      // De-duped against every task, not just this parent's children. A worktree is keyed on the
      // branch, so a collision with an unrelated task hands two tasks one checkout.
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
      broadcastWorktreeStatusChanged({ taskId: id })
      broadcastTasksChanged()
      return id
    },
    cancel: async (taskId) => {
      await db.update(schema.tasks).set({ status: 'cancelled', updatedAt: Date.now() }).where(eq(schema.tasks.id, taskId))
      broadcastWorktreeStatusChanged({ taskId })
      broadcastTasksChanged()
    },
  }
}
