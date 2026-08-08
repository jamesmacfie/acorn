import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import type { CreateOpts, TerminalProfile, TerminalSession } from '@acorn/protocol/terminal.ts'
import { type AppEnv, isTaskConfined, mayActOnTask, respondError, routeCapability, routeCapabilityFor, setRouteTestCapability, viaBridge } from '@acorn/plugin-api/node'
import type { SendSubmit } from '../../shared/send'

export type { SendSubmit }
export type TerminalBridge = {
  // Which task owns a session, for the ownership check every /sessions/:sid route below runs. The SAME
  // question main/wsHub.ts asks through `StreamHandlers.streamTaskId`, and deliberately answered from the
  // same session map rather than re-derived from `list()`: two lookups that can disagree is how the WS
  // half ended up guarded while the HTTP half was not. `null` = no such session.
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

// A PTY is arbitrary command execution as the owner, so every route below that names a session has to
// answer "does this caller own that session's task?" — the question main/wsHub.ts § mayDriveStream
// already asks of the WebSocket half. It did not ask it here, and the gap was the whole hole: a
// task-scoped credential could POST /sessions/<any sid>/send and type a shell command into another
// task's terminal. `requireTaskScope` cannot be mounted over these paths because the task is not in
// them — the session id is opaque — so the resolve happens here.
//
// Ordering matters: a MISSING bridge must still produce viaBridge's 503 rather than this guard's 404,
// because "the PTY engine is not wired" (dev:node) and "that is not your session" are different
// answers and the client's degraded-mode handling keys on the former.
const ownsSession = createMiddleware<AppEnv>(async (c, next) => {
  const sid = c.req.param('sid')
  if (!sid || !isTaskConfined(c)) return next()
  const impl = routeCapabilityFor(c, TERMINAL_ROUTE)
  if (!impl) return next() // let viaBridge answer 503
  const taskId = impl.taskIdFor(sid)
  // 404 on an unknown session too, not just a foreign one: a task-scoped caller must not be able to
  // probe which session ids exist. Fails closed, matching wsHub's unknown-stream behaviour.
  if (!taskId || !mayActOnTask(c, taskId)) return respondError(c, 404, 'not_found')
  await next()
})

export const terminal = new Hono<AppEnv>()
  // The roster is filtered, not gated: a task-scoped caller sees its own task's sessions and nothing
  // else. Unfiltered, `list()` handed every agent the titles and task ids of every other task's
  // terminals — the same shape of leak as an unguarded /devices.
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
    // Spawning: the taskId is in the BODY, so the gate is a body read rather than a path param. Without
    // it a task-scoped agent could spawn a PTY in any task's worktree.
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
