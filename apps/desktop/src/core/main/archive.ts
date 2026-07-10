// Task archive orchestration (docs/workspaces-and-tasks.md + docs/terminal-and-agents.md). Extracted from the IPC
// handler so the lifecycle ordering — guard → teardown script (while the worktree still exists) →
// stop sessions → remove worktree → mark archived — is testable under plain Node against a real
// temp git repo. Electron/PTY concerns (the live session map, drawer streaming) are injected.
import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { and, eq } from 'drizzle-orm'
import type { AppDatabase } from '../server/db'
import { schema } from '../server/db'
import type { ArchiveOpts, ArchiveResult } from '../shared/terminal'
import { getRepoPath } from './repoPaths'
import { buildSessionEnv } from '../../plugins/terminal/main/terminalUtils'
import { removeWorktree } from './worktrees'

const exec = promisify(execFile)

export const TEARDOWN_TIMEOUT_MS = 2 * 60 * 1000

export type TeardownResult = { exitCode: number | null; output: string }

// Run a teardown script to completion in the (still-existing) worktree. The default runner used in
// tests and as a fallback; the app injects a session-backed runner that streams to the task drawer.
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
  // Live-session control (the map + PTYs live in terminal.ts; tests stub these).
  runningCount: (taskId: string) => number
  killRunning: (taskId: string) => void
  dropTaskSessions: (taskId: string) => Promise<void>
  // Teardown runner — the app streams it through a drawer session; tests use runTeardownProcess.
  runTeardown: (script: string, cwd: string, env: Record<string, string>, taskId: string) => Promise<TeardownResult>
}

// The workspace-level teardown script for a repo (the twin of workspaceSetup in terminal.ts).
async function teardownScriptFor(db: AppDatabase, owner: string, repo: string): Promise<string | null> {
  const [wr] = await db
    .select({ workspaceId: schema.workspaceRepos.workspaceId })
    .from(schema.workspaceRepos)
    .where(and(eq(schema.workspaceRepos.repoOwner, owner), eq(schema.workspaceRepos.repoName, repo)))
  if (!wr) return null
  const [ws] = await db
    .select({ teardownScript: schema.workspaces.teardownScript })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, wr.workspaceId))
  return ws?.teardownScript?.trim() || null
}

export async function archiveTask(db: AppDatabase, id: string, opts: ArchiveOpts, deps: ArchiveDeps): Promise<ArchiveResult> {
  // Defaults preserve the safe menu-archive behavior: remove the worktree, refuse dirty / running.
  const deleteWorktree = opts.deleteWorktree ?? true
  const force = opts.force ?? false
  const running = deps.runningCount(id)
  if (running && !force) return { ok: false, reason: `Stop ${running} running session${running > 1 ? 's' : ''} first.` }
  const [t] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, id))
  if (!t) return { ok: false, reason: 'Task not found.' }

  // Teardown (docs/terminal-and-agents.md): runs while the worktree and any services still exist — before
  // sessions are stopped and before removal. Non-zero exit pauses the archive so the caller can
  // choose continue (re-invoke with skipTeardown) or abort; nothing has been torn down yet.
  if (deleteWorktree && !opts.skipTeardown && t.worktreePath && deps.isDir(t.worktreePath)) {
    const script = await teardownScriptFor(db, t.repoOwner, t.repoName)
    if (script) {
      const env = buildSessionEnv({
        taskId: t.id,
        cwd: t.worktreePath,
        task: { repoOwner: t.repoOwner, repoName: t.repoName, branch: t.branch, title: t.title },
      })
      const res = await deps.runTeardown(script, t.worktreePath, env, t.id)
      if (res.exitCode !== 0) {
        return { ok: false, reason: `Teardown script failed (exit ${res.exitCode ?? 'timeout'}).`, teardownFailed: true, output: res.output.slice(-2000) }
      }
    }
  }

  if (running) deps.killRunning(id)
  if (deleteWorktree && t.worktreePath) {
    const mapped = await getRepoPath(db, t.repoOwner, t.repoName)
    // A "current-checkout" task borrows the main checkout (worktreePath === checkout) rather than
    // owning an isolated worktree — never git-remove it, just drop the reference on archive.
    const borrowsCheckout = mapped && resolve(t.worktreePath) === resolve(mapped.path)
    if (mapped && !borrowsCheckout) {
      const res = await removeWorktree(mapped.path, t.worktreePath, force) // force discards a dirty tree
      if (!res.ok) return res
    }
    // No mapped checkout → can't git-remove; we still archive and drop the (now-orphaned) reference.
  }
  await deps.dropTaskSessions(id)
  await db
    .update(schema.tasks)
    .set({ status: 'archived', archivedAt: Date.now(), worktreePath: null, updatedAt: Date.now() })
    .where(eq(schema.tasks.id, id))
  return { ok: true }
}
