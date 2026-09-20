import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'
import { parseDataValue } from '@acorn/protocol/dataValues.ts'
import { parseDataSchema } from '@acorn/protocol/dataSchemas.ts'
import { type AppEnv, type Principal, ownerId, ProviderOperationError, requireDevice, respondError, routeCapability, routeCapabilityFor, setRouteTestCapability } from '@acorn/plugin-api/node'
import { GENERATE_MAX_DESCRIPTION_CHARS, type WorkflowGenerateRequest, type WorkflowGenerateResult } from '../../shared/api'
import { authoringTurnRequestSchema, type AuthoringTurnRequest, type AuthoringTurnResult } from '@acorn/protocol/authoring.ts'
import type { WorkflowPublication, WorkflowPublicationSelection } from '../../shared/workflowPublication'
import type { WorkflowFileRequest, WorkflowFileResult } from '../../shared/workflowFileAuthoring'

// Definitions stored as rows (docs/workflows.md § Database definitions). Mounted at the same
// namespace root as ./workflow.ts, which owns runs and steps.
//
// Every route here is device-only. Writing a definition is authoring executable configuration: a step
// can run a shell command, and a run started from a row skips the repo trust snapshot because there
// are no committed bytes to hash. An agent's task-scoped credential must never reach that
// (docs/security.md § Process, path, and configuration controls).

export type WorkflowDefsBridge = {
  files?(request: WorkflowFileRequest): Promise<WorkflowFileResult>
  preparePublication?(selection: WorkflowPublicationSelection): Promise<WorkflowPublication>
  publish?(id: string): Promise<WorkflowPublication>
  publications?(workspaceId: string): Promise<WorkflowPublication[]>
  discardPublication?(id: string): Promise<void>
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
  // Writes a whole definition from a description or edits the current one through the picked backend
  // (docs/workflows.md § Authoring). `error` is a reply nothing could be read out of, which is the
  // one failure with no definition to apply. A provider failure throws ProviderOperationError,
  // because its status is the one the caller has to see.
  generate(input: WorkflowGenerateRequest & { userId: string }): Promise<WorkflowGenerateResult | { error: string }>
  author?(input: AuthoringTurnRequest & { userId: string; principal: Principal; signal: AbortSignal }): Promise<AuthoringTurnResult>
  // Which backends this owner could generate with — a stored key, or an agent CLI installed on this
  // machine — ids and labels only. The editor's Generate button is drawn only when this answers
  // something, so an owner with neither never sees a control whose only message is "set one up first".
  modelBackends(userId: string): Promise<unknown[]>
}

export const WORKFLOW_DEFS_ROUTE = routeCapability<WorkflowDefsBridge>('workflows.defs')
/** @internal test compatibility; production providers use CapabilityRegistry.provide. */
export const setWorkflowDefsBridge = (bridge: WorkflowDefsBridge | null): void => setRouteTestCapability(WORKFLOW_DEFS_ROUTE, bridge)

// Structural only, as the start body is: a name and a list of steps. The rest is the catalog's
// answer, and the bridge runs the real validator before it writes.
const defSchema = z.object({ name: z.string().min(1), steps: z.array(z.unknown()) }).passthrough()
// Edit mode reads every current step before the model is called, so its input needs the same minimum
// shape the editor's JSON Apply accepts. Empty stays valid: asking AI to fill an empty saved draft is
// a useful edit.
const editableDefSchema = z.object({
  name: z.string().min(1),
  steps: z.array(z.object({ name: z.string().min(1) }).passthrough()),
}).passthrough()
const createBody = z.object({ workspaceId: z.string().min(1), projectId: z.string().min(1).optional(), def: defSchema })
const updateBody = z.object({ def: defSchema, revision: z.number().int().nonnegative() })
const validateBody = z.object({ def: defSchema, projectId: z.string().min(1).optional() })
const saveBody = z.object({ taskId: z.string().min(1).optional(), keepRow: z.boolean().optional() })
const fileTarget = z.object({ projectId: z.string().min(1), source: z.enum(['repo', 'user']), path: z.string().min(1).max(256) }).strict()
const fileBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('open'), target: fileTarget }),
  z.object({ action: z.literal('save'), target: fileTarget, revision: z.number().int().positive(), def: defSchema }),
  z.object({ action: z.literal('review'), target: fileTarget, revision: z.number().int().positive(), externalHash: z.string().optional(), choices: z.record(z.string(), z.enum(['local', 'external'])).optional() }),
  z.object({ action: z.literal('export'), projectId: z.string().min(1), id: z.string().min(1) }),
  z.object({ action: z.literal('publish'), id: z.string().min(1) }),
  z.object({ action: z.literal('discard'), id: z.string().min(1) }),
  z.object({ action: z.literal('list'), projectId: z.string().min(1) }),
])
const publicationBody = z.object({ id: z.string().min(1), revision: z.number().int().positive(),
  validation: z.record(z.string(), z.object({ inputs: z.record(z.string(), z.unknown()).transform(value => parseDataValue(value) as Record<string, import('@acorn/protocol/dataValues.ts').DataValue>).optional(), steps: z.record(z.string(), z.unknown()).transform(value => parseDataValue(value) as Record<string, import('@acorn/protocol/dataValues.ts').DataValue>).optional() })).optional(),
  workflows: z.record(z.string(), z.number().int().positive()).optional(),
  queries: z.record(z.string(), z.object({ revision: z.number().int().positive(), parameters: z.record(z.string(), z.unknown()).transform(value => parseDataValue(value) as Record<string, import('@acorn/protocol/dataValues.ts').DataValue>).optional() })).optional(),
}).strict()
// The description is bounded against the same constant the modal's textarea reads, so the field a
// person types into and the field the route accepts cannot drift (../../shared/api.ts).
const generateCommon = {
  backendId: z.string().min(1),
  modelId: z.string().min(1).optional(),
  description: z.string().min(1).max(GENERATE_MAX_DESCRIPTION_CHARS),
  workspaceId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  defId: z.string().min(1).optional(),
}
const generateBody = z.discriminatedUnion('mode', [
  z.object({
    ...generateCommon,
    mode: z.literal('overwrite'),
    name: z.string().optional(),
    inputs: z.array(z.object({
      name: z.string(),
      label: z.string().optional(),
      schema: z.unknown().transform((value, ctx) => {
        try { return parseDataSchema(value) } catch { ctx.addIssue({ code: 'custom', message: 'Invalid structural schema' }); return z.NEVER }
      }).optional(),
      description: z.string().optional(),
      required: z.boolean().optional(),
      default: z.unknown().transform((value, ctx) => {
        try { return parseDataValue(value) } catch { ctx.addIssue({ code: 'custom', message: 'Invalid typed default' }); return z.NEVER }
      }).optional(),
    })).optional(),
  }),
  z.object({ ...generateCommon, mode: z.literal('edit'), currentDef: editableDefSchema }),
])

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
  .post('/defs/files', async c => {
    const parsed = await parseBody(c, fileBody)
    if (!parsed) return respondError(c, 400, 'bad_request')
    return withBridge(c, async bridge => {
      if (!bridge.files) return respondError(c, 503, 'bridge-unavailable')
      try { return c.json(await bridge.files(parsed as WorkflowFileRequest)) }
      catch (error) { return respondError(c, 409, 'file_conflict', [error instanceof Error ? error.message : 'File operation failed']) }
    })
  })
  .post('/defs/publications/prepare', async c => {
    const parsed = await parseBody(c, publicationBody)
    if (!parsed) return respondError(c, 400, 'bad_request')
    return withBridge(c, async bridge => {
      if (!bridge.preparePublication) return respondError(c, 503, 'bridge-unavailable')
      try { return c.json(await bridge.preparePublication(parsed)) }
      catch (error) { return respondError(c, 409, 'publication_conflict', [error instanceof Error ? error.message : 'Publication could not be prepared']) }
    })
  })
  .get('/defs/publications', c => withBridge(c, async bridge => {
    const workspaceId = c.req.query('workspaceId')
    if (!workspaceId) return respondError(c, 400, 'bad_request')
    return c.json(await bridge.publications?.(workspaceId) ?? [])
  }))
  .post('/defs/publications/:operationId/publish', async c => {
    const parsed = await parseBody(c, z.object({}).strict())
    if (!parsed) return respondError(c, 400, 'bad_request')
    return withBridge(c, async bridge => {
      if (!bridge.publish) return respondError(c, 503, 'bridge-unavailable')
      try { return c.json(await bridge.publish(c.req.param('operationId'))) }
      catch (error) { return respondError(c, 409, 'publication_conflict', [error instanceof Error ? error.message : 'Publication not found']) }
    })
  })
  .post('/defs/publications/:operationId/discard', async c => {
    const parsed = await parseBody(c, z.object({}).strict())
    if (!parsed) return respondError(c, 400, 'bad_request')
    return withBridge(c, async bridge => {
      if (!bridge.discardPublication) return respondError(c, 503, 'bridge-unavailable')
      try { await bridge.discardPublication(c.req.param('operationId')); return c.json({ ok: true }) }
      catch (error) { return respondError(c, 409, 'publication_conflict', [error instanceof Error ? error.message : 'Cannot discard publication']) }
    })
  })
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
        // The route validates the definition's outer shape. Its steps remain `unknown` to Zod
        // because the catalog, not a closed schema, owns contributed step fields; the bridge runs
        // the real workflow parser and validator after generation.
        const answer = await bridge.generate({ ...(parsed as WorkflowGenerateRequest), userId: ownerId(c) })
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
  .post('/defs/authoring/turn', async (c) => {
    const parsed = await parseBody(c, authoringTurnRequestSchema)
    if (!parsed || parsed.target !== 'workflow') return respondError(c, 400, 'bad_request')
    return withBridge(c, async bridge => {
      if (!bridge.author) return respondError(c, 503, 'bridge-unavailable')
      try {
        return c.json(await bridge.author({ ...parsed, userId: ownerId(c), principal: c.get('principal')!, signal: c.req.raw.signal }))
      } catch (error) {
        if (error instanceof ProviderOperationError) return respondError(c, error.status, error.code)
        if (c.req.raw.signal.aborted) return respondError(c, 408, 'cancelled')
        return respondError(c, 400, 'authoring_failed', [error instanceof Error ? error.message : 'Authoring failed'])
      }
    })
  })
  // Also before `/defs/:id`, or the parameter eats the literal.
  .get('/defs/model-connections', (c) =>
    withBridge(c, async (bridge) => c.json(await bridge.modelBackends(ownerId(c)))))
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
