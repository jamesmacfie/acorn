export type TaskRef = {
  id: string
  title: string
  projectId: string
  /** `null` runs in the project root; non-null names an isolated worktree branch. */
  branch: string | null
  /** Suppresses this task's project setup script when its worktree is created. */
  skipSetup: boolean
  /** `null` until the worktree is first created. Call `tasks.root(taskId)` rather than reading it. */
  worktreePath: string | null
  /** The primary change request's number when it's on github.com. Read `tasks.changeRequests` for any host. */
  pullNumber: number | null
}

export type TaskLinkRef = { provider: string; integrationId: string; identifier: string }
export type ChildTaskSeed = { title: string; branch: string; origin?: string }
export type AttachTaskPullInput = {
  repoOwner: string
  repoName: string
  pullNumber: number
  sessionId: string
  requestId?: string
}
export type TaskPullRelation = AttachTaskPullInput & {
  taskId: string
  role: 'primary' | 'related'
  provenance: 'agent'
}
/** A change request your code host owns, on the repository `provider` and `path` name. `sourceBranch`
 *  is the branch it merges from. Core fetches it by name when your code host declares no ref. */
export type AttachChangeRequestInput = {
  provider: string
  path: string
  number: number
  sourceBranch?: string
  sessionId: string
  requestId?: string
}
/** A change request linked to a task. The `primary` one is the task's own: core checks it out and opens
 *  its code host's pane. `provenance` says how it was linked: on the task itself, adopted from a branch,
 *  or attached by an agent. */
export type TaskChangeRequest = {
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

export type RunTarget = {
  id: string
  command: string
  stop?: string
  restart?: string
  url?: string
  urlCommand?: string
  icon?: string
  default?: boolean
}
export type LayoutRecipe = {
  id: string
  panes: string[]
  terminal?: string
  browser?: string
}
// repoConfigHash identifies the captured bytes used to parse repo-authored targets.
export type TaskRunConfig =
  | {
      targets: RunTarget[]
      cwd: string
      errors: { source: string; message: string }[]
      layouts: LayoutRecipe[]
      repoTargetIds: string[]
      repoConfigHash: string | null
    }
  | { error: string }

export type CoreTaskService = {
  load(taskId: string): Promise<TaskRef | undefined>
  /** The task's worktree root, creating it lazily. `null` when no checkout is mapped, the task is
   *  archiving, or it is not active. */
  root(taskId: string): Promise<string | null>
  /** The worktree root for execution. Throws a distinct error for an inactive task, an unmapped
   *  checkout, or a worktree failure instead of returning `null`. */
  requireRoot(taskId: string): Promise<string>
  resolveCwd(
    task: TaskRef | undefined,
    baseCheckout: string | undefined,
  ): Promise<{ cwd: string; isWorktree: boolean; created: boolean }>
  runConfig(taskId: string): Promise<TaskRunConfig>
  active(): Promise<TaskRef[]>
  /** Branch claims that still block metadata changes, including archive teardown in progress. */
  branchClaims(): Promise<TaskRef[]>
  /** Throws when the task or its workspace membership is missing. */
  workspaceId(taskId: string): Promise<string>
  /** The same lookup with "no workspace" as a value. A real database failure still throws. */
  workspaceIdOrNull(taskId: string): Promise<string | null>
  idsForWorkspace(workspaceId: string): Promise<string[]>
  /** Every task in a project, archived and cancelled ones included. Deleted tasks are gone.
   *  `status` is `active`, `archived`, or `cancelled`. */
  inProject(projectId: string): Promise<{ id: string; title: string; status: string }[]>
  links(taskId: string): Promise<TaskLinkRef[]>
  /** Every change request linked to the task, oldest first. */
  changeRequests(taskId: string): Promise<TaskChangeRequest[]>
  /** Link a change request an agent opened inside the task. The first one takes the task's empty primary
   *  slot, and later ones are related. Throws when the repository isn't the task project's. */
  attachChangeRequest(taskId: string, input: AttachChangeRequestInput): Promise<TaskChangeRequest>
  /** Give each active task on the repository with no primary change request the one whose source branch
   *  is the task's branch. Returns how many tasks took one. */
  adoptChangeRequests(provider: string, path: string, branchToNumber: ReadonlyMap<string, number>): Promise<number>
  /** The agent-attached change requests on github.com. Use `changeRequests`. */
  pulls(taskId: string): Promise<TaskPullRelation[]>
  /** `attachChangeRequest` for a github.com repository. */
  attachPull(taskId: string, input: AttachTaskPullInput): Promise<TaskPullRelation>
  /** `adoptChangeRequests` for a github.com repository. */
  adoptPullNumbers(repoOwner: string, repoName: string, branchToPull: ReadonlyMap<string, number>): Promise<number>
  /** Ask core to create a task rather than writing core-owned rows. The worktree is not created here. */
  createChild(parentTaskId: string, seed: ChildTaskSeed, intendedChildId?: string): Promise<string>
  cancel(taskId: string): Promise<void>
  /** Every task the owner deleted. Purge your rows for these ids; never infer deletion from a task
   *  missing from `load` or `active`. */
  deleted(): Promise<string[]>
}

/** Six fields off the project row. Never core config, never a database handle. */
