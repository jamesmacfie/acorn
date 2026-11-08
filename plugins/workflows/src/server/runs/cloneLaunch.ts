// Clone a Git URL, then start a workflow as the new project's first task
// (docs/workflows/starting-runs.md § After a clone). The Node does the whole launch, so a client that
// closes mid-clone can't strand the run.
//
// Process-local, like core's clone runs. A restart drops every record. The project or the task may
// already exist by then, and the run can start from the task the usual way.
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import type { DataValue } from '@acorn/protocol/dataValues.ts'
import { CLONE_RUN_WAIT_MS, cloneOutcome } from '@acorn/protocol/api.ts'
import { BridgeError, describeError, type CompiledCoreServices, type PluginDatabase } from '@acorn/plugin-api/node'
import type { WorkflowCloneLaunch, WorkflowDefSummary } from '../../contract/wire.ts'
import { resolveScopedWorkflowDefinition } from '../definitions/resolution'
import { mergedList } from '../definitions/store'
import {
  resolveWorkflowInputs,
  WorkflowValidationError,
  type WorkflowValidationCatalog,
} from '../validation/definition'
import type { WorkflowStartService } from './admission'

export type CloneLaunchRequest = {
  clone: { url: string; parentDir: string; name?: string; workspaceId?: string }
  defId: string
  inputs?: Record<string, DataValue>
  launchId: string
}

export type CloneLaunchDeps = {
  db: PluginDatabase
  core: Pick<CompiledCoreServices, 'projects' | 'tasks'>
  starts: Pick<WorkflowStartService, 'startById'>
  catalog(): WorkflowValidationCatalog
  // Tests point this at a temporary folder.
  userDir?: string
}

// Long enough for every client following the launch to read how it ended.
const KEEP_SETTLED_MS = 10 * 60_000
const CLONE_LAUNCH_WAIT_MS = 20_000

type Launch = {
  request: CloneLaunchRequest
  state: WorkflowCloneLaunch
  // Made when the launch starts, so a retry creates the same task, or finds it.
  taskId: string
  title: string
  done: Promise<void>
  settledAt?: number
}
const launches = new Map<string, Launch>()
const admitting = new Map<string, Promise<WorkflowCloneLaunch>>()

function prune(): void {
  const cutoff = Date.now() - KEEP_SETTLED_MS
  for (const [id, launch] of launches)
    if (launch.settledAt !== undefined && launch.settledAt < cutoff) launches.delete(id)
}

const refuse = (message: string) => new BridgeError(400, 'clone_launch_refused', message)

/**
 * The workflows a clone may start: `~/.acorn/workflows` files and the workspace's published rows that
 * belong to no project, without known problems. Never a file committed in a repository, because a
 * repository's ID beats a user's, so a hostile one could replace the workflow you picked.
 * With no workspace, which is how a Node with workspaces off files every new project, only files.
 */
export async function cloneLaunchWorkflows(deps: CloneLaunchDeps, workspaceId?: string): Promise<WorkflowDefSummary[]> {
  const listed = await mergedList(deps.db, workspaceId ?? '', [], {
    userDir: deps.userDir ?? homedir(),
    catalog: deps.catalog(),
  })
  return listed.workflows
    .filter(
      (entry) =>
        !entry.problems?.length &&
        (entry.source === 'user' || (!!workspaceId && !entry.projectId && !!entry.publishedRevision)),
    )
    .map((entry) => (entry.source === 'user' ? { ...entry, id: `user:${entry.id}` } : entry))
}

/** Resolves the definition and checks the inputs against it, before anything is cloned. Answers the
 *  workflow's name. */
async function checkDefinition(deps: CloneLaunchDeps, request: CloneLaunchRequest): Promise<string> {
  const { defId, inputs } = request
  const workspaceId = request.clone.workspaceId
  if (defId.startsWith('repo:'))
    throw refuse(
      "A workflow committed in a repository can't run after a clone. Pick one from ~/.acorn/workflows or one saved on this Node.",
    )
  const user = /^user:(.+)$/.exec(defId)
  if (!user && !workspaceId)
    throw refuse(
      'A saved workflow needs the workspace the clone goes in. Name one, or pick a workflow from ~/.acorn/workflows.',
    )
  try {
    const { definition } = await resolveScopedWorkflowDefinition(
      deps.db,
      user ? { source: 'user', id: user[1]! } : { source: 'database', id: defId },
      // No project yet. A saved workflow bound to one project can't match, which is the rule.
      { workspaceId: workspaceId ?? '', projectId: '', repoDir: null, userDir: deps.userDir ?? homedir() },
      deps.catalog(),
    )
    resolveWorkflowInputs(definition, inputs)
    return definition.name
  } catch (error) {
    if (error instanceof WorkflowValidationError) throw refuse(error.message)
    throw error
  }
}

const sameRequest = (a: CloneLaunchRequest, b: CloneLaunchRequest): boolean =>
  JSON.stringify([a.clone, a.defId, a.inputs ?? {}]) === JSON.stringify([b.clone, b.defId, b.inputs ?? {}])

const settle = (launch: Launch, state: WorkflowCloneLaunch): void => {
  launch.state = state
  launch.settledAt = Date.now()
}

// `cloneId` is the clone this launch waits on, or undefined once it has its project.
async function run(deps: CloneLaunchDeps, launch: Launch, cloneId: string | undefined): Promise<void> {
  const { request } = launch
  try {
    if (cloneId) {
      const cloned = await cloneOutcome(() => deps.core.projects.cloneRun(cloneId, CLONE_RUN_WAIT_MS))
      if (!cloned.ok)
        return settle(launch, { launchId: request.launchId, stage: 'failed', failedAt: 'cloning', error: cloned.error })
      launch.state = { launchId: request.launchId, stage: 'starting', projectId: cloned.projectId }
    }
    const projectId = launch.state.projectId!
    // Core refuses to replay an intended task ID with a different seed, so the seed never changes.
    const taskId = await deps.core.tasks.createRoot(
      projectId,
      { title: launch.title, origin: 'workflows:clone' },
      launch.taskId,
    )
    launch.state = { ...launch.state, taskId }
    const started = await deps.starts.startById(taskId, request.defId, request.inputs, true, request.launchId)
    if (!started.runId) {
      const error =
        started.error === 'needs-trust'
          ? "This workflow reads files committed in the repository, which an untrusted project can't run."
          : (started.error ?? "The workflow didn't start.")
      return settle(launch, { ...launch.state, stage: 'failed', failedAt: 'starting', error })
    }
    settle(launch, { ...launch.state, stage: 'started', runId: started.runId })
  } catch (error) {
    settle(launch, {
      ...launch.state,
      stage: 'failed',
      failedAt: launch.state.projectId ? 'starting' : 'cloning',
      error: describeError(error).message,
    })
  }
}

/**
 * Starts a launch and answers at once. The same `launchId` again joins the launch, or, when it failed,
 * retries from the stage that failed. A clone that finished is never cloned again.
 * Throws a 400 for a refused definition, inputs, URL, or folder, and a 409 for a launch ID used with
 * a different request.
 */
export async function startCloneLaunch(
  deps: CloneLaunchDeps,
  request: CloneLaunchRequest,
): Promise<WorkflowCloneLaunch> {
  // Posts with one launch ID are admitted one after another, so a second that arrives while the first
  // is still checking joins the launch instead of cloning again.
  const ahead = admitting.get(request.launchId) ?? Promise.resolve()
  const admitted = ahead.catch(() => {}).then(() => admit(deps, request))
  admitting.set(request.launchId, admitted)
  try {
    return await admitted
  } finally {
    if (admitting.get(request.launchId) === admitted) admitting.delete(request.launchId)
  }
}

async function admit(deps: CloneLaunchDeps, request: CloneLaunchRequest): Promise<WorkflowCloneLaunch> {
  prune()
  const existing = launches.get(request.launchId)
  if (existing && !sameRequest(existing.request, request))
    throw new BridgeError(409, 'launch_id_reused', 'This launch ID was used with a different clone or workflow.')
  if (existing && existing.state.stage !== 'failed') return existing.state
  const title = `${await checkDefinition(deps, request)} · first run`
  const projectId = existing?.state.projectId
  let cloneId: string | undefined
  if (!projectId) {
    try {
      cloneId = (await deps.core.projects.clone({ ...request.clone, trusted: false })).cloneId
    } catch (error) {
      // Core refused the URL or the folder. Nothing was cloned.
      throw refuse(describeError(error).message)
    }
  }
  const launch: Launch = existing ?? {
    request,
    state: { launchId: request.launchId, stage: 'cloning' },
    taskId: randomUUID(),
    title,
    done: Promise.resolve(),
  }
  launch.settledAt = undefined
  launch.state = projectId
    ? {
        launchId: request.launchId,
        stage: 'starting',
        projectId,
        ...(existing?.state.taskId ? { taskId: existing.state.taskId } : {}),
      }
    : { launchId: request.launchId, stage: 'cloning' }
  launches.set(request.launchId, launch)
  launch.done = run(deps, launch, cloneId)
  return launch.state
}

/** The launch, after waiting up to `waitMs` (at most 20 seconds) for it to settle. Null when the Node
 *  holds no record: a wrong ID, a restart since, or a launch that settled more than ten minutes ago. */
export async function cloneLaunchState(launchId: string, waitMs: number): Promise<WorkflowCloneLaunch | null> {
  prune()
  const launch = launches.get(launchId)
  if (!launch) return null
  const wait = Math.min(Math.max(waitMs, 0), CLONE_LAUNCH_WAIT_MS)
  if (launch.settledAt === undefined && wait > 0)
    await Promise.race([launch.done, new Promise((resolve) => setTimeout(resolve, wait).unref?.())])
  return launch.state
}
