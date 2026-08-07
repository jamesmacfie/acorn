// Task → checkout/worktree resolution shared by every privileged main-process surface. The task ID —
// never a renderer-supplied absolute path — is the capability; paths are re-derived from the DB per call.
import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import { and, eq, isNotNull } from 'drizzle-orm'
import type { AppDatabase } from '../server/db'
import { schema } from '../server/db'
import type { TaskStatus, TerminalSession } from '@acorn/protocol/terminal.ts'
import { loadRepoConfig, type LayoutRecipe, type RunTarget } from './runConfig'
import { getRepoPath } from './repoPaths'
import { copyWorktreeFiles, ensureWorktree, worktreePorcelain } from './worktrees'

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

export const loadTask = async (db: AppDatabase, id: string): Promise<TaskRow | undefined> => {
  const [t] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, id))
  return t
}

// Per-repo preferred base ref for NEW branches (docs/terminal-and-agents.md): the prefs key
// `base_ref:<owner>/<repo>`. It is user-owned state, so main-process callers must carry the
// identity that authorized the operation. A missing identity fails closed to git's normal
// origin/main fallback instead of selecting a stale preference from another login.
export const baseRefPref = async (db: AppDatabase, userId: string | null, owner: string, repo: string): Promise<string | null> => {
  if (!userId) return null
  const [row] = await db
    .select()
    .from(schema.prefs)
    .where(and(eq(schema.prefs.userId, userId), eq(schema.prefs.key, `base_ref:${owner}/${repo}`)))
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

// Live worktree status for every active task that has a worktree (docs/workspaces-and-tasks.md/05):
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
export function taskContext(t: TaskRow | undefined): Pick<TerminalSession, 'repo' | 'pull'> {
  if (!t) return {}
  return {
    repo: { owner: t.repoOwner, name: t.repoName },
    pull: t.pullNumber != null ? { number: t.pullNumber } : undefined,
  }
}

// Fired once per task, right after its worktree is first created and configured files are copied.
// Registered by the terminal plugin to run the workspace setup script (maybeRunSetup). It lives
// HERE — the single worktree-creation choke point — because every lazy creator funnels through
// resolveTaskCwd (first terminal, editor/changes panes via taskRoot, run config, workflows); hooks
// at individual callers miss whichever one happens to create the worktree first.
// Nullable on both ends: the plugin that fills it clears it again in dispose, so a hook closed over a
// torn-down engine cannot be invoked by the next boot's first worktree creation.
let onWorktreeCreated: ((t: TaskRow, cwd: string) => Promise<void>) | null = null
export const setOnWorktreeCreated = (fn: ((t: TaskRow, cwd: string) => Promise<void>) | null): void => {
  onWorktreeCreated = fn
}

const inflightCreates = new Map<string, Promise<{ cwd: string; isWorktree: boolean; created: boolean }>>()
export async function resolveTaskCwd(
  db: AppDatabase,
  t: TaskRow | undefined,
  baseCheckout: string | undefined,
  userId: string | null = null,
): Promise<{ cwd: string; isWorktree: boolean; created: boolean }> {
  if (t?.worktreePath && isDir(t.worktreePath)) return { cwd: t.worktreePath, isWorktree: true, created: false }
  if (!t || !baseCheckout || !isDir(baseCheckout)) return { cwd: baseCheckout && isDir(baseCheckout) ? baseCheckout : homedir(), isWorktree: false, created: false }
  const inflight = inflightCreates.get(t.id)
  if (inflight) return inflight
  const create = (async () => {
    const wt = await ensureWorktree(
      worktreesRoot,
      baseCheckout,
      t.repoOwner,
      t.repoName,
      t.branch,
      t.pullNumber,
      await baseRefPref(db, userId, t.repoOwner, t.repoName),
    )
    if (!wt.ok) return { cwd: baseCheckout, isWorktree: false, created: false }
    await db.update(schema.tasks).set({ worktreePath: wt.path, updatedAt: Date.now() }).where(eq(schema.tasks.id, t.id))
    if (wt.created) {
      await copyConfiguredFiles(db, t, baseCheckout, wt.path)
      await onWorktreeCreated?.(t, wt.path).catch((e) => console.warn('[worktrees] created-hook failed:', e))
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
export async function taskRoot(db: AppDatabase, taskId: string, userId: string | null = null): Promise<string | null> {
  const t = await loadTask(db, taskId)
  if (!t) return null
  const mapped = await getRepoPath(db, t.repoOwner, t.repoName)
  const baseCheckout = mapped?.path && isDir(mapped.path) ? mapped.path : undefined
  if (!baseCheckout) return null
  const { cwd } = await resolveTaskCwd(db, t, baseCheckout, userId)
  return resolve(cwd)
}

export { resolveInRoot } from './core/fs'

// The setup script and trigger configured for this repository. 'off' never runs, 'created' pre-creates
// the worktree at task creation, and 'terminal' leaves creation lazy. The script runs once when the
// worktree is first created through the onWorktreeCreated hook.
export type SetupTrigger = 'off' | 'created' | 'terminal'
export async function repoSetup(db: AppDatabase, owner: string, repo: string): Promise<{ script: string | null; trigger: SetupTrigger }> {
  const rp = await getRepoPath(db, owner, repo)
  return { script: rp?.setupScript ?? null, trigger: rp?.setupScriptTrigger ?? 'terminal' }
}

// Files-to-copy on a fresh worktree (docs/workflows.md §2): read the config from the SOURCE
// checkout (the entries are usually gitignored, so only it has them) and copy each into the new
// worktree. Best-effort — warnings are logged, never thrown.
export async function copyConfiguredFiles(db: AppDatabase, t: TaskRow, checkout: string, worktreePath: string): Promise<void> {
  try {
    const rp = await getRepoPath(db, t.repoOwner, t.repoName)
    const cfg = loadRepoConfig(checkout, homedir(), { setupScript: rp?.setupScript, teardownScript: rp?.teardownScript })
    if (!cfg.copy.length) return
    const res = copyWorktreeFiles(checkout, worktreePath, cfg.copy)
    for (const w of res.warnings) console.warn(`[worktrees] ${w}`)
  } catch (e) {
    console.warn('[worktrees] copy failed:', e)
  }
}

// The workspace a repo belongs to (its grouping membership). Repo config no longer lives on the
// workspace (repo-level-settings), so this resolves membership only: repo → workspaceRepos → id.
export async function workspaceIdForRepo(db: AppDatabase, owner: string, repo: string): Promise<string | null> {
  const [wr] = await db
    .select({ workspaceId: schema.workspaceRepos.workspaceId })
    .from(schema.workspaceRepos)
    .where(and(eq(schema.workspaceRepos.repoOwner, owner), eq(schema.workspaceRepos.repoName, repo)))
  return wr?.workspaceId ?? null
}

// The task's workspace id — the scoping key the knowledge + harness surfaces use.
export async function workspaceIdFor(db: AppDatabase, taskId: string): Promise<string> {
  const t = await loadTask(db, taskId)
  if (!t) throw new Error('Task not found.')
  const workspaceId = await workspaceIdForRepo(db, t.repoOwner, t.repoName)
  if (!workspaceId) throw new Error('Task has no workspace.')
  return workspaceId
}

export async function repoFor(db: AppDatabase, taskId: string): Promise<string> {
  const t = await loadTask(db, taskId)
  if (!t) throw new Error('Task not found.')
  return `${t.repoOwner}/${t.repoName}`
}

// Merged run-target config + the cwd to run in (the task worktree, created lazily like a terminal).
export async function taskRunConfig(
  db: AppDatabase,
  taskId: string,
): Promise<{ targets: RunTarget[]; cwd: string; errors: { source: string; message: string }[]; layouts: LayoutRecipe[]; repoTargetIds: string[] } | { error: string }> {
  const t = await loadTask(db, taskId)
  if (!t) return { error: 'Task not found.' }
  const mapped = await getRepoPath(db, t.repoOwner, t.repoName)
  const baseCheckout = mapped?.path && isDir(mapped.path) ? mapped.path : undefined
  if (!baseCheckout) return { error: 'No checkout mapped for this repo yet.' }
  const { cwd } = await resolveTaskCwd(db, t, baseCheckout)
  const cfg = loadRepoConfig(cwd, homedir(), {
    setupScript: mapped?.setupScript,
    teardownScript: mapped?.teardownScript,
    devScript: mapped?.devScript,
    devRestartScript: mapped?.devRestartScript,
    runTargetsJson: mapped?.runTargets,
  })
  return { targets: cfg.runTargets, cwd, errors: cfg.errors, layouts: cfg.layouts, repoTargetIds: cfg.repoTargetIds }
}
