import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'
import { type AppEnv, requireDevice, respondError, routeCapability, routeCapabilityFor, setRouteTestCapability } from '@acorn/plugin-api/node'

// Definitions stored as rows (docs/workflows.md § Database definitions). Mounted at the same
// namespace root as ./workflow.ts, which owns runs and steps.
//
// Every route here is device-only. Writing a definition is authoring executable configuration: a step
// can run a shell command, and a run started from a row skips the repo trust snapshot because there
// are no committed bytes to hash. An agent's task-scoped credential must never reach that
// (docs/security.md § Process, path, and configuration controls).

export type WorkflowDefsBridge = {
  // The merged read: this workspace's rows, every project's `.acorn/workflows/*.toml`, and the user
  // layer, with a repo id winning a collision.
  list(workspaceId: string): Promise<unknown>
  get(id: string): Promise<unknown | null>
  create(input: { workspaceId: string; projectId?: string; def: unknown }): Promise<{ row?: unknown; problems?: string[] }>
  // `conflict` is the row that won, so the editor can show what moved underneath it.
  update(id: string, def: unknown, revision: number): Promise<{ row?: unknown; conflict?: unknown; problems?: string[] } | null>
  remove(id: string): Promise<{ ok: boolean }>
  validate(def: unknown, projectId?: string): Promise<{ problems: string[] }>
  saveToRepo(id: string, opts: { taskId?: string; keepRow: boolean }): Promise<{ path?: string; notFound?: boolean; error?: string }>
}

export const WORKFLOW_DEFS_ROUTE = routeCapability<WorkflowDefsBridge>('workflows.defs')
/** @internal test compatibility; production providers use CapabilityRegistry.provide. */
export const setWorkflowDefsBridge = (bridge: WorkflowDefsBridge | null): void => setRouteTestCapability(WORKFLOW_DEFS_ROUTE, bridge)

// Structural only, as the start body is: a name and a list of steps. The rest is the catalog's
// answer, and the bridge runs the real validator before it writes.
const defSchema = z.object({ name: z.string().min(1), steps: z.array(z.unknown()) }).passthrough()
const createBody = z.object({ workspaceId: z.string().min(1), projectId: z.string().min(1).optional(), def: defSchema })
const updateBody = z.object({ def: defSchema, revision: z.number().int().nonnegative() })
const validateBody = z.object({ def: defSchema, projectId: z.string().min(1).optional() })
const saveBody = z.object({ taskId: z.string().min(1).optional(), keepRow: z.boolean().optional() })

// These handlers answer 400, 404 and 409 off the bridge's own result, so they resolve the capability
// themselves rather than going through viaBridge. The 503 promise it makes is kept here.
const withBridge = async (c: Context<AppEnv>, fn: (bridge: WorkflowDefsBridge) => Promise<Response>): Promise<Response> => {
  const bridge = routeCapabilityFor(c, WORKFLOW_DEFS_ROUTE)
  if (!bridge) return respondError(c, 503, 'bridge-unavailable')
  return fn(bridge)
}

const parseBody = async <T>(c: Context<AppEnv>, schema: z.ZodType<T>): Promise<T | null> => {
  const parsed = schema.safeParse(await c.req.json().catch(() => null))
  return parsed.success ? parsed.data : null
}

export const workflowDefsRoutes = new Hono<AppEnv>()
  // One gate for the family: in Hono a `/defs/*` mount matches the bare `/defs` as well.
  .use('/defs/*', requireDevice)
  .get('/defs', (c) => {
    const workspaceId = c.req.query('workspaceId')
    if (!workspaceId) return respondError(c, 400, 'bad_request')
    return withBridge(c, async (bridge) => c.json(await bridge.list(workspaceId)))
  })
  .post('/defs', async (c) => {
    const parsed = await parseBody(c, createBody)
    if (!parsed) return respondError(c, 400, 'bad_request')
    return withBridge(c, async (bridge) => {
      const answer = await bridge.create(parsed)
      if (answer.problems?.length) return respondError(c, 400, 'bad_request', answer.problems)
      return c.json(answer.row)
    })
  })
  // `/defs/validate` is declared before `/defs/:id`, or the parameter swallows the literal.
  .post('/defs/validate', async (c) => {
    const parsed = await parseBody(c, validateBody)
    if (!parsed) return respondError(c, 400, 'bad_request')
    return withBridge(c, async (bridge) => c.json(await bridge.validate(parsed.def, parsed.projectId)))
  })
  .get('/defs/:id', (c) =>
    withBridge(c, async (bridge) => {
      const row = await bridge.get(c.req.param('id'))
      return row ? c.json(row) : respondError(c, 404, 'not_found')
    }))
  .put('/defs/:id', async (c) => {
    const parsed = await parseBody(c, updateBody)
    if (!parsed) return respondError(c, 400, 'bad_request')
    return withBridge(c, async (bridge) => {
      const answer = await bridge.update(c.req.param('id'), parsed.def, parsed.revision)
      if (!answer) return respondError(c, 404, 'not_found')
      if (answer.problems?.length) return respondError(c, 400, 'bad_request', answer.problems)
      if (answer.conflict) {
        return respondError(c, 409, 'revision_conflict', ['This workflow changed since you opened it.'], answer.conflict)
      }
      return c.json(answer.row)
    })
  })
  .delete('/defs/:id', (c) => withBridge(c, async (bridge) => c.json(await bridge.remove(c.req.param('id')))))
  // Turns a row into a committed file. From then on the trust snapshot covers it, so the next start
  // from that file asks for the acknowledgement any repo-authored configuration asks for.
  .post('/defs/:id/save-to-repo', async (c) => {
    const parsed = await parseBody(c, saveBody)
    if (!parsed) return respondError(c, 400, 'bad_request')
    return withBridge(c, async (bridge) => {
      const answer = await bridge.saveToRepo(c.req.param('id'), { taskId: parsed.taskId, keepRow: parsed.keepRow === true })
      if (answer.notFound) return respondError(c, 404, 'not_found')
      if (answer.error) return respondError(c, 400, 'bad_request', [answer.error])
      return c.json({ path: answer.path })
    })
  })
