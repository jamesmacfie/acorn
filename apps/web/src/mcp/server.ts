// The acorn MCP server (docs/next 06 B): a stdio server exposing acorn's task context as tools.
// Launched by the AGENT (registered via `claude mcp add …` with the Electron-as-node launcher), so
// it scopes itself entirely from inherited env: ACORN_TASK_ID (which task), ACORN_API_URL +
// ACORN_API_TOKEN (loopback into the running app's Hono API — tools NEVER open their own DB or
// GitHub client, so they stay in sync with the UI for free). Outside a task session or with acorn
// not running, tools return structured 'no-active-task' / 'acorn-not-running' results — never an
// error (the registration is user-wide; plain terminals load this server too).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const API_URL = process.env.ACORN_API_URL ?? 'http://127.0.0.1:4317'
const API_TOKEN = process.env.ACORN_API_TOKEN ?? ''
const TASK_ID = process.env.ACORN_TASK_ID ?? ''

type ApiResult = { ok: true; data: unknown } | { ok: false; kind: 'acorn-not-running' | 'api-error'; detail: string }

export async function apiGet(path: string): Promise<ApiResult> {
  try {
    const res = await fetch(`${API_URL}${path}`, { headers: { 'x-acorn-internal': API_TOKEN } })
    if (!res.ok) return { ok: false, kind: 'api-error', detail: `${res.status} ${await res.text().catch(() => '')}`.trim() }
    return { ok: true, data: await res.json() }
  } catch (e) {
    return { ok: false, kind: 'acorn-not-running', detail: e instanceof Error ? e.message : String(e) }
  }
}

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

export function buildServer(): McpServer {
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

  return server
}

export async function main(): Promise<void> {
  const server = buildServer()
  await server.connect(new StdioServerTransport())
}

// Entry when run directly (node/tsx/Electron-as-node); importable for tests.
const isDirect = process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js') || process.argv[1]?.endsWith('index.js')
if (isDirect) {
  void main()
}
