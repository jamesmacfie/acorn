// The agent tools NO plugin can own yet (docs/agent-tools.md).
//
// `tools` is a contribution point now (server/plugin/types.ts § PluginToolRegistry): a converted plugin
// declares its own tools inside init, beside the engine each one drives. Three sets have moved —
// local_changes/local_diff/git_log to plugins/changes, memory_* to plugins/memory, run_* to
// plugins/terminal — and what is left here is the remainder, with the specific blocker per group:
//
//   - **task_*/pr_*/linked_issues/repo_info** are CORE's, not a plugin's: they read core's task/PR
//     mirror through the shared section registry (server/agentTools/contextSections.ts) and core's
//     `repos` table directly. They have no plugin to move to until github is converted, and even then
//     the mirror stays core's.
// The SIX browser_* tools that used to sit here are gone too, and their recorded blocker is worth
// restating because of what actually closed it. It was "plugins/preview has no node-side part at all", not
// "the driver is in Electron main" — the driver still IS in Electron main, still arrives as an injected
// task-addressed DesktopCapability, and no process boundary moved. What changed is that preview is a
// NodePlugin, so there is finally an owner to declare them against (plugins/preview/src/server/agentTools.ts).
//
// So what is left in this file is only the first group: core's own six. They have no plugin to move to and
// will not get one — `tasks`, `task_links` and the context assembler are core's, and the two that touch the
// github mirror reach it through core's own slot rather than a table.
//
// The FOUR notes_* tools that used to sit here are gone: plugins/notes is a NodePlugin now, so it owns
// its store and declares them itself (plugins/notes/src/main/agentTools.ts). Both recorded blockers were
// closed in the same change — the NotesStore instance is the plugin's rather than plugins/memory's, and
// `CoreServices.tasks.workspaceId` is the `workspace_repos` seam the 'workspace' scope needed.
//
// Registered under the owner 'core' and cleared first, so a process that starts the service more than
// once (service/runtime.test.ts does, four times) replaces these rather than throwing on the duplicate
// name — the same idempotency the plugin host gives a plugin.
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { assembleContext, parseInclude } from '@acorn/node-core/server/agentTools/contextSections.ts'
import { registerAgentTool, removeAgentTools, ToolError, type AgentToolContribution, type ToolContext } from '@acorn/node-core/server/agentTools/registry.ts'
import type { AppDatabase } from '@acorn/node-core/server/db/index.ts'
import { schema } from '@acorn/node-core/server/db/index.ts'
import { loadTask } from '@acorn/node-core/main/taskWorktree.ts'
import { repoMirrorSource } from '@acorn/node-core/server/repoMirror.ts'

// The owner id these contributions are registered under. Not a plugin namespace: the tools below are
// core's own, plus two groups being held by an unconverted plugin. It exists so they can be removed as a
// unit on a second boot, exactly as a plugin's are.
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
  // Core's `issues` context section used to be registered here too, and that was a bug rather than a
  // placement choice: this function is reached only from service/runtime.ts, so server/standalone.ts —
  // `pnpm dev:node`, and the node a client pairs with over the LAN — booted without it and quietly lost the
  // Linked-issues row from the context pane, the send block and the launch injector. It is at module scope in
  // contextSections.ts now, beside the registry and the assembler, where every entry point reaches it.
  // Nothing about it needed to be here: unlike the tools above it closes over no deps at all.
}
