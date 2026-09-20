// Task-to-checkout/worktree resolution shared by every privileged main-process surface. The task
// ID, never a renderer-supplied absolute path, is the capability; paths are re-derived from the
// database on every call.
import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import { and, eq, isNotNull } from 'drizzle-orm'
import type { AppDatabase } from '../db'
import { schema } from '../db'
import type { TaskStatus, TerminalSession } from '@acorn/protocol/terminal.ts'
import { slugifyBranch } from '@acorn/protocol/branch.ts'
import { loadRepoConfig, type LayoutRecipe, type RunTarget } from '../runConfig'
import { getProject, type ProjectRow } from '../projects'
import { getProjectConfig } from '../projectConfig'
import { copyWorktreeFiles, ensureWorktree, staleWorktreeReason, worktreeBranch, worktreePorcelain } from './worktrees'
import { isTaskArchiving } from './archiveGate'
import { broadcastHeadChanged, broadcastTasksChanged } from '../notify'
import { runHook } from '../pluginHost/hooks'
import { BridgeError } from '../bridge'
import { createLogger, describeError } from '../telemetry/logger'

const log = createLogger('worktrees')

// Set once by registerTerminalChannel, where workspace worktrees are created (docs/workspaces-and-tasks.md).
let worktreesRoot = ''
export const setWorktreesRoot = (dir: string): void => {
  worktreesRoot = dir
}
export const getWorktreesRoot = (): string => worktreesRoot

export const isDir = (p: string): boolean => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

// The only renderer-supplied absolute path accepted by terminal creation is a base-checkout
// candidate. Keep its narrow validation named and tested at the privileged boundary.
export const rendererBaseCheckout = (cwd: string | undefined): string | undefined =>
  cwd && isAbsolute(cwd) && isDir(cwd) ? cwd : undefined

export type TaskRow = typeof schema.tasks.$inferSelect

// The plugin-facing projection of a task: docs/plugins.md § Activation covers why CoreServices
// hands back TaskRef rather than the database row, and why it carries only six fields.
export type TaskRef = {
  id: string
  title: string
  projectId: string
  // null runs in the project root; non-null names an isolated worktree branch
  // (docs/workspaces-and-tasks.md § Task).
  branch: string | null
  // null until the worktree is first created; a plugin that needs the path calls
  // `tasks.root(taskId)` instead of reading this field directly.
  worktreePath: string | null
  pullNumber: number | null
}

export function toTaskRef(row: TaskRow): TaskRef {
  return {
    id: row.id,
    title: row.title,
    projectId: row.projectId,
    branch: row.branch,
    worktreePath: row.worktreePath,
    pullNumber: row.pullNumber,
  }
}

// The columns `toTaskRef` reads, as a select shape: `tasks.active()` returns refs, and selecting the
// whole row only to throw eight columns away would be the projection lying about what it costs.
export const TASK_REF_COLUMNS = {
  id: schema.tasks.id,
  title: schema.tasks.title,
  projectId: schema.tasks.projectId,
  branch: schema.tasks.branch,
  worktreePath: schema.tasks.worktreePath,
  pullNumber: schema.tasks.pullNumber,
} as const

export const loadTask = async (db: AppDatabase, id: string): Promise<TaskRow | undefined> => {
  const [t] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, id))
  return t
}

// Startup context injection toggle: opt-out, so an absent preference means on. The key mirrors
// PrefKeys.startupContextInjection; core and client can't be imported from main, so it is a
// literal string here.
export const contextInjectionEnabled = async (db: AppDatabase, userId: string): Promise<boolean> => {
  const [row] = await db
    .select()
    .from(schema.prefs)
    .where(and(eq(schema.prefs.userId, userId), eq(schema.prefs.key, 'startup_context_injection')))
    .limit(1)
  return row?.value !== 'false'
}

// Live worktree status for every active task that has a worktree (docs/workspaces-and-tasks.md):
// dirty + changed-file count via git, and `missing` when the dir vanished (removed outside acorn).
// `only` narrows the roster before any Git runs, for a caller entitled to one task rather than all of
// them. Filtering here rather than at the route matters twice: the answer carries absolute worktree
// paths, which is a layout disclosure, and each row costs a `git status`, so a confined caller polling
// this would otherwise make the node do work for tasks it may not see.
export async function computeTaskStatuses(db: AppDatabase, only?: (taskId: string) => boolean): Promise<TaskStatus[]> {
  const all = await db
    .select({ id: schema.tasks.id, projectId: schema.tasks.projectId, worktreePath: schema.tasks.worktreePath })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.status, 'active'), isNotNull(schema.tasks.worktreePath)))
  const visible = all.filter((row) => !isTaskArchiving(row.id))
  const rows = only ? visible.filter((row) => only(row.id)) : visible

  // `git status` is async but still CPU/disk work. An unbounded Promise.all made every task start a
  // process at once, producing a periodic resource spike that grew with the task roster.
  const results = new Array<TaskStatus>(rows.length)
  let next = 0
  const worker = async () => {
    while (next < rows.length) {
      const index = next++
      const row = rows[index]!
      const path = row.worktreePath!
      if (!isDir(path)) {
        results[index] = { taskId: row.id, worktreePath: path, dirty: false, dirtyCount: 0, missing: true, branch: null, head: null }
        continue
      }
      const { dirty, count, branch, head } = await worktreePorcelain(path)
      results[index] = { taskId: row.id, worktreePath: path, dirty, dirtyCount: count, missing: false, branch, head }
      noticeHead(row.id, row.projectId, branch, head, dirty)
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, rows.length) }, worker))
  return results
}

// The last HEAD this node saw per task, so the status poll doubles as the HEAD observer
// (docs/plugins.md § Hearing a core event). Nothing in the tree hooks HEAD directly, and a
// commit from a PTY, an agent, or an outside editor has no hook to catch, so the poll that already
// runs `git status` on every active worktree is the one honest place to notice. The first sighting
// of a task seeds the map without a frame: a fresh node has nothing to compare against, and
// `reconcileWorktrees` seeds every task at boot for that reason.
//
// ponytail: the poll is the client's 10 s clock plus a re-pull on every `term:status` ping, so an
// in-app commit (changes pane, which pings status) is noticed within one round trip and an
// out-of-app one within ten seconds — but only while a client is attached. A node-side clock is the
// upgrade if a headless node ever needs to hear its own commits.
const lastHeads = new Map<string, string>()
function noticeHead(taskId: string, projectId: string, branch: string | null, head: string | null, dirty: boolean): void {
  if (!head) return
  const previous = lastHeads.get(taskId)
  lastHeads.set(taskId, head)
  if (previous && previous !== head) broadcastHeadChanged({ projectId, taskId, branch, head, dirty })
}

// Startup reconciliation (docs/workspaces-and-tasks.md): flag any persisted worktree whose directory is gone
// (manual rm) as needing repair. The rail/footer surface `missing` live; this just logs at boot.
export async function reconcileWorktrees(db: AppDatabase): Promise<void> {
  try {
    const missing = (await computeTaskStatuses(db)).filter((s) => s.missing)
    if (missing.length) log.warn(`${missing.length} task worktree(s) missing on disk (needs repair): ${missing.map((m) => m.worktreePath).join(', ')}`)
  } catch {
    // best-effort: never block startup on status
  }
}

// Repo / branch / PR context for a session, derived through the taskId → tasks join
// (docs/workspaces-and-tasks.md). The session row no longer denormalizes repo/pull; this is the single read.
export function taskContext(t: TaskRef | undefined, github?: { owner: string; name: string } | null): Pick<TerminalSession, 'repo' | 'pull'> {
  if (!t) return {}
  return {
    repo: github ?? undefined,
    pull: t.pullNumber != null ? { number: t.pullNumber } : undefined,
  }
}

export async function projectForTask(db: AppDatabase, t: Pick<TaskRef, 'projectId'>): Promise<ProjectRow | null> {
  return getProject(db, t.projectId)
}

// Fired once per task, right after its worktree is first created and configured files are copied.
//
// A hook rather than a capability since phase 4 of the layout programme (server/pluginHost/hooks.ts,
// docs/plugins.md § Hooks). It used to be one typed slot the terminal plugin filled, which meant one
// plugin could run setup and a second had nowhere to say so. The choke point is still core's; what
// changed is that any number of packages may take a turn here, in the owner's order, each bounded and
// each recorded on its own roster row when it fails.

// The task's worktree must still be a live worktree ON the task's branch. Throws rather than
// degrading: every path that resolves a cwd is about to run something in it.
function assertOnBranch(path: string, branch: string): void {
  const on = worktreeBranch(path)
  if (on !== branch) throw new BridgeError(409, 'worktree-stale', staleWorktreeReason(path, branch, on))
}

// For a worktree the task already owns, HEAD is the fact and the task row follows it. Work that
// needs two pull requests switches branch inside the one worktree, and the task has to keep working
// across that, so a live worktree on another branch updates `tasks.branch` rather than refusing.
// The column is not decoration: it is the head a pull request opens from and the ACORN_BRANCH every
// process reads, so leaving it behind makes those lie about the tree on disk.
//
// A directory that is no longer a live worktree, or whose HEAD is detached, still refuses. There is
// no branch to adopt, and a null branch means something else here: run in the project root.
//
// The directory keeps the name it was created under, since the path is persisted and only rederived
// from the branch when there is no worktree yet.
async function adoptBranch(db: AppDatabase, t: TaskRef, path: string, branch: string): Promise<void> {
  const on = worktreeBranch(path)
  if (!on) throw new BridgeError(409, 'worktree-stale', staleWorktreeReason(path, branch, on))
  if (on === branch) return
  await db.update(schema.tasks).set({ branch: on, updatedAt: Date.now() }).where(eq(schema.tasks.id, t.id))
  log.info(`task ${t.id} adopted branch '${on}' from ${path}, was '${branch}'`)
  // Same event worktree creation uses: consumers re-read the task row (docs/plugins.md § Hearing a
  // core event).
  broadcastTasksChanged({ taskId: t.id })
}

const inflightCreates = new Map<string, Promise<{ cwd: string; isWorktree: boolean; created: boolean }>>()

// Archive claims the task first, then awaits any creator that passed the gate before the claim. A
// creator checks the gate again after its initial database reads, so none can enter after this wait.
export async function waitForTaskWorktreeCreation(taskId: string): Promise<void> {
  await inflightCreates.get(taskId)?.catch(() => undefined)
}

export async function resolveTaskCwd(
  db: AppDatabase,
  t: TaskRef | undefined,
  _baseCheckout: string | undefined,
): Promise<{ cwd: string; isWorktree: boolean; created: boolean }> {
  if (t && isTaskArchiving(t.id)) throw new BridgeError(409, 'task-archiving', 'Task archive is in progress.')
  const project = t ? await projectForTask(db, t) : null
  const projectRoot = project?.path && isDir(project.path) ? project.path : undefined
  // The project row is authoritative. `baseCheckout` remains in the seam for callers compiled against
  // the pre-project API, but accepting it here would let a renderer steer a project with a null/moved
  // path into an arbitrary folder.
  const checkout = projectRoot
  if (!t || !checkout) return { cwd: homedir(), isWorktree: false, created: false }
  // projectForTask awaited above. Recheck so an archive that claimed the task during that read wins
  // before this call can reuse or create a worktree.
  if (isTaskArchiving(t.id)) throw new BridgeError(409, 'task-archiving', 'Task archive is in progress.')
  // Branchless tasks never use a persisted worktree: they run in the project root.
  if (!t.branch || project?.vcs !== 'git') return { cwd: checkout, isWorktree: false, created: false }
  if (t.worktreePath && isDir(t.worktreePath)) {
    const isProjectRoot = !!projectRoot && resolve(t.worktreePath) === resolve(projectRoot)
    // A path persisted once used to be trusted forever, until docs/workspaces-and-tasks.md §
    // Worktrees and setup: verify rather than assume before handing a persisted path back.
    if (!isProjectRoot) await adoptBranch(db, t, t.worktreePath, t.branch)
    return { cwd: t.worktreePath, isWorktree: !isProjectRoot, created: false }
  }
  const branch = t.branch
  const inflight = inflightCreates.get(t.id)
  if (inflight) return inflight
  const create = (async () => {
    const owner = project?.githubOwner ?? 'p'
    const repo = project?.githubName ?? slugifyProjectName(project?.name ?? 'project')
    const wt = await ensureWorktree(
      worktreesRoot,
      checkout,
      owner,
      repo,
      branch,
      t.pullNumber,
    )
    // Falling back to the project root here put the task in the main checkout, on whatever branch
    // the user last left it, silently, and typically alongside whatever other task lives there.
    // The failures that reach this line (git refusing a branch already checked out in another
    // worktree, a stale directory) are all ones the user has to act on, so say so instead.
    if (!wt.ok) throw new BridgeError(409, 'worktree-unavailable', wt.reason)
    assertOnBranch(wt.path, branch)
    await db.update(schema.tasks).set({ worktreePath: wt.path, updatedAt: Date.now() }).where(eq(schema.tasks.id, t.id))
    // The task row just gained a worktree, and archive already announces losing one, so "worktree
    // created / removed" folds into `tasks:changed`: a consumer re-reads `worktreePath`
    // (docs/plugins.md § Hearing a core event).
    broadcastTasksChanged({ taskId: t.id })
    if (wt.created) {
      await copyConfiguredFiles(db, t, checkout, wt.path)
      // Awaited, not fired and forgotten: setup runs real commands in this worktree and the terminal
      // that opens next expects to find them done. The chain runner bounds each handler, so an
      // interceptor that hangs delays this by its own timeout and no longer.
      await runHook('core:worktree-created', { taskId: t.id, path: wt.path })
    }
    return { cwd: wt.path, isWorktree: true, created: wt.created }
  })()
  inflightCreates.set(t.id, create)
  try {
    return await create
  } finally {
    inflightCreates.delete(t.id)
  }
}

// The on-disk root the editor/local-git panes operate on: the task's worktree (created lazily,
// like the terminal), or null if the repo has no mapped checkout yet. Re-derived per IPC call so
// the task id, not a renderer-supplied absolute path, is the capability.
export async function taskRoot(db: AppDatabase, taskId: string): Promise<string | null> {
  const t = await loadTask(db, taskId)
  // Archived tasks retain their rows for history. They must not recreate the worktree that archive
  // removed, and an active row claimed by archive must stop serving filesystem reads immediately.
  if (!t || t.status !== 'active' || isTaskArchiving(taskId)) return null
  const project = await projectForTask(db, t)
  const baseCheckout = project?.path && isDir(project.path) ? project.path : undefined
  if (!baseCheckout) return null
  // Callers of this treat null as "no worktree yet" and degrade cleanly, so a stale or unavailable
  // worktree becomes null here rather than an exception through every editor/changes/db read. The
  // loud path is the one that spawns a session in it.
  try {
    const { cwd } = await resolveTaskCwd(db, t, baseCheckout)
    return resolve(cwd)
  } catch (e) {
    log.warn(`no usable worktree for task ${taskId} - ${describeError(e).message}`)
    return null
  }
}

export { resolveInRoot } from '../core/fs'

// The setup script and trigger configured for this project. 'off' never runs, 'created' pre-creates
// the worktree at task creation, and 'terminal' leaves creation lazy. The script runs once when the
// worktree is first created through the onWorktreeCreated hook.
export type SetupTrigger = 'off' | 'created' | 'terminal'
export async function projectSetup(db: AppDatabase, projectId: string): Promise<{ script: string | null; trigger: SetupTrigger }> {
  const config = await getProjectConfig(db, projectId)
  return { script: config?.config.setupScript ?? null, trigger: config?.config.setupScriptTrigger ?? 'terminal' }
}

// Copy files into a fresh worktree (docs/workspaces-and-tasks.md § Worktrees and setup): read the
// config from the source checkout, since the entries are usually gitignored and only it has them.
// Warnings are logged, never thrown, so a failed copy never blocks worktree creation.
export async function copyConfiguredFiles(db: AppDatabase, t: Pick<TaskRef, 'projectId'>, checkout: string, worktreePath: string): Promise<void> {
  try {
    // `copy` is repo/user config only, so this layer needs nothing from the project row.
    const cfg = loadRepoConfig(checkout, homedir(), {})
    if (!cfg.copy.length) return
    const res = copyWorktreeFiles(checkout, worktreePath, cfg.copy)
    for (const w of res.warnings) log.warn(w)
  } catch (e) {
    log.warn(`copy failed: ${describeError(e).message}`)
  }
}

export async function workspaceIdForProject(db: AppDatabase, projectId: string): Promise<string | null> {
  const project = await getProject(db, projectId)
  return project?.workspaceId ?? null
}

// The task's workspace id, the scoping key the knowledge and harness surfaces use.
export async function workspaceIdFor(db: AppDatabase, taskId: string): Promise<string> {
  const t = await loadTask(db, taskId)
  if (!t) throw new Error('Task not found.')
  const workspaceId = await workspaceIdForProject(db, t.projectId)
  if (!workspaceId) throw new Error('Task has no workspace.')
  return workspaceId
}

export async function repoFor(db: AppDatabase, taskId: string): Promise<string> {
  const t = await loadTask(db, taskId)
  if (!t) throw new Error('Task not found.')
  const project = await projectForTask(db, t)
  return project?.githubOwner && project.githubName ? `${project.githubOwner}/${project.githubName}` : project?.name ?? ''
}

// Merged run-target config + the cwd to run in (the task worktree, created lazily like a terminal).
export async function taskRunConfig(
  db: AppDatabase,
  taskId: string,
): Promise<{ targets: RunTarget[]; cwd: string; errors: { source: string; message: string }[]; layouts: LayoutRecipe[]; repoTargetIds: string[] } | { error: string }> {
  const t = await loadTask(db, taskId)
  if (!t) return { error: 'Task not found.' }
  const project = await projectForTask(db, t)
  const baseCheckout = project?.path && isDir(project.path) ? project.path : undefined
  if (!baseCheckout) return { error: 'No checkout mapped for this repo yet.' }
  let cwd: string
  try {
    ({ cwd } = await resolveTaskCwd(db, t, baseCheckout))
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'No usable worktree for this task.' }
  }
  const config = project ? (await getProjectConfig(db, project.id))?.config : null
  const cfg = loadRepoConfig(cwd, homedir(), {
    devScript: config?.devScript,
    devRestartScript: config?.devRestartScript,
    runTargetsJson: config?.runTargets,
  })
  return { targets: cfg.runTargets, cwd, errors: cfg.errors, layouts: cfg.layouts, repoTargetIds: cfg.repoTargetIds }
}

function slugifyProjectName(name: string): string {
  return slugifyBranch(name) || 'project'
}
