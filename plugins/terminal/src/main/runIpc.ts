// Builds the RuntimeService over the session engine's glue. Run targets are exposed as the harness
// RunBridge over HTTP (server/routes/harness.ts) — HTTP routes replaced the run:* IPC channels — and
// as the `terminal.runTargets` capability for the agent-tool and workflow projections
// (contract/runTargets.ts). The service stays dependency-injected so it's unit-testable under plain Node.
//
// Its two DB-shaped needs are now CoreServices calls, because this plugin has no handle to core's
// database: `taskRunConfig` (repo_paths merged with the repo's committed config, in the lazily created
// worktree) and the executable-config trust gate.
import type { CoreServices } from '@acorn/node-core/main/core/index.ts'
import type { RunTarget } from '@acorn/node-core/main/runConfig.ts'
import { RuntimeService } from './runtime'
import { buildSessionEnv } from '@acorn/node-core/main/taskEnv.ts'

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
export function createRuntimeService(core: Pick<CoreServices, 'tasks' | 'repos' | 'proc'>, glue: RunSessionGlue): RuntimeService {
  const runScript = async (taskId: string, script: string, cwd: string): Promise<{ ok: boolean; output?: string; reason?: string }> => {
    const t = await core.tasks.load(taskId)
    const env = buildSessionEnv({
      taskId,
      cwd,
      task: t ? { repoOwner: t.repoOwner, repoName: t.repoName, branch: t.branch, title: t.title } : null,
    })
    // CoreServices.proc: bounded output and a process-group kill. A stop/url script routinely leaves
    // a grandchild behind, and the previous execFile only killed the direct child on timeout.
    const result = await core.proc.runProcess({ file: '/bin/sh', args: ['-c', script], cwd, env, timeoutMs: 15_000 })
    if (result.spawnError) return { ok: false, reason: result.spawnError }
    if (result.timedOut) return { ok: false, reason: 'script timed out' }
    if (result.code !== 0) return { ok: false, reason: result.stderr.trim().slice(0, 200) || 'script failed' }
    return { ok: true, output: result.stdout }
  }
  return new RuntimeService({
    loadTargets: (taskId) => core.tasks.runConfig(taskId),
    startSession: glue.startSession,
    isRunning: glue.isRunning,
    exitCode: glue.exitCode,
    killSession: glue.killSession,
    runScript,
    authorizeRepoConfig: (taskId) => core.repos.assertConfigTrusted(taskId),
  })
}
