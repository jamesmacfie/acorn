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
//   - **notes_*** belong to plugins/notes, which is not a NodePlugin. Two things block the move, not
//     one: the NotesStore INSTANCE is constructed by plugins/memory's registerKnowledgeIpc (one store
//     for the pane, the tools and the context assembler), and the 'workspace' note scope needs
//     `workspaceIdFor` over core's `workspace_repos` table, for which CoreServices has no seam. Adding
//     one with a single speculative caller is what this phase is supposed to stop doing.
//   - **browser_*** belong to plugins/preview, which has NO node-side part at all: previewService.ts and
//     browserService.ts import `electron` and run in Electron MAIN, and the driver arrives here as an
//     injected DesktopCapability. Converting it is not a tool move, it is a process-boundary change.
//
// Registered under the owner 'core' and cleared first, so a process that starts the service more than
// once (service/runtime.test.ts does, four times) replaces these rather than throwing on the duplicate
// name — the same idempotency the plugin host gives a plugin.
//
// Provenance: notes writes stamp author: agent + the agent session id (ctx.sessionId, from the
// x-acorn-session-id header).
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { assembleContext, parseInclude } from '@acorn/node-core/server/agentTools/contextSections.ts'
import { registerAgentTool, removeAgentTools, ToolError, type AgentToolContribution, type ToolContext } from '@acorn/node-core/server/agentTools/registry.ts'
import type { AppDatabase } from '@acorn/node-core/server/db/index.ts'
import { schema } from '@acorn/node-core/server/db/index.ts'
import type { NoteLocation, NoteScope } from '@acorn/protocol/notes.ts'
import type { BrowserDesktopCapability } from '@acorn/protocol/desktopCapabilities.ts'
import type { NotesStore } from '@acorn/plugin-notes/main/notes.ts'
import { loadTask, workspaceIdFor } from '@acorn/node-core/main/taskWorktree.ts'

// The owner id these contributions are registered under. Not a plugin namespace: the tools below are
// core's own, plus two groups being held by an unconverted plugin. It exists so they can be removed as a
// unit on a second boot, exactly as a plugin's are.
const OWNER = 'core'

export type AgentToolsDeps = {
  db: AppDatabase
  notesStore: NotesStore
  browser: BrowserDesktopCapability
}

async function assemble(deps: AgentToolsDeps, ctx: ToolContext, include: Set<string>) {
  const result = await assembleContext(deps.db, ctx.userLogin, ctx.taskId, include)
  if (!result) throw new ToolError('not_found', 'no such task')
  return result
}

async function noteLocationFor(db: AppDatabase, taskId: string, scope: NoteScope = 'task'): Promise<NoteLocation> {
  if (scope === 'task') return { scope, taskId }
  if (scope === 'global') return { scope }
  return { scope, workspaceId: await workspaceIdFor(db, taskId) }
}

export function buildAgentTools(deps: AgentToolsDeps): AgentToolContribution[] {
  const { db, notesStore, browser } = deps
  const empty = z.object({})

  // The context-read tools compose from the shared section registry (contextSections.ts). Its
  // notes/memory seams are filled once, in knowledgeIpc — the /context route and these tools read
  // the same assembler, so nothing to wire here.

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
        const [repoRow] = await db
          .select()
          .from(schema.repos)
          .where(and(eq(schema.repos.userId, ctx.userLogin), eq(schema.repos.owner, t.repoOwner), eq(schema.repos.name, t.repoName)))
        return { owner: t.repoOwner, name: t.repoName, defaultBranch: repoRow?.defaultBranch ?? null, branch: t.branch, worktreePath: t.worktreePath }
      },
    },

    // ── Notes (read + write tiers): one store, provenance stamped from tool scope (author: agent) ──
    {
      name: 'notes_list',
      description: 'Workspace notes for the current task (slug, title, kind, author).',
      input: z.object({ scope: z.enum(['task', 'workspace', 'global']).optional() }),
      scope: 'task',
      risk: 'read',
      handler: async (a, ctx) => notesStore.list(await noteLocationFor(db, ctx.taskId, (a as { scope?: NoteScope }).scope)),
    },
    {
      name: 'notes_read',
      description: 'Read one workspace note.',
      input: z.object({ slug: z.string(), scope: z.enum(['task', 'workspace', 'global']).optional() }),
      scope: 'task',
      risk: 'read',
      handler: async (a, ctx) => {
        try {
          const { slug, scope } = a as { slug: string; scope?: NoteScope }
          return await notesStore.read(await noteLocationFor(db, ctx.taskId, scope), slug)
        } catch {
          throw new ToolError('not_found', 'no such note')
        }
      },
    },
    {
      name: 'notes_write',
      description: 'Replace a note body (creates the note if missing, attributed to this agent).',
      input: z.object({ slug: z.string(), body: z.string(), scope: z.enum(['task', 'workspace', 'global']).optional() }),
      scope: 'task',
      risk: 'write',
      handler: async (a, ctx) => {
        const { slug, body, scope } = a as { slug: string; body: string; scope?: NoteScope }
        const location = await noteLocationFor(db, ctx.taskId, scope)
        const exists = await notesStore.read(location, slug).catch(() => null)
        if (exists) await notesStore.write(location, slug, body, { author: 'agent', originSessionId: ctx.sessionId, originTaskId: ctx.taskId })
        else await notesStore.append(location, slug, body, { author: 'agent', originSessionId: ctx.sessionId, originTaskId: ctx.taskId })
        return { ok: true }
      },
    },
    {
      name: 'notes_append',
      description: 'Append to a note (findings, plans, handoffs) — creates it if missing, attributed to this agent.',
      input: z.object({ slug: z.string(), text: z.string(), scope: z.enum(['task', 'workspace', 'global']).optional() }),
      scope: 'task',
      risk: 'write',
      handler: async (a, ctx) => {
        const { slug, text, scope } = a as { slug: string; text: string; scope?: NoteScope }
        await notesStore.append(await noteLocationFor(db, ctx.taskId, scope), slug, text, { author: 'agent', originSessionId: ctx.sessionId, originTaskId: ctx.taskId })
        return { ok: true }
      },
    },

    // ── Browser (execute tier): drive the task's preview webview via CDP ────────────────────────────
    {
      name: 'browser_navigate',
      description: "Navigate the task's preview browser to a URL (get it from run_status; http(s) only).",
      input: z.object({ url: z.string() }),
      scope: 'task',
      risk: 'execute',
      exposeToRenderer: true,
      handler: async (a, ctx) => browser.navigate(ctx.taskId, (a as { url: string }).url),
    },
    {
      name: 'browser_snapshot',
      description: 'Accessibility snapshot of the current page: a compact tree with element refs (e1, e2, …) for browser_click/browser_fill.',
      input: empty,
      scope: 'task',
      risk: 'execute',
      exposeToRenderer: true,
      handler: async (_a, ctx) => {
        return browser.snapshot(ctx.taskId)
      },
    },
    {
      name: 'browser_click',
      description: 'Click an element by its snapshot ref.',
      input: z.object({ ref: z.string() }),
      scope: 'task',
      risk: 'execute',
      exposeToRenderer: true,
      handler: async (a, ctx) => browser.click(ctx.taskId, (a as { ref: string }).ref),
    },
    {
      name: 'browser_fill',
      description: 'Fill a textbox by its snapshot ref (replaces the current value).',
      input: z.object({ ref: z.string(), text: z.string() }),
      scope: 'task',
      risk: 'execute',
      exposeToRenderer: true,
      handler: async (a, ctx) => {
        const { ref, text } = a as { ref: string; text: string }
        return browser.fill(ctx.taskId, ref, text)
      },
    },
    {
      name: 'browser_screenshot',
      description: 'Screenshot the current page (png data URI).',
      input: empty,
      scope: 'task',
      risk: 'execute',
      exposeToRenderer: true,
      handler: async (_a, ctx) => {
        return browser.screenshot(ctx.taskId)
      },
    },
    {
      name: 'browser_console',
      description: "The page's recent console output.",
      input: empty,
      scope: 'task',
      risk: 'execute',
      exposeToRenderer: true,
      handler: async (_a, ctx) => browser.console(ctx.taskId),
    },
  ]
}

export function wireAgentTools(deps: AgentToolsDeps): void {
  removeAgentTools(OWNER)
  for (const tool of buildAgentTools(deps)) registerAgentTool(OWNER, tool)
}
