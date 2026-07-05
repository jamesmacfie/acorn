// The acorn MCP server (docs/next 06 B): a stdio server exposing acorn's task context as tools.
// Launched by the AGENT (registered via `claude mcp add …` with the Electron-as-node launcher over
// the `main.ts` entry module), so it scopes itself entirely from inherited env: ACORN_TASK_ID
// (which task) plus the loopback client's ACORN_API_URL/ACORN_API_TOKEN (see ./api.ts). Outside a
// task session or with acorn not running, tools return structured 'no-active-task' /
// 'acorn-not-running' results — never an error (the registration is user-wide; plain terminals
// load this server too). This module exports only buildServer/main — the entry is ./main.ts.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { gitLog, localChanges, localDiff } from '../main/localDiff'
import { apiGet, apiSend, type ApiResult } from './api'

const TASK_ID = process.env.ACORN_TASK_ID ?? ''
const WORKTREE = process.env.ACORN_WORKTREE_PATH ?? ''
const SESSION_ID = process.env.ACORN_SESSION_ID ?? ''

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] })

const NO_TASK = text({ status: 'no-active-task', hint: 'This session was not launched from an acorn task — task-scoped tools need ACORN_TASK_ID.' })

// Wrap a task-scoped tool body: no ACORN_TASK_ID → structured no-active-task; API unreachable →
// structured acorn-not-running. Never a protocol error.
async function taskTool(fn: (taskId: string) => Promise<ApiResult>) {
  if (!TASK_ID) return NO_TASK
  const res = await fn(TASK_ID)
  if (!res.ok) return text({ status: res.kind, detail: res.detail })
  return text(res.data)
}

export function buildServer(opts: { hasRunTargets?: boolean } = {}): McpServer {
  const server = new McpServer({ name: process.env.ACORN_MCP_NAME ?? 'acorn', version: '0.1.0' })

  server.registerTool(
    'task_current',
    { description: "The current acorn task: repo, branch, worktree path, PR number and linked issues. Returns no-active-task when this session wasn't launched from an acorn task." },
    () =>
      taskTool(async (id) => {
        const res = await apiGet(`/api/tasks/${id}/context?include=issues`)
        if (!res.ok) return res
        const ctx = res.data as { task: unknown; issues: unknown }
        return { ok: true, data: { ...(ctx.task as Record<string, unknown>), links: ctx.issues } }
      }),
  )

  server.registerTool(
    'task_context',
    {
      description: 'The assembled context for the current task: PR detail, linked issues, notes and the repo memory index. Compact by design.',
      inputSchema: { include: z.string().optional().describe("comma list of pr,issues,notes,memory (default: all)") },
    },
    ({ include }) => taskTool((id) => apiGet(`/api/tasks/${id}/context${include ? `?include=${encodeURIComponent(include)}` : ''}`)),
  )

  server.registerTool(
    'pr_current',
    { description: "The current task's pull request (title, body, changed-file count) from acorn's local mirror." },
    () =>
      taskTool(async (id) => {
        const res = await apiGet(`/api/tasks/${id}/context?include=pr`)
        if (!res.ok) return res
        const ctx = res.data as { pr?: unknown }
        return { ok: true, data: ctx.pr ?? { status: 'no-pr', hint: 'This task has no linked pull request yet.' } }
      }),
  )

  server.registerTool(
    'pr_changed_files',
    { description: "The changed file paths of the current task's pull request." },
    () =>
      taskTool(async (id) => {
        const res = await apiGet(`/api/tasks/${id}/context?include=pr`)
        if (!res.ok) return res
        const ctx = res.data as { pr?: { changedFiles?: string[] } }
        return { ok: true, data: ctx.pr?.changedFiles ?? [] }
      }),
  )

  server.registerTool(
    'linked_issues',
    {
      description: 'Issues/errors linked to the current task (Linear tickets, Rollbar items), resolved from the local cache.',
      inputSchema: { provider: z.string().optional().describe("filter by provider, e.g. 'linear' or 'rollbar'") },
    },
    ({ provider }) =>
      taskTool(async (id) => {
        const res = await apiGet(`/api/tasks/${id}/context?include=issues`)
        if (!res.ok) return res
        const ctx = res.data as { issues: { provider: string }[] }
        return { ok: true, data: provider ? ctx.issues.filter((i) => i.provider === provider) : ctx.issues }
      }),
  )

  server.registerTool(
    'repo_info',
    { description: "The current task's repo: owner, name, default branch, task branch and worktree path." },
    () => taskTool((id) => apiGet(`/api/tasks/${id}/repo-info`)),
  )

  // --- Changes (docs/next 04): straight git over the inherited worktree — the same module the
  // app's ChangesPane uses, so there is exactly one implementation.
  const NO_WORKTREE = text({ status: 'no-active-task', hint: 'No ACORN_WORKTREE_PATH in this session.' })

  server.registerTool(
    'local_changes',
    { description: "Uncommitted changes in the task worktree (git status): staged/unstaged/untracked file list." },
    async () => (WORKTREE ? text(await localChanges(WORKTREE)) : NO_WORKTREE),
  )

  server.registerTool(
    'local_diff',
    {
      description: 'The unified diff of one uncommitted file in the task worktree.',
      inputSchema: { path: z.string().describe('repo-relative file path'), scope: z.enum(['unstaged', 'staged']).optional() },
    },
    async ({ path, scope }) => {
      if (!WORKTREE) return NO_WORKTREE
      try {
        return text((await localDiff(WORKTREE, path, scope ?? 'unstaged')).patch || '(no diff)')
      } catch (e) {
        return text({ status: 'error', detail: e instanceof Error ? e.message : String(e) })
      }
    },
  )

  server.registerTool(
    'git_log',
    { description: "Recent commits on the task's branch.", inputSchema: { n: z.number().int().min(1).max(100).optional() } },
    async ({ n }) => (WORKTREE ? text(await gitLog(WORKTREE, n ?? 10)) : NO_WORKTREE),
  )

  // --- Notes (docs/next 09): the workspace note files, over loopback. Writes stamp
  // author: agent + this session's id (provenance) server-side.
  server.registerTool('notes_list', { description: 'Workspace notes for the current task (slug, title, kind, author).' }, () =>
    taskTool((id) => apiGet(`/api/tasks/${id}/notes`)),
  )
  server.registerTool(
    'notes_read',
    { description: 'Read one workspace note.', inputSchema: { slug: z.string() } },
    ({ slug }) => taskTool((id) => apiGet(`/api/tasks/${id}/notes/${encodeURIComponent(slug)}`)),
  )
  server.registerTool(
    'notes_write',
    { description: 'Replace a note body (creates the note if missing, attributed to this agent).', inputSchema: { slug: z.string(), body: z.string() } },
    ({ slug, body }) => taskTool((id) => apiSend('PUT', `/api/tasks/${id}/notes/${encodeURIComponent(slug)}`, { body, sessionId: SESSION_ID })),
  )
  server.registerTool(
    'notes_append',
    { description: 'Append to a note (findings, plans, handoffs) — creates it if missing, attributed to this agent.', inputSchema: { slug: z.string(), text: z.string() } },
    ({ slug, text: t }) => taskTool((id) => apiSend('POST', `/api/tasks/${id}/notes/${encodeURIComponent(slug)}/append`, { text: t, sessionId: SESSION_ID })),
  )

  // --- Memory (docs/next 12): ranked search / read over the committed repo memory; writes only
  // PROPOSE — a human accepts before anything lands.
  server.registerTool(
    'memory_search',
    { description: 'Search repo memory (conventions, architecture, past fixes) — ranked, repo-scoped.', inputSchema: { query: z.string(), type: z.string().optional() } },
    ({ query, type }) => taskTool((id) => apiGet(`/api/tasks/${id}/memory?q=${encodeURIComponent(query)}${type ? `&type=${encodeURIComponent(type)}` : ''}`)),
  )
  server.registerTool(
    'memory_list',
    { description: 'The repo memory index (name + description per memory).', inputSchema: { type: z.string().optional() } },
    ({ type }) => taskTool((id) => apiGet(`/api/tasks/${id}/memory${type ? `?type=${encodeURIComponent(type)}` : ''}`)),
  )
  server.registerTool(
    'memory_get',
    { description: 'Read one memory in full (body + file path).', inputSchema: { name: z.string() } },
    ({ name }) => taskTool((id) => apiGet(`/api/tasks/${id}/memory/${encodeURIComponent(name)}`)),
  )
  server.registerTool(
    'memory_write',
    {
      description: 'PROPOSE a new memory (convention/architecture/decision/fix/reference/feedback). A human reviews before it lands — nothing is written directly.',
      inputSchema: { name: z.string(), type: z.string(), description: z.string(), body: z.string() },
    },
    ({ name, type, description, body }) =>
      taskTool((id) => apiSend('POST', `/api/tasks/${id}/memory/propose`, { name, type, description, body, sessionId: SESSION_ID })),
  )

  // --- Browser (docs/next 08 P2): drive the task's preview webview — navigate (URL from
  // run_status, never a guessed port), snapshot (accessibility tree with refs), click/fill by ref,
  // read the console. The 08 §example loop.
  server.registerTool(
    'browser_navigate',
    { description: "Navigate the task's preview browser to a URL (get it from run_status; http(s) only).", inputSchema: { url: z.string() } },
    ({ url }) => taskTool((id) => apiSend('POST', `/api/tasks/${id}/browser/navigate`, { url })),
  )
  server.registerTool(
    'browser_snapshot',
    { description: 'Accessibility snapshot of the current page: a compact tree with element refs (e1, e2, …) for browser_click/browser_fill.' },
    () => taskTool((id) => apiGet(`/api/tasks/${id}/browser/snapshot`)),
  )
  server.registerTool(
    'browser_click',
    { description: 'Click an element by its snapshot ref.', inputSchema: { ref: z.string() } },
    ({ ref }) => taskTool((id) => apiSend('POST', `/api/tasks/${id}/browser/click`, { ref })),
  )
  server.registerTool(
    'browser_fill',
    { description: 'Fill a textbox by its snapshot ref (replaces the current value).', inputSchema: { ref: z.string(), text: z.string() } },
    ({ ref, text: t }) => taskTool((id) => apiSend('POST', `/api/tasks/${id}/browser/fill`, { ref, text: t })),
  )
  server.registerTool('browser_screenshot', { description: 'Screenshot the current page (png data URI).' }, () =>
    taskTool((id) => apiGet(`/api/tasks/${id}/browser/screenshot`)),
  )
  server.registerTool('browser_console', { description: "The page's recent console output." }, () =>
    taskTool((id) => apiGet(`/api/tasks/${id}/browser/console`)),
  )

  // --- Run targets (docs/next 13 §A): bring the stack up, learn where it listens, tear it down —
  // without knowing whether it's compose or pnpm. These tools only exist when the task actually has
  // run targets (a workspace dev script or repo/.acorn config) — an agent in a repo with nothing to
  // run never sees them (opts.hasRunTargets, resolved once at connect in main()).
  if (opts.hasRunTargets) {
    server.registerTool('run_targets', { description: "The repo's declared run targets with live status." }, () =>
      taskTool((id) => apiGet(`/api/tasks/${id}/run`)),
    )
    server.registerTool('run_start', { description: 'Start a run target in the task worktree.', inputSchema: { id: z.string() } }, ({ id: target }) =>
      taskTool((id) => apiSend('POST', `/api/tasks/${id}/run/${encodeURIComponent(target)}/start`, {})),
    )
    server.registerTool('run_stop', { description: "Stop a run target (runs its declared 'stop' first).", inputSchema: { id: z.string() } }, ({ id: target }) =>
      taskTool((id) => apiSend('POST', `/api/tasks/${id}/run/${encodeURIComponent(target)}/stop`, {})),
    )
    server.registerTool(
      'run_restart',
      { description: "Restart a run target: runs its declared restart command if it has one, else stops and starts it.", inputSchema: { id: z.string() } },
      ({ id: target }) => taskTool((id) => apiSend('POST', `/api/tasks/${id}/run/${encodeURIComponent(target)}/restart`, {})),
    )
    server.registerTool('run_status', { description: 'A run target\'s status: { running, url?, exitCode? }.', inputSchema: { id: z.string() } }, ({ id: target }) =>
      taskTool((id) => apiGet(`/api/tasks/${id}/run/${encodeURIComponent(target)}/status`)),
    )
  }

  return server
}

// Does this session's task have any run targets? Resolved once, at connect — the run_* tools are
// gated on it. No task / acorn not running / API error → false (no run tools, which is correct: no
// task context means nothing to run).
async function hasRunTargets(): Promise<boolean> {
  if (!TASK_ID) return false
  const res = await apiGet(`/api/tasks/${TASK_ID}/run`)
  if (!res.ok) return false
  const data = res.data as { targets?: unknown[] }
  return Array.isArray(data.targets) && data.targets.length > 0
}

export async function main(): Promise<void> {
  const server = buildServer({ hasRunTargets: await hasRunTargets() })
  await server.connect(new StdioServerTransport())
}
