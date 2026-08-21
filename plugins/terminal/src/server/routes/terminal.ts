import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import type { CreateOpts, TerminalProfile, TerminalSession } from '@acorn/protocol/terminal.ts'
import { type AppEnv, isTaskConfined, mayActOnTask, respondError, routeCapability, routeCapabilityFor, setRouteTestCapability, viaBridge } from '@acorn/plugin-api/node'
import type { SendSubmit } from '../../shared/send'

export type { SendSubmit }
export type TerminalBridge = {
  // Which task owns a session, for the ownership check every /sessions/:sid route below runs.
  // Answers from the same session map that main/wsHub.ts reads through StreamHandlers.streamTaskId,
  // not re-derived from list(), so the HTTP and WS halves cannot disagree about who owns a session
  // (docs/security.md § Transport and auth). Null means no such session.
  taskIdFor(sessionId: string): string | null
  list(): Promise<TerminalSession[]>
  profiles(): Promise<TerminalProfile[]>
  create(opts: CreateOpts): Promise<TerminalSession>
  kill(id: string): Promise<boolean>
  interrupt(id: string): Promise<boolean>
  remove(id: string): Promise<boolean>
  resize(id: string, cols: number, rows: number): Promise<boolean>
  sendToAgent(sessionId: string, text: string, submit: SendSubmit): Promise<{ ok: boolean; queued?: boolean; reason?: string }>
}

export const TERMINAL_ROUTE = routeCapability<TerminalBridge>('terminal.route')
/** @internal test compatibility; production providers use CapabilityRegistry.provide. */
export const setTerminalBridge = (bridge: TerminalBridge | null): void => setRouteTestCapability(TERMINAL_ROUTE, bridge)

// create spawns a PTY and resize/send touch a live process, so each gets a validated body (the
// privileged-boundary contract). CreateOpts is passed through: the engine re-derives cwd from
// taskId, so this asserts only the shape the engine relies on.
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

// A PTY is arbitrary command execution as the owner, so every route below that names a session must
// answer "does this caller own that session's task?" (docs/security.md § Transport and auth).
// requireTaskScope cannot be mounted over these paths because the task is not in them and the
// session id is opaque, so the resolution happens here instead.
const ownsSession = createMiddleware<AppEnv>(async (c, next) => {
  const sid = c.req.param('sid')
  if (!sid || !isTaskConfined(c)) return next()
  const impl = routeCapabilityFor(c, TERMINAL_ROUTE)
  if (!impl) return next() // let viaBridge answer 503
  const taskId = impl.taskIdFor(sid)
  // Same 404 for unknown and foreign sessions, so a task-scoped caller cannot probe which ids exist
  // (docs/security.md § Transport and auth).
  if (!taskId || !mayActOnTask(c, taskId)) return respondError(c, 404, 'not_found')
  await next()
})

export const terminal = new Hono<AppEnv>()
  // Filtered, not gated: a task-scoped caller sees only its own task's sessions
  // (docs/security.md § Transport and auth).
  .get('/sessions', (c) =>
    viaBridge(c, TERMINAL_ROUTE, async (t) => {
      const all = await t.list()
      return isTaskConfined(c) ? all.filter((s) => mayActOnTask(c, s.taskId)) : all
    }),
  )
  .get('/profiles', (c) => viaBridge(c, TERMINAL_ROUTE, (t) => t.profiles()))
  .post('/sessions', async (c) => {
    const p = createBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    // taskId lives in the body here, not a path param, so the scope gate cannot mount over this
    // route; the check happens by hand instead (docs/security.md § Transport and auth).
    if (!mayActOnTask(c, p.data.taskId)) return respondError(c, 404, 'not_found')
    return viaBridge(c, TERMINAL_ROUTE, (t) => t.create(p.data as CreateOpts))
  })
  .use('/sessions/:sid/*', ownsSession)
  .post('/sessions/:sid/kill', (c) => viaBridge(c, TERMINAL_ROUTE, (t) => t.kill(c.req.param('sid'))))
  .post('/sessions/:sid/interrupt', (c) => viaBridge(c, TERMINAL_ROUTE, (t) => t.interrupt(c.req.param('sid'))))
  .post('/sessions/:sid/remove', (c) => viaBridge(c, TERMINAL_ROUTE, (t) => t.remove(c.req.param('sid'))))
  .post('/sessions/:sid/resize', async (c) => {
    const p = resizeBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, TERMINAL_ROUTE, (t) => t.resize(c.req.param('sid'), p.data.cols, p.data.rows))
  })
  .post('/sessions/:sid/send', async (c) => {
    const p = sendBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, TERMINAL_ROUTE, (t) => t.sendToAgent(c.req.param('sid'), p.data.text, p.data.submit))
  })
