import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'
import { type AppEnv, ownerId, ProviderOperationError, requireDevice, respondError, routeCapability, routeCapabilityFor, setRouteTestCapability } from '@acorn/plugin-api/node'
import { GENERATE_MAX_DESCRIPTION_CHARS, type WorkflowGenerateRequest, type WorkflowGenerateResult } from '../../shared/api'

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
  // A row by id, or a definition the node loads from a file, addressed `repo:<fileId>` or
  // `user:<fileId>`. `projectId` says whose checkout to read a repo file from; a file answers with
  // `revision: 0`, which is how the editor knows it has no row to save into.
  get(id: string, projectId?: string): Promise<unknown | null>
  // Neither write validates: a row is a draft, and a workflow being built is invalid most of the
  // way. `validate` reports, and `start` refuses.
  create(input: { workspaceId: string; projectId?: string; def: unknown }): Promise<{ row: unknown }>
  // `conflict` is the row that won, so the editor can show what moved underneath it.
  update(id: string, def: unknown, revision: number): Promise<{ row?: unknown; conflict?: unknown } | null>
  remove(id: string): Promise<{ ok: boolean }>
  validate(def: unknown, projectId?: string): Promise<{ problems: string[] }>
  saveToRepo(id: string, opts: { taskId?: string; keepRow: boolean }): Promise<{ path?: string; notFound?: boolean; error?: string }>
  // Writes a whole definition from a description through a connected model provider
  // (docs/workflows.md § Authoring). `error` is a reply nothing could be read out of, which is the
  // one failure with no definition to apply. A provider failure throws ProviderOperationError,
  // because its status is the one the caller has to see.
  generate(input: WorkflowGenerateRequest & { userId: string }): Promise<WorkflowGenerateResult | { error: string }>
  // Which model connections this owner could generate with, ids and labels only. The editor's
  // Generate button is drawn only when this answers something, so an owner with no provider never
  // sees a control whose only message is "connect one first".
  modelConnections(userId: string): Promise<unknown[]>
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
// The description is bounded against the same constant the modal's textarea reads, so the field a
// person types into and the field the route accepts cannot drift (../../shared/api.ts).
const generateBody = z.object({
  connectionId: z.string().min(1),
  modelId: z.string().min(1).optional(),
  description: z.string().min(1).max(GENERATE_MAX_DESCRIPTION_CHARS),
  workspaceId: z.string().min(1),
  defId: z.string().min(1).optional(),
  name: z.string().optional(),
  inputs: z.array(z.object({
    name: z.string(),
    description: z.string().optional(),
    required: z.boolean().optional(),
    default: z.string().optional(),
  })).optional(),
})

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
      return c.json(answer.row)
    })
  })
  // `/defs/validate` is declared before `/defs/:id`, or the parameter swallows the literal.
  .post('/defs/validate', async (c) => {
    const parsed = await parseBody(c, validateBody)
    if (!parsed) return respondError(c, 400, 'bad_request')
    return withBridge(c, async (bridge) => c.json(await bridge.validate(parsed.def, parsed.projectId)))
  })
  // Writes a definition from a description. Declared before `/defs/:id` for the same reason
  // `/defs/validate` is (docs/workflows.md § Authoring).
  //
  // No owner gate of its own: generation spends the owner's provider key, and the `/defs/*` mount
  // above is already device-only, which is stricter than the interactive-owner check the database
  // plugin's generate routes apply.
  .post('/defs/generate', async (c) => {
    const parsed = await parseBody(c, generateBody)
    if (!parsed) return respondError(c, 400, 'bad_request')
    return withBridge(c, async (bridge) => {
      try {
        const answer = await bridge.generate({ ...parsed, userId: ownerId(c) })
        // Nothing came back that could be read as a definition. The message says which of the four
        // ways it failed, so it rides in the body rather than leaving the reader a bare code.
        if ('error' in answer) return respondError(c, 422, 'model_answer_unusable', [answer.error])
        return c.json(answer)
      } catch (error) {
        if (error instanceof ProviderOperationError) return respondError(c, error.status, error.code)
        return respondError(c, 502, 'provider_unavailable')
      }
    })
  })
  // Also before `/defs/:id`, or the parameter eats the literal.
  .get('/defs/model-connections', (c) =>
    withBridge(c, async (bridge) => c.json(await bridge.modelConnections(ownerId(c)))))
  .get('/defs/:id', (c) =>
    withBridge(c, async (bridge) => {
      const row = await bridge.get(c.req.param('id'), c.req.query('projectId'))
      return row ? c.json(row) : respondError(c, 404, 'not_found')
    }))
  .put('/defs/:id', async (c) => {
    const parsed = await parseBody(c, updateBody)
    if (!parsed) return respondError(c, 400, 'bad_request')
    return withBridge(c, async (bridge) => {
      const answer = await bridge.update(c.req.param('id'), parsed.def, parsed.revision)
      if (!answer) return respondError(c, 404, 'not_found')
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
