import { z } from 'zod'
import { assembleContext, parseInclude } from './contextSections.ts'
import { registerAgentTool, removeAgentTools, ToolError, type AgentToolContribution, type ToolContext } from './registry.ts'
import type { AppDatabase } from '../db/index.ts'
import { loadTask } from '../../main/taskWorktree.ts'
import { repoMirrorSource } from '../repoMirror.ts'

// The owner id for the core-owned contributions. Registration is idempotent across service boots.
const OWNER = 'core'

export type AgentToolsDeps = {
  db: AppDatabase
}

async function assemble(deps: AgentToolsDeps, ctx: ToolContext, include: Set<string>) {
  const result = await assembleContext(deps.db, ctx.userLogin, ctx.taskId, include)
  if (!result) throw new ToolError('not_found', 'no such task')
  return result
}

export function buildAgentTools(deps: AgentToolsDeps): AgentToolContribution[] {
  const { db } = deps
  const empty = z.object({})

  // The context-read tools compose from the shared section registry (contextSections.ts). Each section is
  // registered by whoever owns its rows — core's `issues` below, and `pr`/`notes`/`memory` by their plugins
  // — and the /context route reads the same assembler, so nothing to wire here.

  return [
    // ── Context-read (read tier): compose from the shared section registry, no self-fetch ──────────
    {
      name: 'task_current',
      description: "The current acorn task: repo, branch, worktree path, PR number and linked issues.",
      input: empty,
      scope: 'task',
      risk: 'read',
      handler: async (_a, ctx) => {
        const c = await assemble(deps, ctx, new Set(['issues']))
        return { ...c.task, links: c.issues }
      },
    },
    {
      name: 'task_context',
      description: 'The assembled context for the current task: PR detail, linked issues, notes and the repo memory index. Compact by design.',
      input: z.object({ include: z.string().optional().describe('comma list of context section ids (default: registry defaults)') }),
      scope: 'task',
      risk: 'read',
      handler: (a, ctx) => assemble(deps, ctx, parseInclude((a as { include?: string }).include)),
    },
    {
      name: 'pr_current',
      description: "The current task's pull request (title, body, changed-file count) from acorn's local mirror.",
      input: empty,
      scope: 'task',
      risk: 'read',
      handler: async (_a, ctx) => (await assemble(deps, ctx, new Set(['pr']))).pr ?? { status: 'no-pr', hint: 'This task has no linked pull request yet.' },
    },
    {
      name: 'pr_changed_files',
      description: "The changed file paths of the current task's pull request.",
      input: empty,
      scope: 'task',
      risk: 'read',
      handler: async (_a, ctx) => (await assemble(deps, ctx, new Set(['pr']))).pr?.changedFiles ?? [],
    },
    {
      name: 'linked_issues',
      description: 'Issues/errors linked to the current task (Linear tickets, Rollbar items), resolved from the local cache.',
      input: z.object({ provider: z.string().optional().describe("filter by provider, e.g. 'linear' or 'rollbar'") }),
      scope: 'task',
      risk: 'read',
      handler: async (a, ctx) => {
        const issues = (await assemble(deps, ctx, new Set(['issues']))).issues
        const provider = (a as { provider?: string }).provider
        return provider ? issues.filter((i) => i.provider === provider) : issues
      },
    },
    {
      name: 'repo_info',
      description: "The current task's repo: owner, name, default branch, task branch and worktree path.",
      input: empty,
      scope: 'task',
      risk: 'read',
      handler: async (_a, ctx) => {
        const t = await loadTask(db, ctx.taskId)
        if (!t) throw new ToolError('not_found', 'no such task')
        // Everything but the default branch is core's `tasks` row. The default branch is only GitHub's
        // opinion and its mirror is that plugin's own SQLite file now, so it arrives through the one slot
        // core fills with it (@acorn/node-core/server/repoMirror.ts). null was already a valid answer for an
        // unmirrored repo, so a disabled github plugin degrades into a case this tool's callers handle.
        const defaultBranch = await repoMirrorSource().defaultBranch(ctx.userLogin, t.repoOwner, t.repoName)
        return { owner: t.repoOwner, name: t.repoName, defaultBranch, branch: t.branch, worktreePath: t.worktreePath }
      },
    },

  ]
}

export function wireAgentTools(deps: AgentToolsDeps): void {
  removeAgentTools(OWNER)
  for (const tool of buildAgentTools(deps)) registerAgentTool(OWNER, tool)
}
