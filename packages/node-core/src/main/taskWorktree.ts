// Task → checkout/worktree resolution shared by every privileged main-process surface. The task ID —
// never a renderer-supplied absolute path — is the capability; paths are re-derived from the DB per call.
import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import { and, eq, isNotNull } from 'drizzle-orm'
import type { AppDatabase } from '../server/db'
import { schema } from '../server/db'
import type { TaskStatus, TerminalSession } from '@acorn/protocol/terminal.ts'
import { slugifyBranch } from '@acorn/protocol/branch.ts'
import { loadRepoConfig, type LayoutRecipe, type RunTarget } from './runConfig'
import { getProject, type ProjectRow } from './projects'
import { getProjectConfig } from './projectConfig'
import { copyWorktreeFiles, ensureWorktree, staleWorktreeReason, worktreeBranch, worktreePorcelain } from './worktrees'
import { capabilityId, type CapabilityRegistry } from '../server/plugin/capabilities'
import { BridgeError } from '../server/bridge'

// Set once by registerTerminalIpc — where workspace worktrees are created (docs/workspaces-and-tasks.md).
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

// The plugin-facing projection of a task, and the reason it exists is the same one `ProjectRef` gives
// (main/projects.ts): `TaskRow` is `typeof schema.tasks.$inferSelect`, so returning it from
// `CoreServices.tasks` put core's own column names on the plugin contract — rename a column and the
// contract breaks with no signal, because the surface snapshot pins names and cannot see a type change
// shape underneath a stable one.
//
// Six fields, and not a byte more: they are exactly what plugin code reads today, and they are also
// everything core needs back when a plugin hands the ref straight to `resolveCwd` or `taskContext`.
// `icon`, `origin`, `status`, `parentId`, `sort`, `createdAt`, `updatedAt` and `archivedAt` are read by
// nobody outside core, so they stay core's.
// A TaskRow is structurally assignable to a TaskRef, which is why core's internal callers are untouched.
export type TaskRef = {
  id: string
  title: string
  projectId: string
  // null = run in the project root; non-null = an isolated Git worktree named for this branch.
  branch: string | null
  // null until the worktree is first created (Flow C), so a plugin that needs the path asks
  // `tasks.root(taskId)` rather than reading this and finding nothing.
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

// Per-project preferred base ref for NEW branches (docs/terminal-and-agents.md): the prefs key
// `base_ref:<projectId>`. It is user-owned state, so main-process callers must carry the
// identity that authorized the operation. A missing identity fails closed to git's normal
// origin/main fallback instead of selecting a stale preference from another login.
export const baseRefPref = async (db: AppDatabase, userId: string | null, projectId: string): Promise<string | null> => {
  if (!userId) return null
  const [row] = await db
    .select()
    .from(schema.prefs)
    .where(and(eq(schema.prefs.userId, userId), eq(schema.prefs.key, `base_ref:${projectId}`)))
    .limit(1)
  return row?.value ?? null
}

// Startup context injection toggle (docs/notes-and-memory.md): opt-out, so an ABSENT pref means ON.
// Key mirrors PrefKeys.startupContextInjection (core/client can't be imported from main).
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
export async function computeTaskStatuses(db: AppDatabase): Promise<TaskStatus[]> {
  const rows = await db
    .select({ id: schema.tasks.id, worktreePath: schema.tasks.worktreePath })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.status, 'active'), isNotNull(schema.tasks.worktreePath)))

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
        results[index] = { taskId: row.id, worktreePath: path, dirty: false, dirtyCount: 0, missing: true }
        continue
      }
      const { dirty, count } = await worktreePorcelain(path)
      results[index] = { taskId: row.id, worktreePath: path, dirty, dirtyCount: count, missing: false }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, rows.length) }, worker))
  return results
}

// Startup reconciliation (docs/workspaces-and-tasks.md): flag any persisted worktree whose directory is gone
// (manual rm) as needing repair. The rail/footer surface `missing` live; this just logs at boot.
export async function reconcileWorktrees(db: AppDatabase): Promise<void> {
  try {
    const missing = (await computeTaskStatuses(db)).filter((s) => s.missing)
    if (missing.length) console.warn(`[worktrees] ${missing.length} task worktree(s) missing on disk (needs repair): ${missing.map((m) => m.worktreePath).join(', ')}`)
  } catch {
    // best-effort — never block startup on status
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
// The terminal plugin owns the implementation; core owns this choke point and resolves the hook from
// the per-runtime registry passed by the caller. This avoids a process-global callback surviving one
// runtime into the next.
export type WorktreeCreatedHook = (task: TaskRef, cwd: string) => Promise<void>
export const WORKTREE_CREATED = capabilityId<WorktreeCreatedHook>('core.taskWorktreeCreated')
type CapabilityReader = Pick<CapabilityRegistry, 'get'>

// The task's worktree must still be a live worktree ON the task's branch. Throws rather than
// degrading: every path that resolves a cwd is about to run something in it.
function assertOnBranch(path: string, branch: string): void {
  const on = worktreeBranch(path)
  if (on !== branch) throw new BridgeError(409, 'worktree-stale', staleWorktreeReason(path, branch, on))
}

const inflightCreates = new Map<string, Promise<{ cwd: string; isWorktree: boolean; created: boolean }>>()
export async function resolveTaskCwd(
  db: AppDatabase,
  t: TaskRef | undefined,
  baseCheckout: string | undefined,
  userId: string | null = null,
  capabilities?: CapabilityReader,
): Promise<{ cwd: string; isWorktree: boolean; created: boolean }> {
  const project = t ? await projectForTask(db, t) : null
  const projectRoot = project?.path && isDir(project.path) ? project.path : undefined
  // The project row is authoritative. `baseCheckout` remains in the seam for callers compiled against
  // the pre-project API, but accepting it here would let a renderer steer a project with a null/moved
  // path into an arbitrary folder.
  const checkout = projectRoot
  if (!t || !checkout) return { cwd: homedir(), isWorktree: false, created: false }
  // Branchless tasks never use a persisted worktree: they run in the project root.
  if (!t.branch || project?.vcs !== 'git') return { cwd: checkout, isWorktree: false, created: false }
  if (t.worktreePath && isDir(t.worktreePath)) {
    const isProjectRoot = !!projectRoot && resolve(t.worktreePath) === resolve(projectRoot)
    // A path persisted once used to be trusted forever. When that worktree later went stale — pruned,
    // moved, or checked out onto another branch by hand — the task kept being handed another branch's
    // files, which is the tree its agent then reads, edits and reports from. Verify, don't assume.
    if (!isProjectRoot) assertOnBranch(t.worktreePath, t.branch)
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
      project ? await baseRefPref(db, userId, project.id) : null,
    )
    // Falling back to the project root here put the task in the MAIN checkout, on whatever branch the
    // user last left it — silently, and typically alongside whatever other task lives there. The
    // failures that reach this line (git refusing a branch already checked out in another worktree, a
    // stale directory) are all ones the user has to act on, so say so instead.
    if (!wt.ok) throw new BridgeError(409, 'worktree-unavailable', wt.reason)
    assertOnBranch(wt.path, branch)
    await db.update(schema.tasks).set({ worktreePath: wt.path, updatedAt: Date.now() }).where(eq(schema.tasks.id, t.id))
    if (wt.created) {
      await copyConfiguredFiles(db, t, checkout, wt.path)
      await capabilities?.get(WORKTREE_CREATED)?.(t, wt.path).catch((e) => console.warn('[worktrees] created-hook failed:', e))
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
// the taskId — not a renderer-supplied absolute path — is the capability.
export async function taskRoot(db: AppDatabase, taskId: string, userId: string | null = null, capabilities?: CapabilityReader): Promise<string | null> {
  const t = await loadTask(db, taskId)
  if (!t) return null
  const project = await projectForTask(db, t)
  const baseCheckout = project?.path && isDir(project.path) ? project.path : undefined
  if (!baseCheckout) return null
  // Callers of this treat null as "no worktree yet" and degrade cleanly, so a stale or unavailable
  // worktree becomes null here rather than an exception through every editor/changes/db read. The
  // loud path is the one that spawns a session in it.
  try {
    const { cwd } = await resolveTaskCwd(db, t, baseCheckout, userId, capabilities)
    return resolve(cwd)
  } catch (e) {
    console.warn('[worktrees] no usable worktree for task', taskId, '-', e instanceof Error ? e.message : e)
    return null
  }
}

export { resolveInRoot } from './core/fs'

// The setup script and trigger configured for this project. 'off' never runs, 'created' pre-creates
// the worktree at task creation, and 'terminal' leaves creation lazy. The script runs once when the
// worktree is first created through the onWorktreeCreated hook.
export type SetupTrigger = 'off' | 'created' | 'terminal'
export async function projectSetup(db: AppDatabase, projectId: string): Promise<{ script: string | null; trigger: SetupTrigger }> {
  const config = await getProjectConfig(db, projectId)
  return { script: config?.config.setupScript ?? null, trigger: config?.config.setupScriptTrigger ?? 'terminal' }
}

// Files-to-copy on a fresh worktree (docs/workflows.md §2): read the config from the SOURCE
// checkout (the entries are usually gitignored, so only it has them) and copy each into the new
// worktree. Best-effort — warnings are logged, never thrown.
export async function copyConfiguredFiles(db: AppDatabase, t: Pick<TaskRef, 'projectId'>, checkout: string, worktreePath: string): Promise<void> {
  try {
    const project = await projectForTask(db, t)
    const config = project ? (await getProjectConfig(db, project.id))?.config : null
    const cfg = loadRepoConfig(checkout, homedir(), { setupScript: config?.setupScript, teardownScript: config?.teardownScript })
    if (!cfg.copy.length) return
    const res = copyWorktreeFiles(checkout, worktreePath, cfg.copy)
    for (const w of res.warnings) console.warn(`[worktrees] ${w}`)
  } catch (e) {
    console.warn('[worktrees] copy failed:', e)
  }
}

export async function workspaceIdForProject(db: AppDatabase, projectId: string): Promise<string | null> {
  const project = await getProject(db, projectId)
  return project?.workspaceId ?? null
}

// The task's workspace id — the scoping key the knowledge + harness surfaces use.
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
  capabilities?: CapabilityReader,
): Promise<{ targets: RunTarget[]; cwd: string; errors: { source: string; message: string }[]; layouts: LayoutRecipe[]; repoTargetIds: string[] } | { error: string }> {
  const t = await loadTask(db, taskId)
  if (!t) return { error: 'Task not found.' }
  const project = await projectForTask(db, t)
  const baseCheckout = project?.path && isDir(project.path) ? project.path : undefined
  if (!baseCheckout) return { error: 'No checkout mapped for this repo yet.' }
  let cwd: string
  try {
    ({ cwd } = await resolveTaskCwd(db, t, baseCheckout, null, capabilities))
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'No usable worktree for this task.' }
  }
  const config = project ? (await getProjectConfig(db, project.id))?.config : null
  const cfg = loadRepoConfig(cwd, homedir(), {
    setupScript: config?.setupScript,
    teardownScript: config?.teardownScript,
    devScript: config?.devScript,
    devRestartScript: config?.devRestartScript,
    runTargetsJson: config?.runTargets,
  })
  return { targets: cfg.runTargets, cwd, errors: cfg.errors, layouts: cfg.layouts, repoTargetIds: cfg.repoTargetIds }
}

function slugifyProjectName(name: string): string {
  return slugifyBranch(name) || 'project'
}
