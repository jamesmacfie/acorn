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
  pullNumber: number | null
}

export type TaskLinkRef = { provider: string; integrationId: string; identifier: string }
export type ChildTaskSeed = { title: string; branch: string; origin?: string }
export type AttachTaskPullInput = { repoOwner: string; repoName: string; pullNumber: number; sessionId: string; requestId?: string }
export type TaskPullRelation = AttachTaskPullInput & {
  taskId: string
  role: 'primary' | 'related'
  provenance: 'agent'
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
  | { targets: RunTarget[]; cwd: string; errors: { source: string; message: string }[]; layouts: LayoutRecipe[]; repoTargetIds: string[]; repoConfigHash: string | null }
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
  /** Throws when the task or its workspace membership is missing. */
  workspaceId(taskId: string): Promise<string>
  /** The same lookup with "no workspace" as a value. A real database failure still throws. */
  workspaceIdOrNull(taskId: string): Promise<string | null>
  idsForWorkspace(workspaceId: string): Promise<string[]>
  links(taskId: string): Promise<TaskLinkRef[]>
  pulls(taskId: string): Promise<TaskPullRelation[]>
  attachPull(taskId: string, input: AttachTaskPullInput): Promise<TaskPullRelation>
  adoptPullNumbers(repoOwner: string, repoName: string, branchToPull: ReadonlyMap<string, number>): Promise<number>
  /** Ask core to create a task rather than writing core-owned rows. The worktree is not created here. */
  createChild(parentTaskId: string, seed: ChildTaskSeed, intendedChildId?: string): Promise<string>
  cancel(taskId: string): Promise<void>
}

/** Six fields off the project row. Never core config, never a database handle. */
