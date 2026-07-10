import { Hono } from 'hono'
import { z } from 'zod'
import type { McpServerSummary } from '../../../../core/shared/mcp'
import type { ArchiveOpts, ArchiveResult, CreateOpts, RepoPath, RepoPathResult, TaskStatus, TerminalProfile, TerminalSession } from '../../../../core/shared/terminal'
import { bridgeSlot, viaBridge } from '../../../../core/server/bridge'
import type { AppEnv } from '../../../../core/server/middleware/auth'
import { respondError } from '../../../../core/server/respond'

// Terminal control (docs/terminal-and-agents.md): the request/response half of the terminal engine —
// list/create/kill/resize sessions, repo-path mapping, task lifecycle (archive/useCheckout/onCreated),
// preview-url + the MCP config inspector. Streams use the WebSocket hub; only the native folder
// picker remains on the terminal preload bridge. Backed by the PTY engine in the main process, so
// these routes return 503 under dev:node.

export type SendSubmit = 'now' | 'after-ready' | 'draft'
export type TerminalBridge = {
  list(): Promise<TerminalSession[]>
  profiles(): Promise<TerminalProfile[]>
  create(opts: CreateOpts): Promise<TerminalSession>
  kill(id: string): Promise<boolean>
  interrupt(id: string): Promise<boolean>
  remove(id: string): Promise<boolean>
  resize(id: string, cols: number, rows: number): Promise<boolean>
  sendToAgent(sessionId: string, text: string, submit: SendSubmit): Promise<{ ok: boolean; queued?: boolean; reason?: string }>
  taskStatuses(): Promise<TaskStatus[]>
  repoPathGet(owner: string, repo: string): Promise<RepoPath | null>
  repoPathSet(owner: string, repo: string, path: string): Promise<RepoPathResult>
  repoPathRunTargets(owner: string, repo: string, runTargets: string): Promise<RepoPathResult>
  previewUrl(taskId: string, script: string): Promise<{ ok: boolean; url?: string; reason?: string }>
  onCreated(taskId: string): Promise<void>
  useCheckout(taskId: string): Promise<{ worktreePath: string; branch: string } | null>
  archive(taskId: string, opts: ArchiveOpts): Promise<ArchiveResult>
  mcpInspect(taskId: string): Promise<{ file: string; servers: McpServerSummary[] }[]>
  mcpCreateStarter(taskId: string): Promise<{ ok: boolean; reason?: string }>
}

export const terminalBridgeSlot = bridgeSlot<TerminalBridge>()
export const setTerminalBridge = terminalBridgeSlot.set

// create spawns a PTY; resize/send/repo-path/preview/archive touch processes or persisted state —
// all get validated bodies (the privileged-boundary contract). CreateOpts is passed through (the engine re-derives cwd
// from taskId); we only assert the shape the engine relies on.
const createBody = z
  .object({
    taskId: z.string().min(1),
    profileId: z.string().optional(),
    cwd: z.string().optional(),
    cols: z.number().optional(),
    rows: z.number().optional(),
    title: z.string().optional(),
    isWorktree: z.boolean().optional(),
  })
  .passthrough()
const resizeBody = z.object({ cols: z.number(), rows: z.number() })
const sendBody = z.object({ text: z.string().min(1), submit: z.enum(['now', 'after-ready', 'draft']) })
const repoPathSetBody = z.object({ owner: z.string(), repo: z.string(), path: z.string() })
const runTargetsBody = z.object({ owner: z.string(), repo: z.string(), runTargets: z.string() })
const previewBody = z.object({ script: z.string() })
const archiveBody = z.object({ deleteWorktree: z.boolean().optional(), force: z.boolean().optional(), skipTeardown: z.boolean().optional() })

const id = (c: { req: { param(k: string): string } }) => c.req.param('id')
const b = terminalBridgeSlot

// Mounted at /api to carry /terminal/*, /terminal/repo-path, and /tasks/:id/* control verbs.
export const terminal = new Hono<AppEnv>()
  // --- sessions ---
  .get('/terminal/sessions', (c) => viaBridge(c, b, (t) => t.list()))
  .get('/terminal/profiles', (c) => viaBridge(c, b, (t) => t.profiles()))
  .get('/terminal/task-statuses', (c) => viaBridge(c, b, (t) => t.taskStatuses()))
  .post('/terminal/sessions', async (c) => {
    const p = createBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, b, (t) => t.create(p.data as CreateOpts))
  })
  .post('/terminal/sessions/:sid/kill', (c) => viaBridge(c, b, (t) => t.kill(c.req.param('sid'))))
  .post('/terminal/sessions/:sid/interrupt', (c) => viaBridge(c, b, (t) => t.interrupt(c.req.param('sid'))))
  .post('/terminal/sessions/:sid/remove', (c) => viaBridge(c, b, (t) => t.remove(c.req.param('sid'))))
  .post('/terminal/sessions/:sid/resize', async (c) => {
    const p = resizeBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, b, (t) => t.resize(c.req.param('sid'), p.data.cols, p.data.rows))
  })
  .post('/terminal/sessions/:sid/send', async (c) => {
    const p = sendBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, b, (t) => t.sendToAgent(c.req.param('sid'), p.data.text, p.data.submit))
  })
  // --- repo-path mapping (owner/repo-scoped) ---
  .get('/terminal/repo-path', (c) => {
    const owner = c.req.query('owner')
    const repo = c.req.query('repo')
    if (!owner || !repo) return respondError(c, 400, 'bad_request')
    return viaBridge(c, b, (t) => t.repoPathGet(owner, repo))
  })
  .put('/terminal/repo-path', async (c) => {
    const p = repoPathSetBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, b, (t) => t.repoPathSet(p.data.owner, p.data.repo, p.data.path))
  })
  .put('/terminal/repo-path/run-targets', async (c) => {
    const p = runTargetsBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, b, (t) => t.repoPathRunTargets(p.data.owner, p.data.repo, p.data.runTargets))
  })
  // --- task lifecycle (task-scoped) ---
  .post('/tasks/:id/preview-url', async (c) => {
    const p = previewBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, b, (t) => t.previewUrl(id(c), p.data.script))
  })
  .post('/tasks/:id/on-created', (c) => viaBridge(c, b, async (t) => ((await t.onCreated(id(c))), { ok: true })))
  .post('/tasks/:id/use-checkout', (c) => viaBridge(c, b, async (t) => ({ result: await t.useCheckout(id(c)) })))
  .post('/tasks/:id/archive', async (c) => {
    const p = archiveBody.safeParse(await c.req.json().catch(() => ({})))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, b, (t) => t.archive(id(c), p.data))
  })
  .get('/tasks/:id/mcp', (c) => viaBridge(c, b, (t) => t.mcpInspect(id(c))))
  .post('/tasks/:id/mcp/starter', (c) => viaBridge(c, b, (t) => t.mcpCreateStarter(id(c))))
