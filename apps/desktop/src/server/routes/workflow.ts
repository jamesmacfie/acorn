import { Hono } from 'hono'
import { z } from 'zod'
import { bridgeSlot, viaBridge } from '../bridge'
import type { AppEnv } from '../middleware/auth'
import { respondError } from '../respond'

// Workflow control (docs/next 14): declared workflows for a task, start a run, list runs/steps,
// resolve a human gate. Was the `workflow:{defs,start,runs,steps,gate}` IPC channels (inventories
// §1a). The `workflow:notice` push stream stays IPC until the WebSocket lands (slice 6). Needs the
// main-process WorkflowRunner, so it 503s under dev:node (desktop-only — capability map §6).

export type WorkflowBridge = {
  defs(taskId: string): Promise<unknown> // { workflows, errors }
  start(taskId: string, def: unknown): Promise<{ runId?: string; error?: string }>
  runs(taskId: string): Promise<unknown[]>
  steps(runId: string): Promise<unknown[]>
  gate(runId: string, stepId: string, approved: boolean): Promise<{ ok: boolean }>
  cancel(runId: string): Promise<{ ok: boolean }>
  kill(runId: string, stepId: string): Promise<{ ok: boolean }>
  pollTriggers(): Promise<{ started: number; errors: string[] }>
}

export const workflowBridgeSlot = bridgeSlot<WorkflowBridge>()
export const setWorkflowBridge = workflowBridgeSlot.set

// start executes an agent CLI, gate resumes one — both get validated bodies (Phase 3 §1). The def
// shape is validated structurally (name + steps[]); the runner re-checks the rest.
const startBody = z.object({ def: z.object({ name: z.string().min(1), steps: z.array(z.unknown()) }).passthrough() })
const gateBody = z.object({ stepId: z.string().min(1), approved: z.boolean() })
const killBody = z.object({ stepId: z.string().min(1) })

// Mounted at /api so it can carry both task-scoped (/tasks/:id/...) and run-scoped
// (/workflows/runs/:runId/...) paths in one router.
export const workflow = new Hono<AppEnv>()
  .get('/tasks/:id/workflows', (c) => viaBridge(c, workflowBridgeSlot, (b) => b.defs(c.req.param('id'))))
  .post('/tasks/:id/workflows', async (c) => {
    const parsed = startBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, workflowBridgeSlot, (b) => b.start(c.req.param('id'), parsed.data.def))
  })
  .get('/tasks/:id/workflows/runs', (c) => viaBridge(c, workflowBridgeSlot, (b) => b.runs(c.req.param('id'))))
  .get('/workflows/runs/:runId/steps', (c) => viaBridge(c, workflowBridgeSlot, (b) => b.steps(c.req.param('runId'))))
  .post('/workflows/runs/:runId/gate', async (c) => {
    const parsed = gateBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, workflowBridgeSlot, (b) => b.gate(c.req.param('runId'), parsed.data.stepId, parsed.data.approved))
  })
  .post('/workflows/runs/:runId/cancel', (c) => viaBridge(c, workflowBridgeSlot, (b) => b.cancel(c.req.param('runId'))))
  .post('/workflows/runs/:runId/kill', async (c) => {
    const parsed = killBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, workflowBridgeSlot, (b) => b.kill(c.req.param('runId'), parsed.data.stepId))
  })
  .post('/workflows/triggers/poll', (c) => viaBridge(c, workflowBridgeSlot, (b) => b.pollTriggers()))
