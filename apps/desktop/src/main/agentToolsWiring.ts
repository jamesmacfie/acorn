// Builds the agent-tool registry (docs/agent-tools.md, docs/next Phase 4): every agent capability
// as ONE AgentToolContribution, with its domain dep closed over. Installed via setAgentTools, so the
// server route (GET/POST /api/tasks/:id/tools) and the MCP server (which fetches the manifest and
// proxies calls) both project from this one list. Replaces the notes/memory/browser harness bridges
// and the 25 hand-written MCP tool bodies. Run targets keep their dedicated renderer routes
// (server/routes/harness.ts) — run appears here only as the agent-facing run_* tools.
//
// Provenance: notes/memory writes stamp author: agent + the agent session id (ctx.sessionId, from
// the x-acorn-session-id header). memory_write is PROPOSE-only — the human gate is the sole writer
// of accepted memory (Phase 4 invariant; docs/memory.md §1).
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { assembleContext, parseInclude } from '../server/agentTools/contextSections'
import { setAgentTools, ToolError, type AgentToolContribution, type ToolContext } from '../server/agentTools/registry'
import type { AppDatabase } from '../server/db'
import { schema } from '../server/db'
import type { NoteLocation, NoteScope } from '../shared/notes'
import { driverFor } from './browserService'
import { gitLog, localChanges, localDiff } from './localDiff'
import { getMemory, listMemories, MEMORY_TYPES, searchMemories, type MemoryType } from './memory'
import type { MemoryProposalStore } from './memoryProposals'
import type { NotesStore } from './notes'
import type { RuntimeService } from './runtime'
import { loadTask, repoFor, workspaceIdFor } from './taskWorktree'

export type AgentToolsDeps = {
  db: AppDatabase
  notesStore: NotesStore
  proposals: MemoryProposalStore
  runtime: RuntimeService
  reconciled(): Promise<void>
}

const asMemoryType = (type: string | undefined): MemoryType | undefined =>
  MEMORY_TYPES.includes(type as MemoryType) ? (type as MemoryType) : undefined

const NO_WORKTREE = { status: 'no-worktree', hint: 'This task has no worktree — git tools need a checked-out worktree.' }

async function assemble(deps: AgentToolsDeps, ctx: ToolContext, include: Set<string>) {
  const result = await assembleContext(deps.db, ctx.userLogin, ctx.taskId, include)
  if (!result) throw new ToolError('not_found', 'no such task')
  return result
}

async function worktreeFor(db: AppDatabase, taskId: string): Promise<string | null> {
  return (await loadTask(db, taskId))?.worktreePath ?? null
}

async function noteLocationFor(db: AppDatabase, taskId: string, scope: NoteScope = 'task'): Promise<NoteLocation> {
  if (scope === 'task') return { scope, taskId }
  if (scope === 'global') return { scope }
  return { scope, workspaceId: await workspaceIdFor(db, taskId) }
}

export function buildAgentTools(deps: AgentToolsDeps): AgentToolContribution[] {
  const { db, notesStore, proposals, runtime, reconciled } = deps
  const empty = z.object({})

  // The context-read tools compose from the shared section registry (contextSections.ts). Its
  // notes/memory seams are filled once, in knowledgeIpc — the /context route and these tools read
  // the same assembler, so nothing to wire here.

  const tools: AgentToolContribution[] = [
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

    // ── Read-only git over the task worktree (read tier): the same localDiff module the UI uses ────
    {
      name: 'local_changes',
      description: 'Uncommitted changes in the task worktree (git status): staged/unstaged/untracked file list.',
      input: empty,
      scope: 'task',
      risk: 'read',
      handler: async (_a, ctx) => {
        const wt = await worktreeFor(db, ctx.taskId)
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
        const wt = await worktreeFor(db, ctx.taskId)
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
        const wt = await worktreeFor(db, ctx.taskId)
        return wt ? gitLog(wt, (a as { n?: number }).n ?? 10) : NO_WORKTREE
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

    // ── Memory (read + write tiers): search/read the committed repo memory; memory_write PROPOSES ──
    {
      name: 'memory_search',
      description: 'Search repo memory (conventions, architecture, past fixes) — ranked, repo-scoped.',
      input: z.object({ query: z.string(), type: z.string().optional() }),
      scope: 'task',
      risk: 'read',
      handler: async (a, ctx) => {
        await reconciled()
        const { query, type } = a as { query: string; type?: string }
        return searchMemories(db, query, { repo: await repoFor(db, ctx.taskId), type: asMemoryType(type) })
      },
    },
    {
      name: 'memory_list',
      description: 'The repo memory index (name + description per memory).',
      input: z.object({ type: z.string().optional() }),
      scope: 'task',
      risk: 'read',
      handler: async (a, ctx) => {
        await reconciled()
        return listMemories(db, { repo: await repoFor(db, ctx.taskId), type: asMemoryType((a as { type?: string }).type) })
      },
    },
    {
      name: 'memory_get',
      description: 'Read one memory in full (body + file path).',
      input: z.object({ name: z.string() }),
      scope: 'task',
      risk: 'read',
      handler: async (a, ctx) => {
        await reconciled()
        const memory = await getMemory(db, { repo: await repoFor(db, ctx.taskId), name: (a as { name: string }).name })
        if (!memory) throw new ToolError('not_found', 'no such memory')
        return memory
      },
    },
    {
      name: 'memory_write',
      description: 'PROPOSE a new memory (convention/architecture/decision/fix/reference/feedback). A human reviews before it lands — nothing is written directly.',
      input: z.object({ name: z.string(), type: z.string(), description: z.string(), body: z.string() }),
      scope: 'task',
      risk: 'write',
      handler: async (a, ctx) => {
        const p = a as { name: string; type: string; description: string; body: string }
        try {
          return {
            ok: true,
            proposal: await proposals.propose({
              taskId: ctx.taskId,
              repo: await repoFor(db, ctx.taskId).catch(() => null),
              name: p.name,
              type: p.type as MemoryType,
              description: p.description,
              body: p.body,
              originSessionId: ctx.sessionId ?? null,
            }),
          }
        } catch (e) {
          // Propose validation (bad name/type) is the caller's fault, not a server fault.
          throw new ToolError('bad_request', e instanceof Error ? e.message : 'invalid proposal')
        }
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
      handler: async (a, ctx) => driverFor(ctx.taskId)?.navigate((a as { url: string }).url) ?? { ok: false, reason: 'No preview webview for this task — open the browser pane first.' },
    },
    {
      name: 'browser_snapshot',
      description: 'Accessibility snapshot of the current page: a compact tree with element refs (e1, e2, …) for browser_click/browser_fill.',
      input: empty,
      scope: 'task',
      risk: 'execute',
      exposeToRenderer: true,
      handler: async (_a, ctx) => {
        const d = driverFor(ctx.taskId)
        return d ? d.takeSnapshot() : { error: 'No preview webview for this task — open the browser pane first.' }
      },
    },
    {
      name: 'browser_click',
      description: 'Click an element by its snapshot ref.',
      input: z.object({ ref: z.string() }),
      scope: 'task',
      risk: 'execute',
      exposeToRenderer: true,
      handler: async (a, ctx) => driverFor(ctx.taskId)?.click((a as { ref: string }).ref) ?? { ok: false, reason: 'No preview webview for this task.' },
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
        return driverFor(ctx.taskId)?.fill(ref, text) ?? { ok: false, reason: 'No preview webview for this task.' }
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
        const d = driverFor(ctx.taskId)
        return d ? d.screenshot() : { error: 'No preview webview for this task.' }
      },
    },
    {
      name: 'browser_console',
      description: "The page's recent console output.",
      input: empty,
      scope: 'task',
      risk: 'execute',
      exposeToRenderer: true,
      handler: async (_a, ctx) => driverFor(ctx.taskId)?.console() ?? { lines: [] },
    },
  ]

  // ── Run targets (execute tier): only available when the task actually has run targets. The `when`
  //    predicate re-evaluates per manifest fetch, so run_* appear mid-session (tools/list_changed). ──
  const hasRunTargets = async (ctx: ToolContext): Promise<boolean> => {
    const t = await runtime.targets(ctx.taskId)
    return 'targets' in t && t.targets.length > 0
  }
  tools.push(
    {
      name: 'run_targets',
      description: "The repo's declared run targets with live status.",
      input: empty,
      scope: 'task',
      risk: 'execute',
      exposeToRenderer: true,
      when: hasRunTargets,
      whenDescription: 'Only available in tasks with run targets.',
      handler: (_a, ctx) => runtime.targets(ctx.taskId),
    },
    {
      name: 'run_start',
      description: 'Start a run target in the task worktree.',
      input: z.object({ id: z.string() }),
      scope: 'task',
      risk: 'execute',
      exposeToRenderer: true,
      when: hasRunTargets,
      whenDescription: 'Only available in tasks with run targets.',
      handler: (a, ctx) => runtime.start(ctx.taskId, (a as { id: string }).id),
    },
    {
      name: 'run_stop',
      description: "Stop a run target (runs its declared 'stop' first).",
      input: z.object({ id: z.string() }),
      scope: 'task',
      risk: 'execute',
      exposeToRenderer: true,
      when: hasRunTargets,
      whenDescription: 'Only available in tasks with run targets.',
      handler: (a, ctx) => runtime.stop(ctx.taskId, (a as { id: string }).id),
    },
    {
      name: 'run_restart',
      description: 'Restart a run target: runs its declared restart command if it has one, else stops and starts it.',
      input: z.object({ id: z.string() }),
      scope: 'task',
      risk: 'execute',
      exposeToRenderer: true,
      when: hasRunTargets,
      whenDescription: 'Only available in tasks with run targets.',
      handler: (a, ctx) => runtime.restart(ctx.taskId, (a as { id: string }).id),
    },
    {
      name: 'run_status',
      description: "A run target's status: { running, url?, exitCode? }.",
      input: z.object({ id: z.string() }),
      scope: 'task',
      risk: 'execute',
      exposeToRenderer: true,
      when: hasRunTargets,
      whenDescription: 'Only available in tasks with run targets.',
      handler: (a, ctx) => runtime.status(ctx.taskId, (a as { id: string }).id),
    },
  )

  return tools
}

export function wireAgentTools(deps: AgentToolsDeps): void {
  setAgentTools(buildAgentTools(deps))
}
