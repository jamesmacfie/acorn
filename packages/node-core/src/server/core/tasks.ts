import { recordSetupDecision } from '../taskScripts/setup'
import { taskScripts } from '../taskScripts/service'
// The task read seam (CoreServices.tasks). Plugins hold task ids and ask core to resolve them here,
// so database handles stay private to their owning layer.
import { and, eq, isNull, lt, max, or } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { dedupeBranch, isValidBranch, slugifyBranch } from '@acorn/protocol/branch.ts'
import type { ProjectRepository } from '@acorn/protocol/api.ts'
import type { LayoutRecipe, RunTarget } from '../projects/runConfig'
import type { AppDatabase } from '../db'
import { schema } from '../db'
import { broadcastTasksChanged, broadcastWorktreeStatusChanged } from '../notify'
import {
  loadTask,
  projectForTask,
  requireTaskRoot,
  resolveTaskCwd,
  TASK_REF_COLUMNS,
  taskRoot,
  taskRunConfig,
  toTaskRef,
  workspaceIdFor,
  type TaskRef,
} from '../worktrees/taskWorktree'
import { getProject, githubFacet, normalizeGithubPart, projectRepository } from '../projects/projects'
import { changeRequestProvider, setPrimaryChangeRequest, type ChangeRequestRow } from './changeRequests'
import { isTaskArchiving } from '../worktrees/archiveGate'

// What `taskRunConfig` answers: the merged run-target config plus the cwd to run it in. Named,
// because it is a CoreServices return value rather than an internal helper's.
type TaskRunConfig =
  | {
      targets: RunTarget[]
      cwd: string
      errors: { source: string; message: string }[]
      layouts: LayoutRecipe[]
      repoTargetIds: string[]
      repoConfigHash: string | null
    }
  | { error: string }

// The three columns a `task_links` row is read for outside core: which provider, through which
// stored connection, under which identifier. Narrower than the row, because `refJson` is parsed
// through the integration provider registry, which is core's job.
type TaskLinkRef = { provider: string; integrationId: string; identifier: string }

// What a dispatched child needs to exist. `branch` is a suggestion: it is slugged and de-duped against
// task reservations, worktree directories, and Git worktrees. A base also reserves local branches.
type ChildTaskSeed = { title: string; branch: string; origin?: string; baseBranch?: string }
type RootTaskSeed = { title: string; branch?: string; origin: string }

type TaskPullRelation = {
  taskId: string
  repoOwner: string
  repoName: string
  pullNumber: number
  role: 'primary' | 'related'
  provenance: 'agent'
  sessionId: string
  requestId?: string
}

type AttachTaskPullInput = {
  repoOwner: string
  repoName: string
  pullNumber: number
  sessionId: string
  requestId?: string
}

type TaskChangeRequest = {
  taskId: string
  provider: string | null
  host: string
  path: string
  number: number
  role: 'primary' | 'related'
  provenance: 'task' | 'adopted' | 'agent'
  sourceBranch?: string
  sessionId?: string
  requestId?: string
}

type AttachChangeRequestInput = {
  provider: string
  path: string
  number: number
  sourceBranch?: string
  sessionId: string
  requestId?: string
}

export type TaskService = {
  // The task's plugin-facing projection (server/worktrees/taskWorktree.ts § TaskRef), or undefined when the id
  // does not resolve. A TaskRef, never the `tasks` row (docs/plugins/publishing.md § What is published, and
  // what acorn promises about it).
  load(taskId: string): Promise<TaskRef | undefined>
  // The task's worktree root, resolving through the project checkout and creating the worktree
  // lazily if needed. null when no checkout is mapped, the task is archiving, or it is not active.
  root(taskId: string): Promise<string | null>
  // A root for execution. Missing mappings and worktree failures throw distinct errors instead of
  // collapsing to null, which is reserved for read-only panes that can show an empty state.
  requireRoot(taskId: string): Promise<string>
  // The cwd a task's commands run in, creating the worktree on first use
  // (docs/workspaces-and-tasks/worktrees.md § Worktrees and setup). Takes the row rather than the id, because
  // the one caller already loaded it and re-reading would be a second query across a database
  // boundary.
  resolveCwd(
    task: TaskRef | undefined,
    baseCheckout: string | undefined,
  ): Promise<{ cwd: string; isWorktree: boolean; created: boolean }>
  // Run targets and cwd for a task: project settings merged with the project's committed
  // `.acorn/config.toml`. plugins/terminal's RuntimeService is the only consumer, and it can read
  // neither source itself, since one is a core table and the other needs the lazy worktree.
  runConfig(taskId: string): Promise<TaskRunConfig>
  // Every non-archived task. Two plugins need the whole set rather than one id: docker matches live
  // containers against every active task's worktree and branch for the rail badge, and memory
  // reconciles its file index from every active worktree. What those two read is a subset of
  // TaskRef, so they get refs like every other reader.
  active(): Promise<TaskRef[]>
  /** Branch claims that still block metadata changes, including archive teardown in progress. */
  branchClaims(): Promise<TaskRef[]>
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
  // Every task in a project with its title and status, for the agents plugin's cross-session tools,
  // which scope reads to the caller's project. Not status-filtered, for the same reason as
  // `idsForWorkspace`: an archived task's transcripts still belong to the project.
  inProject(projectId: string): Promise<{ id: string; title: string; status: string }[]>
  // The external tickets and errors linked to a task (`task_links`). plugins/notes' seeding pass
  // renders one note per linked Linear ticket, and it needs the connection id as well as the
  // identifier, because the same ticket through two Linear connections is two rows.
  links(taskId: string): Promise<TaskLinkRef[]>
  // Every change request linked to the task, oldest first (docs/plugins/code-hosts.md § Change requests).
  changeRequests(taskId: string): Promise<TaskChangeRequest[]>
  // Attach a change request created through a task-scoped agent tool. The first one takes the task's
  // empty primary slot and later ones are related. The row keeps the agent provenance either way.
  attachChangeRequest(taskId: string, input: AttachChangeRequestInput): Promise<TaskChangeRequest>
  // Give every active task on the repository with no primary the change request whose source branch is
  // the task's branch. Every local clone of the repository takes part, not only the oldest project.
  adoptChangeRequests(provider: string, path: string, branchToNumber: ReadonlyMap<string, number>): Promise<number>
  // The three above under their GitHub names, for a github.com repository, until the next plugin API
  // major. `pulls` keeps its old meaning: agent attachments only.
  pulls(taskId: string): Promise<TaskPullRelation[]>
  attachPull(taskId: string, input: AttachTaskPullInput): Promise<TaskPullRelation>
  adoptPullNumbers(repoOwner: string, repoName: string, branchToPull: ReadonlyMap<string, number>): Promise<number>
  // Materialise a dispatched child task under a parent (docs/workflows.md) and return its id. The
  // worktree is not created here. `resolveCwd` does that when the child's first step runs, the same
  // path every other surface takes.
  //
  // A write on CoreServices: plugins ask core to create a task rather than writing core-owned rows.
  // Throws when the parent does not resolve.
  createChild(parentTaskId: string, seed: ChildTaskSeed, intendedChildId?: string): Promise<string>
  // Cancel a task, the child-task half of cancelling a dispatched run. A distinct verb rather than a
  // general `setStatus`, so a plugin cannot archive or restore a task outside core's own routes.
  cancel(taskId: string): Promise<void>
  // Every task the owner deleted, from core's tombstones (docs/workspaces-and-tasks/archive.md § Deleting
  // a task). A plugin's daily catch-up reads it to purge rows a missed `core:task-deleted` hook left
  // behind (server/pluginHost/deletedTaskPurge.ts). Never infer deletion from a task missing from
  // `load` or `active`: a transient empty answer would read as every task gone.
  deleted(): Promise<string[]>
}

export type CompiledTaskService = TaskService & {
  /** Replay-safe root creation for internal orchestrators such as approved workflow schedules. */
  createRoot(projectId: string, seed: RootTaskSeed, intendedTaskId: string): Promise<string>
  // Every task archived before `before`, a millisecond timestamp. plugins/agents reads it to remove the
  // agent history of tasks archived longer than the owner keeps it (docs/data-layer/backup-and-retention.md § Retention).
  // Only tasks still archived: a restore clears `archivedAt`, so a restored task is never in the list.
  // First-party only, because deleting on a task's archive date is a retention policy and no loaded
  // plugin has one. plugins/permissions.ts § scopeCore strips it from the loaded tier's facet.
  archivedBefore(before: number): Promise<string[]>
}

export function createTaskService(db: AppDatabase): CompiledTaskService {
  const table = schema.taskChangeRequests

  const toChangeRequest = (row: ChangeRequestRow): TaskChangeRequest => ({
    taskId: row.taskId,
    provider: changeRequestProvider(row),
    host: row.repoHost,
    path: row.repoPath,
    number: row.number,
    role: row.role as TaskChangeRequest['role'],
    provenance: row.provenance as TaskChangeRequest['provenance'],
    ...(row.sourceBranch ? { sourceBranch: row.sourceBranch } : {}),
    ...(row.sessionId ? { sessionId: row.sessionId } : {}),
    ...(row.requestId ? { requestId: row.requestId } : {}),
  })

  const toPullRelation = (request: TaskChangeRequest): TaskPullRelation | null => {
    const github = request.provenance === 'agent' && request.sessionId ? githubFacet(request) : null
    return github
      ? {
          taskId: request.taskId,
          repoOwner: github.owner,
          repoName: github.name,
          pullNumber: request.number,
          role: request.role,
          provenance: 'agent',
          sessionId: request.sessionId!,
          ...(request.requestId ? { requestId: request.requestId } : {}),
        }
      : null
  }

  // Attach to the task when its project's repository passes `matches`, which is how the generic and
  // the GitHub-named methods name a repository.
  const attach = (
    taskId: string,
    input: Omit<AttachChangeRequestInput, 'provider' | 'path'>,
    matches: (repository: ProjectRepository) => boolean,
  ): TaskChangeRequest => {
    if (!Number.isSafeInteger(input.number) || input.number <= 0)
      throw new Error('A change request number must be a positive integer.')
    if (!input.sessionId.trim()) throw new Error('A managed agent session is required to attach a change request.')
    if (input.sourceBranch !== undefined && !isValidBranch(input.sourceBranch))
      throw new Error(`'${input.sourceBranch}' is not a valid source branch.`)
    const result = db.transaction((tx) => {
      const task = tx
        .select({ projectId: schema.tasks.projectId })
        .from(schema.tasks)
        .where(eq(schema.tasks.id, taskId))
        .get()
      if (!task) throw new Error('Task not found.')
      const project = tx.select().from(schema.projects).where(eq(schema.projects.id, task.projectId)).get()
      const repository = project && projectRepository(project)
      if (!repository || !matches(repository))
        throw new Error("The change request's repository does not match the task's project.")
      const key = and(
        eq(table.taskId, taskId),
        eq(table.repoHost, repository.host),
        eq(table.repoPath, repository.path),
        eq(table.number, input.number),
      )
      const existing = tx.select().from(table).where(key).get()
      if (existing?.sessionId) return { changed: false, row: existing }
      if (existing) {
        // Linked on the task or adopted before the agent attached it. The agent's provenance is the
        // one a code host can't reconstruct later, so it's the one kept.
        tx.update(table)
          .set({ provenance: 'agent', sessionId: input.sessionId, requestId: input.requestId ?? null })
          .where(key)
          .run()
      } else {
        const link = {
          provider: repository.provider ?? '',
          repoHost: repository.host,
          repoPath: repository.path,
          number: input.number,
          provenance: 'agent' as const,
          sourceBranch: input.sourceBranch ?? null,
          sessionId: input.sessionId,
          requestId: input.requestId ?? null,
        }
        const primary = tx
          .select({ number: table.number })
          .from(table)
          .where(and(eq(table.taskId, taskId), eq(table.role, 'primary')))
          .get()
        if (!primary) setPrimaryChangeRequest(tx, taskId, link)
        else
          tx.insert(table)
            .values({ ...link, taskId, role: 'related', createdAt: Date.now() })
            .run()
      }
      return { changed: true, row: tx.select().from(table).where(key).get()! }
    })
    if (result.changed) broadcastTasksChanged({ taskId })
    return toChangeRequest(result.row)
  }

  const adopt = (
    path: string,
    matches: (repository: ProjectRepository) => boolean,
    branchToNumber: ReadonlyMap<string, number>,
  ): number => {
    if (!branchToNumber.size) return 0
    const adopted = db.transaction((tx) => {
      const candidates = tx
        .select({ id: schema.tasks.id, branch: schema.tasks.branch, project: schema.projects })
        .from(schema.tasks)
        .innerJoin(schema.projects, eq(schema.projects.id, schema.tasks.projectId))
        .leftJoin(table, and(eq(table.taskId, schema.tasks.id), eq(table.role, 'primary')))
        .where(
          and(
            eq(schema.projects.repoPath, path.trim().toLowerCase()),
            eq(schema.tasks.status, 'active'),
            isNull(table.taskId),
          ),
        )
        .all()
      let count = 0
      for (const task of candidates) {
        const number = task.branch ? branchToNumber.get(task.branch) : undefined
        const repository = projectRepository(task.project)
        if (!number || !Number.isSafeInteger(number) || number <= 0 || !repository || !matches(repository)) continue
        setPrimaryChangeRequest(tx, task.id, {
          provider: repository.provider ?? '',
          repoHost: repository.host,
          repoPath: repository.path,
          number,
          provenance: 'adopted',
          sourceBranch: task.branch,
        })
        count++
      }
      return count
    })
    if (adopted) broadcastTasksChanged({ taskId: null })
    return adopted
  }

  return {
    createRoot: async (projectId, seed, intendedTaskId) => {
      const project = await getProject(db, projectId)
      if (!project) throw new Error('Project not found.')
      const title = seed.title.trim()
      if (!title || !seed.origin.trim() || !intendedTaskId.trim())
        throw new Error('Root task identity, title, and origin are required.')
      const reserve = async () =>
        db.transaction((tx) => {
          const existing = tx.select().from(schema.tasks).where(eq(schema.tasks.id, intendedTaskId)).get()
          const branches = tx
            .select({ id: schema.tasks.id, branch: schema.tasks.branch })
            .from(schema.tasks)
            .all()
            .flatMap((row) => (row.id !== intendedTaskId && row.branch ? [row.branch] : []))
          const branch =
            project.vcs === 'git'
              ? dedupeBranch(slugifyBranch(seed.branch || title) || `workflow-${intendedTaskId.slice(0, 8)}`, branches)
              : null
          if (existing) {
            if (
              existing.parentId !== null ||
              existing.projectId !== project.id ||
              existing.title !== title ||
              existing.origin !== seed.origin ||
              existing.branch !== branch
            ) {
              throw new Error(`Root task id '${intendedTaskId}' is already used by a different seed.`)
            }
            return false
          }
          const value = tx
            .select({ value: max(schema.tasks.sort) })
            .from(schema.tasks)
            .get()?.value
          const at = Date.now()
          tx.insert(schema.tasks)
            .values({
              id: intendedTaskId,
              title,
              icon: null,
              origin: seed.origin,
              projectId: project.id,
              branch,
              worktreePath: null,
              status: 'active',
              parentId: null,
              sort: (value ?? -1) + 1,
              createdAt: at,
              updatedAt: at,
              archivedAt: null,
            })
            .run()
          return true
        })
      const created =
        project.vcs === 'git'
          ? await (await import('../worktrees/taskBranch')).withBranchReservation(db, project, reserve, true)
          : await reserve()
      if (created) {
        await recordSetupDecision(db, intendedTaskId, false)
        broadcastWorktreeStatusChanged({ taskId: intendedTaskId })
        broadcastTasksChanged({ taskId: intendedTaskId })
      }
      return intendedTaskId
    },
    archivedBefore: async (before) => {
      const rows = await db
        .select({ id: schema.tasks.id })
        .from(schema.tasks)
        .where(and(eq(schema.tasks.status, 'archived'), lt(schema.tasks.archivedAt, before)))
      return rows.map((row) => row.id)
    },
    deleted: async () =>
      (await db.select({ id: schema.deletedTasks.id }).from(schema.deletedTasks)).map((row) => row.id),
    adoptChangeRequests: async (provider, path, branchToNumber) =>
      adopt(path, (repository) => repository.provider === provider, branchToNumber),
    adoptPullNumbers: async (repoOwner, repoName, branchToPull) =>
      adopt(
        `${normalizeGithubPart(repoOwner)}/${normalizeGithubPart(repoName)}`,
        (repository) => repository.host === 'github.com',
        branchToPull,
      ),
    load: async (taskId) => {
      const row = await loadTask(db, taskId)
      return row && toTaskRef(row)
    },
    root: (taskId) => taskRoot(db, taskId),
    requireRoot: (taskId) => requireTaskRoot(db, taskId),
    resolveCwd: (task, baseCheckout) => resolveTaskCwd(db, task, baseCheckout),
    runConfig: (taskId) => taskRunConfig(db, taskId),
    active: () => db.select(TASK_REF_COLUMNS).from(schema.tasks).where(eq(schema.tasks.status, 'active')),
    branchClaims: async () =>
      db
        .select({ ...TASK_REF_COLUMNS, status: schema.tasks.status })
        .from(schema.tasks)
        .all()
        .filter((task) => task.status === 'active' || isTaskArchiving(task.id)),
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
      const projectIds = (
        await db
          .select({ id: schema.projects.id })
          .from(schema.projects)
          .where(eq(schema.projects.workspaceId, workspaceId))
      ).map((row) => row.id)
      const projectTasks = projectIds.length
        ? await db
            .selectDistinct({ id: schema.tasks.id })
            .from(schema.tasks)
            .where(or(...projectIds.map((id) => eq(schema.tasks.projectId, id))))
        : []
      return projectTasks.map((row) => row.id)
    },
    inProject: async (projectId) =>
      db
        .select({ id: schema.tasks.id, title: schema.tasks.title, status: schema.tasks.status })
        .from(schema.tasks)
        .where(eq(schema.tasks.projectId, projectId)),
    links: (taskId) =>
      db
        .select({
          provider: schema.taskLinks.provider,
          integrationId: schema.taskLinks.integrationId,
          identifier: schema.taskLinks.identifier,
        })
        .from(schema.taskLinks)
        .where(eq(schema.taskLinks.taskId, taskId)),
    changeRequests: async (taskId) =>
      (await db.select().from(table).where(eq(table.taskId, taskId)).orderBy(table.createdAt)).map(toChangeRequest),
    attachChangeRequest: async (taskId, input) =>
      attach(
        taskId,
        input,
        (repository) => repository.provider === input.provider && repository.path === input.path.trim().toLowerCase(),
      ),
    pulls: async (taskId) =>
      (await db.select().from(table).where(eq(table.taskId, taskId)).orderBy(table.createdAt)).flatMap(
        (row) => toPullRelation(toChangeRequest(row)) ?? [],
      ),
    attachPull: async (taskId, input) => {
      const owner = normalizeGithubPart(input.repoOwner)
      const name = normalizeGithubPart(input.repoName)
      const request = attach(
        taskId,
        { number: input.pullNumber, sessionId: input.sessionId, requestId: input.requestId },
        (repository) => {
          const github = githubFacet(repository)
          return github?.owner === owner && github.name === name
        },
      )
      return toPullRelation(request)!
    },
    createChild: async (parentTaskId, seed, intendedChildId) => {
      const { saveTaskBranch, withBranchReservation } = await import('../worktrees/taskBranch')
      const parent = await loadTask(db, parentTaskId)
      if (!parent) throw new Error('Parent task not found.')
      const project = await projectForTask(db, parent)
      if (!project) throw new Error('Parent task has no project.')
      const id = intendedChildId ?? randomUUID()
      const stem = slugifyBranch(seed.branch || seed.title) || `child-${parentTaskId.slice(0, 8)}`
      const created = await withBranchReservation(
        db,
        project,
        async () => {
          const existingTask = db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get()
          // Replay keeps the first allocation even when Git or other task reservations have changed.
          if (existingTask) {
            const branchMatches =
              project.vcs !== 'git'
                ? existingTask.branch === null
                : existingTask.branch === stem ||
                  (existingTask.branch?.startsWith(`${stem}-`) &&
                    /^[0-9]+$/.test(existingTask.branch.slice(stem.length + 1)) &&
                    Number(existingTask.branch.slice(stem.length + 1)) >= 2)
            if (
              existingTask.parentId !== parentTaskId ||
              existingTask.projectId !== project.id ||
              existingTask.title !== seed.title ||
              !branchMatches ||
              existingTask.origin !== (seed.origin ?? 'local')
            ) {
              throw new Error(`Child task id '${id}' is already used by a different parent or seed.`)
            }
            return false
          }
          return saveTaskBranch(
            db,
            project,
            { branch: project.vcs === 'git' ? stem : null, branchSource: 'derived', baseBranch: seed.baseBranch },
            (branch) => {
              const currentParent = db.select().from(schema.tasks).where(eq(schema.tasks.id, parentTaskId)).get()
              if (currentParent?.status !== 'active' || isTaskArchiving(parentTaskId))
                throw new Error('Parent task is not active or is being archived.')
              const value = db
                .select({ value: max(schema.tasks.sort) })
                .from(schema.tasks)
                .get()?.value
              const at = Date.now()
              db.insert(schema.tasks)
                .values({
                  id,
                  title: seed.title,
                  origin: seed.origin ?? 'local',
                  projectId: project.id,
                  branch,
                  worktreePath: null,
                  status: 'active',
                  parentId: parentTaskId,
                  sort: (value ?? -1) + 1,
                  createdAt: at,
                  updatedAt: at,
                  archivedAt: null,
                })
                .run()
              return true
            },
          )
        },
        !seed.baseBranch,
      )
      if (!created) return id
      await recordSetupDecision(db, id, false)
      broadcastWorktreeStatusChanged({ taskId: id })
      broadcastTasksChanged({ taskId: id })
      return id
    },
    cancel: async (taskId) => {
      const [task] = await db
        .select({ status: schema.tasks.status })
        .from(schema.tasks)
        .where(eq(schema.tasks.id, taskId))
      if (!task || task.status === 'cancelled') return
      taskScripts(db).interruptTask(taskId, 'cancelled')
      await db
        .update(schema.tasks)
        .set({ status: 'cancelled', updatedAt: Date.now() })
        .where(eq(schema.tasks.id, taskId))
      broadcastWorktreeStatusChanged({ taskId })
      broadcastTasksChanged({ taskId })
    },
  }
}
