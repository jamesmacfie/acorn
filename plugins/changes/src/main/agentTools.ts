// The changes plugin's agent tools: read-only git over the task worktree, as the `tools` contribution
// point (docs/plugins.md § Agent tools and MCP).
//
// These three were defined in apps/node/src/wiring/agentToolsWiring.ts, which had to import this
// plugin's localDiff module to do it — an app reaching into a plugin's internals to declare a
// capability the plugin owns. They read the SAME module the review pane's LocalGitBridge reads
// (main/localGit.ts), so the agent and the human see one truth about the working tree.
import { z } from 'zod'
import type { CoreServices } from '@acorn/node-core/main/core/index.ts'
import { ToolError, type AgentToolContribution } from '@acorn/node-core/server/agentTools/registry.ts'
import { gitLog, localChanges, localDiff } from './localDiff'

// Not an error: a task can legitimately exist before its worktree does, and an agent asking about
// changes in that state should get an explanation rather than a failed tool call.
const NO_WORKTREE = { status: 'no-worktree', hint: 'This task has no worktree — git tools need a checked-out worktree.' }

// `load`, deliberately NOT `root`: root() CREATES the worktree on first use, and a read-only tool must
// never have that side effect. Same reason the app-layer version called loadTask directly.
type ToolCore = Pick<CoreServices, 'tasks'>

const worktreeFor = async (core: ToolCore, taskId: string): Promise<string | null> => (await core.tasks.load(taskId))?.worktreePath ?? null

export function localGitAgentTools(core: ToolCore): AgentToolContribution[] {
  const empty = z.object({})
  return [
    {
      name: 'local_changes',
      description: 'Uncommitted changes in the task worktree (git status): staged/unstaged/untracked file list.',
      input: empty,
      scope: 'task',
      risk: 'read',
      handler: async (_a, ctx) => {
        const wt = await worktreeFor(core, ctx.taskId)
        return wt ? localChanges(wt) : NO_WORKTREE
      },
    },
    {
      name: 'local_diff',
      description: 'The unified diff of one uncommitted file in the task worktree.',
      input: z.object({ path: z.string().describe('repo-relative file path'), scope: z.enum(['unstaged', 'staged']).optional() }),
      scope: 'task',
      risk: 'read',
      handler: async (a, ctx) => {
        const wt = await worktreeFor(core, ctx.taskId)
        if (!wt) return NO_WORKTREE
        const { path, scope } = a as { path: string; scope?: 'unstaged' | 'staged' }
        try {
          return (await localDiff(wt, path, scope ?? 'unstaged')).patch || '(no diff)'
        } catch (e) {
          throw new ToolError('failed', e instanceof Error ? e.message : String(e))
        }
      },
    },
    {
      name: 'git_log',
      description: "Recent commits on the task's branch.",
      input: z.object({ n: z.number().int().min(1).max(100).optional() }),
      scope: 'task',
      risk: 'read',
      handler: async (a, ctx) => {
        const wt = await worktreeFor(core, ctx.taskId)
        return wt ? gitLog(wt, (a as { n?: number }).n ?? 10) : NO_WORKTREE
      },
    },
  ]
}
