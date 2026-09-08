import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import { type AppEnv, isTaskConfined, mayActOnTask, respondError, routeCapability, routeCapabilityFor, setRouteTestCapability, viaBridge } from '@acorn/plugin-api/node'

// Workflow control (docs/workflows.md): declared workflows for a task, start a run, list runs/steps,
// resolve a human gate. Commands use HTTP while notices and live events use the shared WebSocket.
// The routes need the node's WorkflowRunner, so they return 503 under dev:node.

export type WorkflowBridge = {
  // Which task a run belongs to, for the ownership guard below. `/workflows/runs/:runId/*` names no
  // task, so the mount over /v2/p/:plugin/tasks/:id never sees it. A workflow step executes an agent
  // CLI in a worktree, so approving another task's gate or killing its step acts on that task.
  // `null` means no such run, and the guard treats that as "not yours" so run ids cannot be
  // enumerated.
  taskIdForRun(runId: string): Promise<string | null>
  defs(taskId: string): Promise<unknown> // { workflows, errors }
  start(taskId: string, def: unknown, inputs?: Record<string, string>): Promise<{ runId?: string; error?: string }>
  runs(taskId: string): Promise<unknown[]>
  steps(runId: string): Promise<unknown[]>
  gate(runId: string, stepId: string, approved: boolean): Promise<{ ok: boolean }>
  cancel(runId: string): Promise<{ ok: boolean }>
  kill(runId: string, stepId: string): Promise<{ ok: boolean }>
  retry(runId: string, stepId: string, prompt?: string): Promise<{ ok: boolean; error?: string }>
  // Every run on this node, for the merged run list (@acorn/protocol/runs.ts). Node-wide by
  // construction; core filters it for a confined caller, so this must not.
  allRuns(): Promise<{ runs: unknown[] }>
}

export const WORKFLOW_ROUTE = routeCapability<WorkflowBridge>('workflows.route')
/** @internal test compatibility; production providers use CapabilityRegistry.provide. */
export const setWorkflowBridge = (bridge: WorkflowBridge | null): void => setRouteTestCapability(WORKFLOW_ROUTE, bridge)

// start executes an agent CLI, gate resumes one; both get validated bodies (the privileged-boundary
// contract). The def shape is validated structurally (name + steps[]); the runner re-checks the
// rest.
const startBody = z.object({
  def: z.object({ name: z.string().min(1), steps: z.array(z.unknown()) }).passthrough(),
  // Values for the definition's declared inputs. Which names are allowed and which are required is
  // the runner's answer, because only the definition knows.
  inputs: z.record(z.string(), z.string()).optional(),
})
const gateBody = z.object({ stepId: z.string().min(1), approved: z.boolean() })
const killBody = z.object({ stepId: z.string().min(1) })
const retryBody = z.object({ stepId: z.string().min(1), prompt: z.string().optional() })

// The task-scoped half of this router (/tasks/:id/...) inherits core's mounted requireTaskScope. The
// run-scoped half does not, because the task is not in the path. Same shape as terminal's and
// agents': resolve the owner, deny on unknown as well as foreign, and never shadow viaBridge's 503.
const ownsRun = createMiddleware<AppEnv>(async (c, next) => {
  const runId = c.req.param('runId')
  if (!runId || !isTaskConfined(c)) return next()
  const bridge = routeCapabilityFor(c, WORKFLOW_ROUTE)
  if (!bridge) return next() // let viaBridge answer 503, dev:node has no runner
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
    return viaBridge(c, WORKFLOW_ROUTE, (b) => b.start(c.req.param('id'), parsed.data.def, parsed.data.inputs))
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
  // Retry is a device action. A task-confined caller — an agent inside the run — is refused, because
  // it could otherwise loop a failed step past the rail that stopped it.
  .post('/workflows/runs/:runId/retry', async (c) => {
    if (isTaskConfined(c)) return respondError(c, 403, 'forbidden')
    const parsed = retryBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, WORKFLOW_ROUTE, (b) => b.retry(c.req.param('runId'), parsed.data.stepId, parsed.data.prompt))
  })
  // The merged run list's source for this plugin (@acorn/protocol/runs.ts). Read by the node with no
  // client and no request in sight, through the plugin dispatcher, so it takes no params and answers
  // node-wide; `/v2/core/runs` applies the caller's confinement over the merged answer.
  .get('/runs', (c) => viaBridge(c, WORKFLOW_ROUTE, (b) => b.allRuns()))
// No trigger-poll route. The sweep is a node schedule now (../../node/index.ts), and "check now" is
// the scheduler's own run-now on the settings page, which every schedule already has. A second,
// workflow-only door to the same sweep would need its own confinement rule for no extra reach.
