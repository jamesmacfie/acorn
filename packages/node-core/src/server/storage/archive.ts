import { recordSetupDecision } from '../taskScripts/setup'
import { taskScripts } from '../taskScripts/service'
// Task archive orchestration. docs/workspaces-and-tasks/archive.md § Archive a task covers the
// lifecycle order.
//
// Split out from the route handler so it runs under plain Node against a temp git repo, with the
// PTY concerns injected: the live session map and drawer streaming.
import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { eq } from 'drizzle-orm'
import type { AppDatabase } from '../db'
import { schema } from '../db'
import type { ArchiveOpts, ArchiveResult, RestoreOpts, RestoreResult } from '@acorn/protocol/task.ts'
import { getProjectConfig } from '../projectConfig'
import { getWorktreesRoot, isDir, loadTask, projectForTask, resolveTaskCwd, toTaskRef, waitForTaskWorktreeCreation } from '../worktrees/taskWorktree'
import { buildSessionEnv } from '../taskEnv'
import { branchExists, removeWorktree } from '../worktrees/worktrees'
import { beginTaskArchive, finishTaskArchive } from '../worktrees/archiveGate'
import { broadcastTasksChanged } from '../notify'

const exec = promisify(execFile)

export const TEARDOWN_TIMEOUT_MS = 2 * 60 * 1000

export type TeardownResult = { exitCode: number | null; output: string; reason?: 'timeout' | 'spawn_failed' | 'cancelled' | 'nonzero_exit' }

// Run a teardown script to completion in the worktree, which still exists at this point. The default
// runner for tests and as a fallback. The app injects one that streams to the task drawer.
export async function runTeardownProcess(script: string, cwd: string, env: Record<string, string>): Promise<TeardownResult> {
  try {
    const { stdout, stderr } = await exec('/bin/sh', ['-c', script], { cwd, env, timeout: TEARDOWN_TIMEOUT_MS })
    return { exitCode: 0, output: stdout + stderr }
  } catch (err) {
    const e = err as { code?: number | string; stdout?: string; stderr?: string; killed?: boolean; message?: string }
    return {
      exitCode: typeof e.code === 'number' ? e.code : null,
      reason: e.killed ? 'timeout' : typeof e.code === 'number' ? 'nonzero_exit' : 'spawn_failed',
      // exec errors can include the complete shell command. Keep only captured process output.
      output: `${e.stdout ?? ''}${e.stderr ?? ''}`,
    }
  }
}

export type ArchiveDeps = {
  isDir: (p: string) => boolean
  // Live-session control. The map and PTYs live in terminal.ts, and tests stub these.
  runningCount: (taskId: string) => number
  killRunning: (taskId: string) => void
  dropTaskSessions: (taskId: string) => Promise<void>
  // Teardown runner. The app streams it through a drawer session, and tests use runTeardownProcess.
  runTeardown: (script: string, cwd: string, env: Record<string, string>, taskId: string, attempt?: { attemptId: string; generation: number }) => Promise<TeardownResult>
  // The plugin cleanups the owner ticked in the archive dialog, resolved and run by the caller
  // (server/pluginHost/taskChecks.ts). Injected rather than imported, like every other dep here, so this
  // module never reaches into the server layer. It returns the plugin ids whose cleanup failed. The
  // archive still completes, because a failed cleanup is no reason to strand the task, but the owner
  // is told.
  applyTaskChecks?: (task: { id: string; worktreePath: string | null }, ids: readonly string[]) => Promise<string[]>
  // The `core:task-archiving` hook chain (server/pluginHost/hooks.ts), injected for the same reason.
  // Unlike the checks above it always runs, so plugin work that must not outlive the task stops here.
  taskArchiving?: (taskId: string) => Promise<void>
}

// The repo-level teardown script, paired with repoSetup in taskWorktree.ts.
async function teardownScriptFor(db: AppDatabase, projectId: string): Promise<string | null> {
  const config = await getProjectConfig(db, projectId)
  return config?.config.teardownScript?.trim() || null
}

export async function archiveTask(db: AppDatabase, id: string, opts: ArchiveOpts, deps: ArchiveDeps): Promise<ArchiveResult> {
  if (!beginTaskArchive(id)) return { ok: false, reason: 'Task archive is already in progress.' }
  try {
    // A root request that began before the claim may still be creating the worktree. Let it finish,
    // then load the authoritative path that archive must remove. Later root requests stop at the gate.
    await waitForTaskWorktreeCreation(id)
    return await archiveClaimedTask(db, id, opts, deps)
  } finally {
    finishTaskArchive(id)
  }
}

async function archiveClaimedTask(db: AppDatabase, id: string, opts: ArchiveOpts, deps: ArchiveDeps): Promise<ArchiveResult> {
  // Defaults match the menu archive: remove the worktree, refuse a dirty or running task.
  const deleteWorktree = opts.deleteWorktree ?? true
  const force = opts.force ?? false
  const running = deps.runningCount(id)
  if (running && !force) return { ok: false, reason: `Stop ${running} running session${running > 1 ? 's' : ''} first.` }
  const [t] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, id))
  if (!t) return { ok: false, reason: 'Task not found.' }
  const project = await projectForTask(db, t)
  const projectRoot = project?.path ? resolve(project.path) : null
  const ownsWorktree = !!t.worktreePath && (!projectRoot || resolve(t.worktreePath) !== projectRoot)

  // Teardown runs while the worktree and any services still exist, before sessions stop and before
  // removal. A non-zero exit pauses the archive so the caller can abort or re-invoke with
  // skipTeardown. Nothing has been torn down yet.
  const scripts = taskScripts(db)
  const script = project ? await teardownScriptFor(db, project.id) : null
  const skip = opts.skipTeardown ? 'user_skipped' : !deleteWorktree || !ownsWorktree || !t.worktreePath || !deps.isDir(t.worktreePath) || !project ? 'not_applicable' : !script ? 'not_configured' : undefined
  const attempt = scripts.admit(id, 'teardown', skip)
  if (deleteWorktree && ownsWorktree && !opts.skipTeardown && t.worktreePath && deps.isDir(t.worktreePath) && project) {
    if (script) {
      const env = buildSessionEnv({
        taskId: t.id,
        cwd: t.worktreePath,
        task: {
          projectId: project.id,
          projectName: project.name,
          github: project.githubOwner && project.githubName ? { owner: project.githubOwner, name: project.githubName } : null,
          branch: t.branch,
          title: t.title,
        },
      })
      const identity = { attemptId: attempt.attemptId!, generation: attempt.generation }
      let res: TeardownResult
      try { res = await deps.runTeardown(script, t.worktreePath, env, t.id, identity) }
      catch { res = { exitCode: null, output: '', reason: 'spawn_failed' } }
      // Fallback runners return evidence in their result; the PTY runner already reported it.
      scripts.report(identity, { type: 'output', data: res.output })
      if (res.reason === 'timeout' || res.reason === 'spawn_failed') scripts.report(identity, { type: 'failed', reason: res.reason })
      else if (res.reason === 'cancelled') scripts.report(identity, { type: 'interrupted', reason: 'cancelled' })
      else scripts.report(identity, { type: 'exit', exitCode: res.exitCode })
      if (res.exitCode !== 0) {
        return { ok: false, reason: `Teardown script failed (exit ${res.exitCode ?? 'timeout'}).`, teardownFailed: true, output: res.output.slice(-2000) }
      }
    }
  }

  if (running) deps.killRunning(id)
  // Plugin sessions stop at the same point as the terminal's, before removal. An agent in the middle
  // of a turn is still writing into the worktree, and removing the folder under it can leave files
  // behind or make git refuse.
  await deps.taskArchiving?.(id)

  // Plugin cleanups, at the same point and for the same reason as the teardown script above: the
  // worktree still exists, so a check that needs it has it. This is a step with a known position and
  // a result, rather than a client-side call racing the archive request.
  const checkFailures = opts.applyChecks?.length
    ? await deps.applyTaskChecks?.({ id: t.id, worktreePath: t.worktreePath }, opts.applyChecks) ?? []
    : []

  if (deleteWorktree && ownsWorktree && t.worktreePath && project?.path && project.vcs === 'git') {
    const res = await removeWorktree(project.path, t.worktreePath, force, getWorktreesRoot()) // force discards a dirty tree
    if (!res.ok) return res
    // With no mapped checkout there is nothing to git-remove, so archive anyway and drop the
    // orphaned reference.
  }
  await deps.dropTaskSessions(id)
  await db
    .update(schema.tasks)
    .set({ status: 'archived', archivedAt: Date.now(), worktreePath: null, updatedAt: Date.now() })
    .where(eq(schema.tasks.id, id))
  broadcastTasksChanged({ taskId: id })
  // Archived, but say what did not happen. `ok` stays true, because the task is archived, and
  // reporting a failure would have the caller offer a retry for work already done.
  return {
    ok: true,
    ...(checkFailures.length ? { cleanupFailed: checkFailures } : {}),
  }
}

// Put an archived task back (docs/workspaces-and-tasks/archive.md § Restoring a task). Archive kept the row,
// the branch, and every plugin's data, so this is a status flip plus rebuilding the worktree.
//
// The worktree is rebuilt now rather than by the first pane that asks for it, because the two ways it
// fails (the branch is checked out somewhere else, or it no longer exists) need the owner, and a pane
// that silently gets no folder would hide both. A failed rebuild leaves the task archived.
export async function restoreTask(db: AppDatabase, id: string, opts: RestoreOpts = {}): Promise<RestoreResult> {
  const t = await loadTask(db, id)
  if (!t) return { ok: false, reason: 'Task not found.' }
  if (t.status === 'active') return { ok: true }
  if (t.status !== 'archived') return { ok: false, reason: 'Only an archived task can be restored.' }
  const project = await projectForTask(db, t)
  const checkout = project?.vcs === 'git' && project.path && isDir(project.path) ? project.path : null
  const branch = checkout ? t.branch : null
  // A pull request task fetches its head again, so only a local branch can be lost for good.
  if (checkout && branch && t.pullNumber == null && !opts.newBranch && !(await branchExists(checkout, branch))) {
    return { ok: false, reason: `Branch '${branch}' no longer exists.`, branchMissing: true }
  }
  if (!checkout || !branch) taskScripts(db).newGeneration(id)
  await db.update(schema.tasks).set({ status: 'active', archivedAt: null, updatedAt: Date.now() }).where(eq(schema.tasks.id, id))
  if (checkout && branch) {
    try {
      await resolveTaskCwd(db, toTaskRef(t), checkout)
    } catch (err) {
      await db
        .update(schema.tasks)
        .set({ status: 'archived', archivedAt: t.archivedAt, worktreePath: null, updatedAt: Date.now() })
        .where(eq(schema.tasks.id, id))
      return { ok: false, reason: err instanceof Error ? err.message : 'Could not rebuild the worktree.' }
    }
  }
  // Git can reuse a retained worktree without firing worktree-created. Restoration still owns a
  // fresh cycle; existing folders provide no proof that this cycle ran setup.
  if (taskScripts(db).status(id).generation === t.scriptGeneration) taskScripts(db).newGeneration(id)
  await recordSetupDecision(db, id)
  broadcastTasksChanged({ taskId: id })
  return { ok: true }
}
