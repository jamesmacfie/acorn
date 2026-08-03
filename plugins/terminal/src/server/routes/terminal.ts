import { Hono } from 'hono'
import { z } from 'zod'
import type { CreateOpts, TerminalProfile, TerminalSession } from '@acorn/protocol/terminal.ts'
import { bridgeSlot, viaBridge } from '@acorn/node-core/server/bridge.ts'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import { respondError } from '@acorn/node-core/server/respond.ts'

// Terminal control (docs/terminal-and-agents.md): the request/response half of the PTY engine —
// list/create/kill/interrupt/remove/resize sessions and the bracketed-paste send. Streams ride the
// WebSocket hub; only the native folder picker remains on the terminal preload bridge. Backed by the
// PTY engine in the service process, so these routes return 503 under dev:node.
//
// Eight routes, all of them about a pseudo-terminal. The other eleven this router used to serve —
// task statuses, repo-path mapping, repo executable config, preview-url capture, task
// on-created/use-checkout/archive, and the MCP config inspector — moved to
// @acorn/node-core/server/routes/worktree.ts under /v2/core (docs/vNext/plan.md § Phase 2, "the
// terminal scope-shed"). None of them were about a terminal; they were about where a repo lives and
// what a task is, and leaving them here meant disabling the terminal plugin would disable worktree
// management. Archive's PTY half comes back through worktree.ts's taskSessionsBridgeSlot, which this
// plugin fills.
//
// Paths are relative to /v2/p/terminal, so `/sessions` mounts at /v2/p/terminal/sessions. It used to
// state `/terminal/sessions` internally, producing the doubled /v2/p/terminal/terminal/sessions that
// app/server/routes.ts flagged for "the route-declaration phase" — this is that phase, and
// docs/vNext/protocol.md § HTTP conventions already writes the de-doubled form.

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
}

export const terminalBridgeSlot = bridgeSlot<TerminalBridge>()
export const setTerminalBridge = terminalBridgeSlot.set

// create spawns a PTY and resize/send touch a live process, so each gets a validated body (the
// privileged-boundary contract). CreateOpts is passed through — the engine re-derives cwd from
// taskId — so this asserts only the shape the engine relies on.
const createBody = z
  .object({
    taskId: z.string().min(1),
    profileId: z.string().optional(),
    cwd: z.string().optional(),
    cols: z.number().optional(),
    rows: z.number().optional(),
    title: z.string().optional(),
    isWorktree: z.boolean().optional(),
    agentSessionId: z.string().uuid().optional(),
  })
  .passthrough()
const resizeBody = z.object({ cols: z.number(), rows: z.number() })
const sendBody = z.object({ text: z.string().min(1), submit: z.enum(['now', 'after-ready', 'draft']) })

const b = terminalBridgeSlot

export const terminal = new Hono<AppEnv>()
  .get('/sessions', (c) => viaBridge(c, b, (t) => t.list()))
  .get('/profiles', (c) => viaBridge(c, b, (t) => t.profiles()))
  .post('/sessions', async (c) => {
    const p = createBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, b, (t) => t.create(p.data as CreateOpts))
  })
  .post('/sessions/:sid/kill', (c) => viaBridge(c, b, (t) => t.kill(c.req.param('sid'))))
  .post('/sessions/:sid/interrupt', (c) => viaBridge(c, b, (t) => t.interrupt(c.req.param('sid'))))
  .post('/sessions/:sid/remove', (c) => viaBridge(c, b, (t) => t.remove(c.req.param('sid'))))
  .post('/sessions/:sid/resize', async (c) => {
    const p = resizeBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, b, (t) => t.resize(c.req.param('sid'), p.data.cols, p.data.rows))
  })
  .post('/sessions/:sid/send', async (c) => {
    const p = sendBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, b, (t) => t.sendToAgent(c.req.param('sid'), p.data.text, p.data.submit))
  })
