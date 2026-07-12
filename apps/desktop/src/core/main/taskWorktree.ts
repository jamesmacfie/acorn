// Task → checkout/worktree resolution shared by every privileged main-process surface (sessions,
// local-git, run, workflow, knowledge). Split out of terminal.ts (docs/terminal-and-agents.md):
// the taskId — never a renderer-supplied absolute path — is the capability; everything here
// re-derives paths from the DB per call.
import { existsSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, resolve, sep } from 'node:path'
import { and, eq } from 'drizzle-orm'
import type { AppDatabase } from '../server/db'
import { schema } from '../server/db'
import type { TaskStatus, TerminalSession } from '../shared/terminal'
import { loadRepoConfig, type LayoutRecipe, type RunTarget } from '../../plugins/terminal/main/runConfig'
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
// `base_ref:<owner>/<repo>`. Read by key alone — machine-local single-user app.
export const baseRefPref = async (db: AppDatabase, owner: string, repo: string): Promise<string | null> => {
  const [row] = await db.select().from(schema.prefs).where(eq(schema.prefs.key, `base_ref:${owner}/${repo}`)).limit(1)
  return row?.value ?? null
}

// Live worktree status for every active task that has a worktree (docs/workspaces-and-tasks.md/05):
// dirty + changed-file count via git, and `missing` when the dir vanished (removed outside acorn).
export async function computeTaskStatuses(db: AppDatabase): Promise<TaskStatus[]> {
  const rows = (await db.select().from(schema.tasks).where(eq(schema.tasks.status, 'active'))).filter((w) => w.worktreePath)
  return Promise.all(
    rows.map(async (w) => {
      const path = w.worktreePath!
      if (!isDir(path)) return { taskId: w.id, worktreePath: path, dirty: false, dirtyCount: 0, missing: true }
      const { dirty, count } = await worktreePorcelain(path)
      return { taskId: w.id, worktreePath: path, dirty, dirtyCount: count, missing: false }
    }),
  )
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
let onWorktreeCreated: ((t: TaskRow, cwd: string) => Promise<void>) | null = null
export const setOnWorktreeCreated = (fn: (t: TaskRow, cwd: string) => Promise<void>): void => {
  onWorktreeCreated = fn
}

// Lazy worktree on first use (Flow C, docs/workspaces-and-tasks.md). Reuse the task's worktree if
// it's set and still on disk; otherwise create one from the base checkout, keyed by branch, and
// persist worktreePath on the task. Returns the cwd + whether it's an isolated worktree. On
// any failure (no checkout mapped, git error) it degrades to the base checkout so the terminal
// still opens — the task just doesn't gain isolation until the next try.
// ponytail: graceful fallback over a hard error; the dirty/teardown guards still key off worktreePath.
// Concurrent callers for the same task (a pane poll + a terminal opening in the same second) share
// one in-flight creation, so `git worktree add` never races itself and the created-hook fires once.
const inflightCreates = new Map<string, Promise<{ cwd: string; isWorktree: boolean; created: boolean }>>()
export async function resolveTaskCwd(
  db: AppDatabase,
  t: TaskRow | undefined,
  baseCheckout: string | undefined,
): Promise<{ cwd: string; isWorktree: boolean; created: boolean }> {
  if (t?.worktreePath && isDir(t.worktreePath)) return { cwd: t.worktreePath, isWorktree: true, created: false }
  if (!t || !baseCheckout || !isDir(baseCheckout)) return { cwd: baseCheckout && isDir(baseCheckout) ? baseCheckout : homedir(), isWorktree: false, created: false }
  const inflight = inflightCreates.get(t.id)
  if (inflight) return inflight
  const create = (async () => {
    const wt = await ensureWorktree(worktreesRoot, baseCheckout, t.repoOwner, t.repoName, t.branch, t.pullNumber, await baseRefPref(db, t.repoOwner, t.repoName))
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
export async function taskRoot(db: AppDatabase, taskId: string): Promise<string | null> {
  const t = await loadTask(db, taskId)
  if (!t) return null
  const mapped = await getRepoPath(db, t.repoOwner, t.repoName)
  const baseCheckout = mapped?.path && isDir(mapped.path) ? mapped.path : undefined
  if (!baseCheckout) return null
  const { cwd } = await resolveTaskCwd(db, t, baseCheckout)
  return resolve(cwd)
}

// Confine a renderer-supplied relative path to within `root`; null on any escape. Two gates: a
// lexical one (rejects `..`/absolute paths) and a symlink one — resolve the real path of the nearest
// existing ancestor (the target itself may not exist yet on a new-file write) and require it to stay
// within root's real path, so a symlink inside the worktree can't point the read/write outside it
// (worktrees can hold arbitrary checked-out content, including hostile symlinks).
export function resolveInRoot(root: string, relPath: string): string | null {
  const abs = resolve(root, relPath)
  if (abs !== root && !abs.startsWith(root + sep)) return null
  try {
    const realRoot = realpathSync(root)
    let probe = abs
    while (probe !== root && !existsSync(probe)) probe = dirname(probe)
    const real = realpathSync(probe)
    return real === realRoot || real.startsWith(realRoot + sep) ? abs : null
  } catch {
    return null
  }
}

// The setup script + when-to-run configured on the workspace that owns this repo (docs/workspaces-and-tasks.md
// P5). trigger: 'off' never runs, 'created' pre-creates the worktree at task creation, 'terminal'
// (the default; null coalesces to it) leaves creation lazy. The script itself runs once, whenever
// the worktree is first created — via the onWorktreeCreated hook above (maybeRunSetup, terminal.ts).
export type SetupTrigger = 'off' | 'created' | 'terminal'
export async function workspaceSetup(db: AppDatabase, owner: string, repo: string): Promise<{ script: string | null; trigger: SetupTrigger }> {
  const [wr] = await db
    .select({ workspaceId: schema.workspaceRepos.workspaceId })
    .from(schema.workspaceRepos)
    .where(and(eq(schema.workspaceRepos.repoOwner, owner), eq(schema.workspaceRepos.repoName, repo)))
  if (!wr) return { script: null, trigger: 'terminal' }
  const [ws] = await db
    .select({ setupScript: schema.workspaces.setupScript, trigger: schema.workspaces.setupScriptTrigger })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, wr.workspaceId))
  return { script: ws?.setupScript ?? null, trigger: (ws?.trigger as SetupTrigger) || 'terminal' }
}

// Files-to-copy on a fresh worktree (docs/workflows.md §2): read the config from the SOURCE
// checkout (the entries are usually gitignored, so only it has them) and copy each into the new
// worktree. Best-effort — warnings are logged, never thrown.
export async function copyConfiguredFiles(db: AppDatabase, t: TaskRow, checkout: string, worktreePath: string): Promise<void> {
  try {
    const ws = await workspaceConfigRow(db, t.repoOwner, t.repoName)
    const cfg = loadRepoConfig(checkout, homedir(), { setupScript: ws?.setupScript, teardownScript: ws?.teardownScript })
    if (!cfg.copy.length) return
    const res = copyWorktreeFiles(checkout, worktreePath, cfg.copy)
    for (const w of res.warnings) console.warn(`[worktrees] ${w}`)
  } catch (e) {
    console.warn('[worktrees] copy failed:', e)
  }
}

// Workspace-level config columns for a repo (preview + scripts) — the DB fallback layer that
// loadRepoConfig merges below any committed .acorn/config.toml (docs/workflows.md §2).
export async function workspaceConfigRow(db: AppDatabase, owner: string, repo: string) {
  const [wr] = await db
    .select({ workspaceId: schema.workspaceRepos.workspaceId })
    .from(schema.workspaceRepos)
    .where(and(eq(schema.workspaceRepos.repoOwner, owner), eq(schema.workspaceRepos.repoName, repo)))
  if (!wr) return null
  const [ws] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, wr.workspaceId))
  return ws ?? null
}

// The task's workspace id / repo slug — the scoping keys the knowledge + harness surfaces use.
export async function workspaceIdFor(db: AppDatabase, taskId: string): Promise<string> {
  const t = await loadTask(db, taskId)
  if (!t) throw new Error('Task not found.')
  const ws = await workspaceConfigRow(db, t.repoOwner, t.repoName)
  if (!ws) throw new Error('Task has no workspace.')
  return ws.id
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
  const ws = await workspaceConfigRow(db, t.repoOwner, t.repoName)
  const cfg = loadRepoConfig(cwd, homedir(), {
    setupScript: ws?.setupScript,
    teardownScript: ws?.teardownScript,
    devScript: ws?.devScript,
    devRestartScript: ws?.devRestartScript,
    runTargetsJson: mapped?.runTargets,
  })
  return { targets: cfg.runTargets, cwd, errors: cfg.errors, layouts: cfg.layouts, repoTargetIds: cfg.repoTargetIds }
}
