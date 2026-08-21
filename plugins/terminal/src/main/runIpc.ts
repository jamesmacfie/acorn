// Builds the RuntimeService over the session engine's glue. Run targets are exposed as the harness
// RunBridge over HTTP (server/routes/harness.ts), replacing the old run:* IPC channels, and as the
// `terminal.runTargets` capability for the agent-tool and workflow projections
// (contract/runTargets.ts). The service stays dependency-injected so it's unit-testable under plain
// Node.
//
// Its two DB-shaped needs are now CoreServices calls, because this plugin has no handle to core's
// database: `taskRunConfig` (the layered run-target config, docs/workspaces-and-tasks.md § Task) and
// the executable-config trust gate (docs/workflows.md § Configuration trust).
import { buildSessionEnv, type CoreServices, type RunTarget } from '@acorn/plugin-api/node'
import { RuntimeService } from './runtime'

// The session-engine glue the service needs (terminal.ts provides it): spawn a target's command as
// a terminal session in the task worktree, and observe/kill it.
export type RunSessionGlue = {
  startSession(taskId: string, target: RunTarget, cwd: string): Promise<string>
  isRunning(sessionId: string): boolean
  exitCode(sessionId: string): number | null | undefined
  killSession(sessionId: string): void
}

// Runtime service: run targets as terminal sessions in the task worktree (docs/terminal-and-agents.md
// § Process broker). Short-lived scripts (stop / url_command) run out-of-band with the same ACORN_*
// env.
export function createRuntimeService(core: Pick<CoreServices, 'tasks' | 'projects' | 'proc'>, glue: RunSessionGlue): RuntimeService {
  const runScript = async (taskId: string, script: string, cwd: string): Promise<{ ok: boolean; output?: string; reason?: string }> => {
    const t = await core.tasks.load(taskId)
    const project = t?.projectId ? await core.projects.byId(t.projectId) : null
    const env = buildSessionEnv({
      taskId,
      cwd,
      task: t && project
        ? { projectId: project.id, projectName: project.name, github: project.github, branch: t.branch, title: t.title }
        : null,
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
    authorizeRepoConfig: (taskId) => core.projects.assertConfigTrusted(taskId),
  })
}
