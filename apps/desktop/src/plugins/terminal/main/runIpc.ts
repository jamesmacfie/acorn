// Builds the RuntimeService over the session engine's glue. Run targets are exposed as the harness
// RunBridge over HTTP (server/routes/harness.ts) — HTTP routes replaced the run:* IPC channels. The
// service stays dependency-injected (runtime.ts) so it's unit-testable under plain Node.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AppDatabase } from '../../../core/server/db'
import type { RunTarget } from './runConfig'
import { RuntimeService } from './runtime'
import { loadTask, taskRunConfig } from '../../../core/main/taskWorktree'
import { buildSessionEnv } from './terminalUtils'
import { assertRepoConfigTrusted } from '../../../core/main/repoConfigTrust'

// The session-engine glue the service needs (terminal.ts provides it): spawn a target's command as
// a terminal session in the task worktree, and observe/kill it.
export type RunSessionGlue = {
  startSession(taskId: string, target: RunTarget, cwd: string): Promise<string>
  isRunning(sessionId: string): boolean
  exitCode(sessionId: string): number | null | undefined
  killSession(sessionId: string): void
}

// Runtime service (docs/workflows.md §2): run targets as terminal sessions in the task worktree.
// Short-lived scripts (stop / url_command) run out-of-band with the same ACORN_* env.
export function createRuntimeService(db: AppDatabase, glue: RunSessionGlue): RuntimeService {
  const runScript = async (taskId: string, script: string, cwd: string): Promise<{ ok: boolean; output?: string; reason?: string }> => {
    const t = await loadTask(db, taskId)
    const env = buildSessionEnv({
      taskId,
      cwd,
      task: t ? { repoOwner: t.repoOwner, repoName: t.repoName, branch: t.branch, title: t.title } : null,
    })
    try {
      const { stdout } = await promisify(execFile)('/bin/sh', ['-c', script], { cwd, env, timeout: 15_000 })
      return { ok: true, output: stdout }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : 'script failed' }
    }
  }
  return new RuntimeService({
    loadTargets: (taskId) => taskRunConfig(db, taskId),
    startSession: glue.startSession,
    isRunning: glue.isRunning,
    exitCode: glue.exitCode,
    killSession: glue.killSession,
    runScript,
    authorizeRepoConfig: (taskId) => assertRepoConfigTrusted(db, taskId),
  })
}
