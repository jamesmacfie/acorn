// Task archive orchestration. docs/workspaces-and-tasks.md § Worktrees and setup covers the
// lifecycle order.
//
// Split out from the route handler so it runs under plain Node against a temp git repo, with the
// PTY concerns injected: the live session map and drawer streaming.
import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { eq } from 'drizzle-orm'
import type { AppDatabase } from '../server/db'
import { schema } from '../server/db'
import type { ArchiveOpts, ArchiveResult } from '@acorn/protocol/terminal.ts'
import { getProjectConfig } from './projectConfig'
import { projectForTask } from './taskWorktree'
import { buildSessionEnv } from './taskEnv'
import { removeWorktree } from './worktrees'

const exec = promisify(execFile)

export const TEARDOWN_TIMEOUT_MS = 2 * 60 * 1000

export type TeardownResult = { exitCode: number | null; output: string }

// Run a teardown script to completion in the worktree, which still exists at this point. The default
// runner for tests and as a fallback. The app injects one that streams to the task drawer.
export async function runTeardownProcess(script: string, cwd: string, env: Record<string, string>): Promise<TeardownResult> {
  try {
    const { stdout, stderr } = await exec('/bin/sh', ['-c', script], { cwd, env, timeout: TEARDOWN_TIMEOUT_MS })
    return { exitCode: 0, output: stdout + stderr }
  } catch (err) {
    const e = err as { code?: number | string; stdout?: string; stderr?: string; killed?: boolean; message?: string }
    return {
      exitCode: typeof e.code === 'number' ? e.code : e.killed ? null : 1,
      output: `${e.stdout ?? ''}${e.stderr ?? ''}` || (e.message ?? 'teardown failed'),
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
  runTeardown: (script: string, cwd: string, env: Record<string, string>, taskId: string) => Promise<TeardownResult>
  // The plugin cleanups the owner ticked in the archive dialog, resolved and run by the caller
  // (server/plugin/taskChecks.ts). Injected rather than imported, like every other dep here, so this
  // module never reaches into the server layer. It returns the plugin ids whose cleanup failed. The
  // archive still completes, because a failed cleanup is no reason to strand the task, but the owner
  // is told.
  applyTaskChecks?: (task: { id: string; worktreePath: string | null }, ids: readonly string[]) => Promise<string[]>
}

// The repo-level teardown script, paired with repoSetup in taskWorktree.ts.
async function teardownScriptFor(db: AppDatabase, projectId: string): Promise<string | null> {
  const config = await getProjectConfig(db, projectId)
  return config?.config.teardownScript?.trim() || null
}

export async function archiveTask(db: AppDatabase, id: string, opts: ArchiveOpts, deps: ArchiveDeps): Promise<ArchiveResult> {
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
  if (deleteWorktree && ownsWorktree && !opts.skipTeardown && t.worktreePath && deps.isDir(t.worktreePath) && project) {
    const script = await teardownScriptFor(db, project.id)
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
      const res = await deps.runTeardown(script, t.worktreePath, env, t.id)
      if (res.exitCode !== 0) {
        return { ok: false, reason: `Teardown script failed (exit ${res.exitCode ?? 'timeout'}).`, teardownFailed: true, output: res.output.slice(-2000) }
      }
    }
  }

  if (running) deps.killRunning(id)

  // Plugin cleanups, at the same point and for the same reason as the teardown script above: the
  // worktree still exists, so a check that needs it has it. This is a step with a known position and
  // a result, rather than a client-side call racing the archive request.
  const checkFailures = opts.applyChecks?.length
    ? await deps.applyTaskChecks?.({ id: t.id, worktreePath: t.worktreePath }, opts.applyChecks) ?? []
    : []

  if (deleteWorktree && ownsWorktree && t.worktreePath && project?.path && project.vcs === 'git') {
    const res = await removeWorktree(project.path, t.worktreePath, force) // force discards a dirty tree
      if (!res.ok) return res
    // With no mapped checkout there is nothing to git-remove, so archive anyway and drop the
    // orphaned reference.
  }
  await deps.dropTaskSessions(id)
  await db
    .update(schema.tasks)
    .set({ status: 'archived', archivedAt: Date.now(), worktreePath: null, updatedAt: Date.now() })
    .where(eq(schema.tasks.id, id))
  // Archived, but say what did not happen. `ok` stays true, because the task is archived, and
  // reporting a failure would have the caller offer a retry for work already done.
  return checkFailures.length ? { ok: true, cleanupFailed: checkFailures } : { ok: true }
}
