// The terminal plugin's agent tools: the five run_* tools, as the `tools` contribution point
// (docs/plugins.md § Agent tools and MCP).
//
// They were defined in apps/node/src/wiring/agentToolsWiring.ts, which resolved the RuntimeService out
// of the capability registry purely so it could declare them. The service is built by this plugin's init
// (it closes over the live session map and this plugin's database), so the tools belong beside it.
//
// A run target IS a terminal session in the task worktree — start/stop/restart go through the same PTY
// engine the run pane drives, so an agent and a human cannot end up with two copies of `pnpm dev`.
import { z } from 'zod'
import { isRepoConfigTrustError } from '@acorn/node-core/main/repoConfigTrust.ts'
import { ToolError, type AgentToolContribution, type ToolContext } from '@acorn/node-core/server/agentTools/registry.ts'
import type { TerminalRunTargets } from '../contract/runTargets'

export function runAgentTools(runTargets: TerminalRunTargets, repoConfigTrustNotice: (taskId: string) => void = () => {}): AgentToolContribution[] {
  const empty = z.object({})

  // Starting a run target EXECUTES the repo's committed `.acorn/config.toml`, so it is behind the
  // hash-gated trust acknowledgement. The notice is broadcast so the human sees the review prompt in the
  // UI, and the agent gets a distinct 'needs-trust' kind rather than an opaque failure it might retry.
  const executeRun = async <T>(taskId: string, execute: () => Promise<T>): Promise<T> => {
    try {
      return await execute()
    } catch (error) {
      if (!isRepoConfigTrustError(error)) throw error
      repoConfigTrustNotice(taskId)
      throw new ToolError('needs-trust', 'Repo configuration must be reviewed and trusted before it can run.')
    }
  }

  // Only available when the task actually HAS run targets. The predicate re-evaluates per manifest fetch,
  // so run_* appear mid-session once a repo declares them (the MCP proxy sends tools/list_changed).
  const hasRunTargets = async (ctx: ToolContext): Promise<boolean> => {
    const t = await runTargets.targets(ctx.taskId)
    return 'targets' in t && t.targets.length > 0
  }
  const gated = { scope: 'task', risk: 'execute', exposeToRenderer: true, when: hasRunTargets, whenDescription: 'Only available in tasks with run targets.' } as const

  return [
    {
      ...gated,
      name: 'run_targets',
      description: "The repo's declared run targets with live status.",
      input: empty,
      handler: (_a, ctx) => runTargets.targets(ctx.taskId),
    },
    {
      ...gated,
      name: 'run_start',
      description: 'Start a run target in the task worktree.',
      input: z.object({ id: z.string() }),
      handler: (a, ctx) => executeRun(ctx.taskId, () => runTargets.start(ctx.taskId, (a as { id: string }).id)),
    },
    {
      ...gated,
      name: 'run_stop',
      description: "Stop a run target (runs its declared 'stop' first).",
      input: z.object({ id: z.string() }),
      handler: (a, ctx) => runTargets.stop(ctx.taskId, (a as { id: string }).id),
    },
    {
      ...gated,
      name: 'run_restart',
      description: 'Restart a run target: runs its declared restart command if it has one, else stops and starts it.',
      input: z.object({ id: z.string() }),
      handler: (a, ctx) => executeRun(ctx.taskId, () => runTargets.restart(ctx.taskId, (a as { id: string }).id)),
    },
    {
      ...gated,
      name: 'run_status',
      description: "A run target's status: { running, url?, exitCode? }.",
      input: z.object({ id: z.string() }),
      handler: (a, ctx) => runTargets.status(ctx.taskId, (a as { id: string }).id),
    },
  ]
}
