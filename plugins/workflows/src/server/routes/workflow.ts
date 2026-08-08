import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import { type AppEnv, isTaskConfined, mayActOnTask, respondError, routeCapability, routeCapabilityFor, setRouteTestCapability, viaBridge } from '@acorn/plugin-api/node'

// Workflow control (docs/workflows.md): declared workflows for a task, start a run, list runs/steps,
// resolve a human gate. Commands use HTTP while notices and live events use the shared WebSocket.
// The routes need the main-process WorkflowRunner, so they return 503 under dev:node.

export type WorkflowBridge = {
  // Which task a run belongs to, for the ownership guard below. `/workflows/runs/:runId/*` names no task,
  // so the mount over /v2/p/:plugin/tasks/:id never sees it — and a workflow step executes an agent CLI in
  // a worktree, so approving another task's gate or killing its step is acting on that task.
  // `null` = no such run, which the guard treats as "not yours" so run ids cannot be enumerated.
  taskIdForRun(runId: string): Promise<string | null>
  defs(taskId: string): Promise<unknown> // { workflows, errors }
  start(taskId: string, def: unknown): Promise<{ runId?: string; error?: string }>
  runs(taskId: string): Promise<unknown[]>
  steps(runId: string): Promise<unknown[]>
  gate(runId: string, stepId: string, approved: boolean): Promise<{ ok: boolean }>
  cancel(runId: string): Promise<{ ok: boolean }>
  kill(runId: string, stepId: string): Promise<{ ok: boolean }>
  pollTriggers(): Promise<{ started: number; errors: string[] }>
}

export const WORKFLOW_ROUTE = routeCapability<WorkflowBridge>('workflows.route')
/** @internal test compatibility; production providers use CapabilityRegistry.provide. */
export const setWorkflowBridge = (bridge: WorkflowBridge | null): void => setRouteTestCapability(WORKFLOW_ROUTE, bridge)

// start executes an agent CLI, gate resumes one — both get validated bodies (the privileged-boundary contract). The def
// shape is validated structurally (name + steps[]); the runner re-checks the rest.
const startBody = z.object({ def: z.object({ name: z.string().min(1), steps: z.array(z.unknown()) }).passthrough() })
const gateBody = z.object({ stepId: z.string().min(1), approved: z.boolean() })
const killBody = z.object({ stepId: z.string().min(1) })

// The task-scoped half of this router (/tasks/:id/...) inherits core's mounted requireTaskScope; the
// run-scoped half does not, because the task is not in the path. Same shape as terminal's and agents':
// resolve the owner, deny on unknown as well as foreign, and never shadow viaBridge's 503.
const ownsRun = createMiddleware<AppEnv>(async (c, next) => {
  const runId = c.req.param('runId')
  if (!runId || !isTaskConfined(c)) return next()
  const bridge = routeCapabilityFor(c, WORKFLOW_ROUTE)
  if (!bridge) return next() // let viaBridge answer 503 — dev:node has no runner
  const taskId = await bridge.taskIdForRun(runId)
  if (!taskId || !mayActOnTask(c, taskId)) return respondError(c, 404, 'not_found')
  await next()
})

// Mounted at the plugin namespace root so it can carry both task-scoped (/tasks/:id/...) and run-scoped
// (/workflows/runs/:runId/...) paths in one router.
export const workflow = new Hono<AppEnv>()
  .use('/workflows/runs/:runId/*', ownsRun)
  .get('/tasks/:id/workflows', (c) => viaBridge(c, WORKFLOW_ROUTE, (b) => b.defs(c.req.param('id'))))
  .post('/tasks/:id/workflows', async (c) => {
    const parsed = startBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, WORKFLOW_ROUTE, (b) => b.start(c.req.param('id'), parsed.data.def))
  })
  .get('/tasks/:id/workflows/runs', (c) => viaBridge(c, WORKFLOW_ROUTE, (b) => b.runs(c.req.param('id'))))
  .get('/workflows/runs/:runId/steps', (c) => viaBridge(c, WORKFLOW_ROUTE, (b) => b.steps(c.req.param('runId'))))
  .post('/workflows/runs/:runId/gate', async (c) => {
    const parsed = gateBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, WORKFLOW_ROUTE, (b) => b.gate(c.req.param('runId'), parsed.data.stepId, parsed.data.approved))
  })
  .post('/workflows/runs/:runId/cancel', (c) => viaBridge(c, WORKFLOW_ROUTE, (b) => b.cancel(c.req.param('runId'))))
  .post('/workflows/runs/:runId/kill', async (c) => {
    const parsed = killBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, WORKFLOW_ROUTE, (b) => b.kill(c.req.param('runId'), parsed.data.stepId))
  })
  // Node-wide, not task-scoped: a poll evaluates every task's triggers and STARTS runs. There is no
  // taskId to confine it to, so a confined caller is refused outright rather than given a partial sweep —
  // an agent has no business firing other tasks' workflows. The renderer's poller is a device.
  .post('/workflows/triggers/poll', (c) =>
    isTaskConfined(c) ? respondError(c, 403, 'interactive_user_required') : viaBridge(c, WORKFLOW_ROUTE, (b) => b.pollTriggers()))
