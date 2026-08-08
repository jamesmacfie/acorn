import type { Context } from 'hono'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import { type AppEnv, isTaskConfined, mayActOnTask, respondError, routeCapability, routeCapabilityFor, setRouteTestCapability, viaBridge } from '@acorn/plugin-api/node'
import type {
  AgentEventPage,
  AgentAttachment,
  AgentArtifact,
  AgentDeleteResult,
  AgentProviderDescriptor,
  AgentRequest,
  AgentSession,
  AgentSessionList,
  AgentSessionSnapshot,
  AgentTurn,
} from '@acorn/protocol/managedAgents.ts'
import {
  agentWaitQuerySchema,
  createAgentSessionSchema,
  enqueueAgentTurnSchema,
  importAgentTranscriptSchema,
  patchAgentSessionSchema,
  patchQueuedTurnSchema,
  resolveAgentRequestSchema,
  type CreateAgentSessionInput,
  type EnqueueAgentTurnInput,
  type ImportAgentTranscriptInput,
} from '../../shared/schemas'

export type ManagedAgentsBridge = {
  // Ownership resolvers, for the task-scope guard below. Three, because this surface is addressed by
  // three different opaque ids and every one of them is a path to another task's agent: a session id
  // (turns, cancel, fork, handoff, export), an attachment id, an artifact id. `null` = no such row,
  // which the guard treats identically to "not yours" so the surface is not an id oracle.
  //
  // Narrow reads on purpose. The obvious alternative — resolve through `snapshot()` — loads every turn,
  // event and request for a session just to read one column, on every request.
  taskIdForSession(sessionId: string): Promise<string | null>
  taskIdForAttachment(attachmentId: string): Promise<string | null>
  taskIdForArtifact(artifactId: string): Promise<string | null>
  providers(force?: boolean): Promise<AgentProviderDescriptor[]>
  uploadAttachment(taskId: string, filename: string, mediaType: string, bytes: Uint8Array): Promise<AgentAttachment>
  attachment(attachmentId: string): Promise<AgentAttachment | null>
  removeAttachment(attachmentId: string): Promise<boolean>
  artifacts(sessionId: string): Promise<AgentArtifact[]>
  artifact(artifactId: string): Promise<AgentArtifact | null>
  artifactContent(artifactId: string): Promise<{ artifact: AgentArtifact; bytes: Uint8Array } | null>
  createSession(input: CreateAgentSessionInput, idempotencyKey?: string): Promise<AgentSession>
  importTranscript(input: ImportAgentTranscriptInput): Promise<AgentSession>
  verifyImportedResume(sessionId: string): Promise<AgentSession>
  listSessions(filter: {
    taskId?: string
    workspaceId?: string
    archived?: boolean
    attention?: boolean
    search?: string
    cursor?: number
    limit?: number
  }): Promise<AgentSessionList>
  snapshot(sessionId: string, afterSeq?: number, eventLimit?: number): Promise<AgentSessionSnapshot>
  events(sessionId: string, afterSeq?: number, limit?: number): Promise<AgentEventPage>
  enqueueTurn(sessionId: string, input: EnqueueAgentTurnInput): Promise<AgentTurn>
  patchQueuedTurn(sessionId: string, turnId: string, patch: { input?: AgentTurn['input']; ordinal?: number }): Promise<AgentTurn>
  cancelTurn(sessionId: string, turnId?: string): Promise<void>
  resolveRequest(sessionId: string, requestId: string, resolution: unknown, idempotencyKey: string): Promise<AgentRequest>
  patchSession(sessionId: string, patch: { title?: string; archived?: boolean; lastReadSeq?: number; config?: Record<string, unknown> }): Promise<AgentSession>
  fork(sessionId: string, title?: string): Promise<AgentSession>
  compact(sessionId: string): Promise<void>
  deleteSession(sessionId: string): Promise<AgentDeleteResult>
  handoffToTerminal(sessionId: string): Promise<AgentSession>
  resumeManaged(sessionId: string): Promise<AgentSession>
  exportSession(sessionId: string, format: 'json' | 'markdown'): Promise<string>
  wait(sessionId: string, afterSeq: number, until: 'ready' | 'attention' | 'turn_completed' | 'stopped', timeoutMs: number): Promise<AgentSessionSnapshot>
  search(
    query: string,
    filter?: { taskId?: string; workspaceId?: string; limit?: number },
  ): Promise<AgentSession[]>
}

export const MANAGED_AGENTS = routeCapability<ManagedAgentsBridge>('agents.managedRoute')
/** @internal test compatibility; production providers use CapabilityRegistry.provide. */
export const setManagedAgentsBridge = (bridge: ManagedAgentsBridge | null): void => setRouteTestCapability(MANAGED_AGENTS, bridge)

const listQuerySchema = z.object({
  taskId: z.string().uuid().optional(),
  workspaceId: z.string().uuid().optional(),
  archived: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  attention: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  search: z.string().trim().max(500).optional(),
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

const pageQuerySchema = z.object({
  afterSeq: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(2_000).default(500),
})

const exportQuerySchema = z.object({ format: z.enum(['json', 'markdown']).default('json') })
const forkBodySchema = z.object({ title: z.string().trim().min(1).max(500).optional() })
const cancelBodySchema = z.object({ turnId: z.string().uuid().optional() })
const attachmentQuerySchema = z.object({ taskId: z.string().uuid() })
const idempotencyKey = (headers: Headers): string | null => {
  const key = headers.get('idempotency-key')?.trim()
  return key && key.length >= 8 && key.length <= 200 ? key : null
}

// A managed agent session drives a provider CLI in a task's worktree, so reaching another task's
// session is the same class of hole `requireTaskScope` closes for core: read its transcript, enqueue a
// turn, fork it, hand it to a terminal. None of these paths carries a taskId, so the mount over
// /v2/p/:plugin/tasks/:id cannot see them and the router resolves the owner itself.
//
// One factory over three id kinds rather than three middlewares, because the shape is identical and only
// the resolver differs.
const owns = (param: string, resolve: (b: ManagedAgentsBridge, id: string) => Promise<string | null>) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const id = c.req.param(param)
    if (!id || !isTaskConfined(c)) return next()
    const bridge = routeCapabilityFor(c, MANAGED_AGENTS)
    if (!bridge) return next() // let viaBridge answer 503 — "no runtime" is not "not yours"
    const taskId = await resolve(bridge, id)
    if (!taskId || !mayActOnTask(c, taskId)) return respondError(c, 404, 'not_found')
    await next()
  })

const ownsSession = owns('sessionId', (b, id) => b.taskIdForSession(id))

// Pin a list/search filter to a confined caller's own task. Returns null when the caller explicitly
// asked for a DIFFERENT task, which the route turns into the same 404 every other denial uses — silently
// rewriting that request would answer a question nobody asked.
const confineFilter = <F extends { taskId?: string }>(c: Context<AppEnv>, filter: F): F | null => {
  const principal = c.get('principal')
  if (!isTaskConfined(c)) return filter
  const own = principal?.taskId
  if (!own) return null // a confined principal with no task can see nothing
  if (filter.taskId && filter.taskId !== own) return null
  return { ...filter, taskId: own }
}

export const managedAgents = new Hono<AppEnv>()
  .use('*', bodyLimit({
    maxSize: 12 * 1024 * 1024,
    onError: (c) => respondError(c, 413, 'request_too_large'),
  }))
  // ONE mount per id kind, not a bare/`/*` pair: measured, Hono's trailing `/*` matches zero segments, so
  // `/sessions/:sessionId/*` already covers `/sessions/:sessionId` itself. (Core's index.ts registers both
  // forms; that redundancy is harmless and pre-existing, and is not worth reproducing here.)
  //
  // The same zero-segment match is why `/sessions/search` needs an explicit skip: it is a STATIC sibling
  // of `/sessions/:sessionId`, Hono applies `.use()` by path regardless of registration order, and
  // without the skip the guard resolves a session literally named "search", gets null, and 404s a
  // legitimate query for every confined caller — a working feature broken by its own guard. The search
  // handler confines its own filter instead (below).
  .use('/sessions/:sessionId/*', (c, next) => (c.req.param('sessionId') === 'search' ? next() : ownsSession(c, next)))
  .use('/attachments/:attachmentId/*', owns('attachmentId', (b, id) => b.taskIdForAttachment(id)))
  .use('/artifacts/:artifactId/*', owns('artifactId', (b, id) => b.taskIdForArtifact(id)))
  .get('/providers', (c) =>
    viaBridge(c, MANAGED_AGENTS, (bridge) => bridge.providers(c.req.query('force') === 'true')))
  .post('/attachments', async (c) => {
    const parsed = attachmentQuerySchema.safeParse(c.req.query())
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    // taskId is a QUERY param here, so no mount and no resolver reaches it.
    if (!mayActOnTask(c, parsed.data.taskId)) return respondError(c, 404, 'not_found')
    const declaredSize = Number(c.req.header('content-length') ?? 0)
    if (!Number.isFinite(declaredSize) || declaredSize < 0) return respondError(c, 400, 'bad_content_length')
    if (declaredSize > 11 * 1024 * 1024) return respondError(c, 413, 'attachment_too_large')
    const form = await c.req.formData().catch(() => null)
    const file = form?.get('file')
    if (!(file instanceof File)) return respondError(c, 400, 'attachment_required')
    if (file.size > 10 * 1024 * 1024) return respondError(c, 413, 'attachment_too_large')
    const bytes = new Uint8Array(await file.arrayBuffer())
    return viaBridge(c, MANAGED_AGENTS, (bridge) =>
      bridge.uploadAttachment(parsed.data.taskId, file.name, file.type, bytes))
  })
  .get('/attachments/:attachmentId', (c) =>
    viaBridge(c, MANAGED_AGENTS, async (bridge) => {
      const attachment = await bridge.attachment(c.req.param('attachmentId'))
      if (!attachment) throw new Error('Attachment not found.')
      return attachment
    }))
  .delete('/attachments/:attachmentId', (c) =>
    viaBridge(c, MANAGED_AGENTS, async (bridge) => ({
      removed: await bridge.removeAttachment(c.req.param('attachmentId')),
    })))
  .get('/sessions/:sessionId/artifacts', (c) =>
    viaBridge(c, MANAGED_AGENTS, (bridge) => bridge.artifacts(c.req.param('sessionId'))))
  .get('/artifacts/:artifactId', (c) =>
    viaBridge(c, MANAGED_AGENTS, async (bridge) => {
      const artifact = await bridge.artifact(c.req.param('artifactId'))
      if (!artifact) throw new Error('Artifact not found.')
      return artifact
    }))
  .get('/artifacts/:artifactId/content', async (c) => {
    const bridge = routeCapabilityFor(c, MANAGED_AGENTS)
    if (!bridge) return respondError(c, 503, 'bridge-unavailable')
    const result = await bridge.artifactContent(c.req.param('artifactId'))
    if (!result) return respondError(c, 404, 'artifact_not_found')
    const filename = result.artifact.title.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 180) || 'artifact'
    return c.body(Uint8Array.from(result.bytes), 200, {
      'content-type': result.artifact.mediaType ?? 'application/octet-stream',
      'content-disposition': `attachment; filename="${filename.replaceAll('"', '')}"`,
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
    })
  })
  // Both list surfaces take an OPTIONAL taskId filter, so for a confined caller the filter is the
  // authorization: omit it (or name another task) and the answer spans the node. Overriding it is
  // narrower than 404ing the call — an agent legitimately lists and searches its own task's sessions,
  // and `workspaceId` is left alone because the taskId pin already bounds the result either way.
  .get('/sessions', (c) => {
    const parsed = listQuerySchema.safeParse(c.req.query())
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    const filter = confineFilter(c, parsed.data)
    if (!filter) return respondError(c, 404, 'not_found')
    return viaBridge(c, MANAGED_AGENTS, (bridge) => bridge.listSessions(filter))
  })
  .get('/sessions/search', (c) => {
    const parsed = z.object({
      q: z.string().trim().min(1).max(500),
      taskId: z.string().uuid().optional(),
      workspaceId: z.string().uuid().optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }).safeParse(c.req.query())
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    const { q, ...rest } = parsed.data
    const filter = confineFilter(c, rest)
    if (!filter) return respondError(c, 404, 'not_found')
    return viaBridge(c, MANAGED_AGENTS, (bridge) => bridge.search(q, filter))
  })
  .post('/sessions', async (c) => {
    const key = idempotencyKey(c.req.raw.headers)
    if (!key) return respondError(c, 400, 'idempotency_key_required')
    const parsed = createAgentSessionSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    // Spawning a provider CLI in a worktree: the taskId is in the body, so this is the check no mount
    // can make. Without it a task-scoped agent starts sessions in any task.
    if (!mayActOnTask(c, parsed.data.taskId)) return respondError(c, 404, 'not_found')
    return viaBridge(c, MANAGED_AGENTS, (bridge) => bridge.createSession(parsed.data, key))
  })
  .post('/transcript-imports', async (c) => {
    const parsed = importAgentTranscriptSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    if (!mayActOnTask(c, parsed.data.taskId)) return respondError(c, 404, 'not_found')
    return viaBridge(c, MANAGED_AGENTS, (bridge) => bridge.importTranscript(parsed.data))
  })
  .get('/sessions/:sessionId', (c) => {
    const parsed = pageQuerySchema.safeParse(c.req.query())
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, MANAGED_AGENTS, (bridge) =>
      bridge.snapshot(c.req.param('sessionId'), parsed.data.afterSeq, parsed.data.limit))
  })
  .get('/sessions/:sessionId/events', (c) => {
    const parsed = pageQuerySchema.safeParse(c.req.query())
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, MANAGED_AGENTS, (bridge) =>
      bridge.events(c.req.param('sessionId'), parsed.data.afterSeq, parsed.data.limit))
  })
  .patch('/sessions/:sessionId', async (c) => {
    const parsed = patchAgentSessionSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, MANAGED_AGENTS, (bridge) => bridge.patchSession(c.req.param('sessionId'), parsed.data))
  })
  .delete('/sessions/:sessionId', (c) =>
    viaBridge(c, MANAGED_AGENTS, (bridge) => bridge.deleteSession(c.req.param('sessionId'))))
  .post('/sessions/:sessionId/turns', async (c) => {
    const key = idempotencyKey(c.req.raw.headers)
    if (!key) return respondError(c, 400, 'idempotency_key_required')
    const body = await c.req.json().catch(() => null)
    const parsed = enqueueAgentTurnSchema.safeParse(
      typeof body === 'object' && body != null ? { ...body, idempotencyKey: key } : body,
    )
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, MANAGED_AGENTS, (bridge) => bridge.enqueueTurn(c.req.param('sessionId'), parsed.data))
  })
  .patch('/sessions/:sessionId/turns/:turnId', async (c) => {
    const parsed = patchQueuedTurnSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, MANAGED_AGENTS, (bridge) =>
      bridge.patchQueuedTurn(c.req.param('sessionId'), c.req.param('turnId'), parsed.data))
  })
  .delete('/sessions/:sessionId/turns/:turnId', (c) =>
    viaBridge(c, MANAGED_AGENTS, async (bridge) => {
      await bridge.cancelTurn(c.req.param('sessionId'), c.req.param('turnId'))
      return { ok: true }
    }))
  .post('/sessions/:sessionId/cancel', async (c) => {
    const parsed = cancelBodySchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, MANAGED_AGENTS, async (bridge) => {
      await bridge.cancelTurn(c.req.param('sessionId'), parsed.data.turnId)
      return { ok: true }
    })
  })
  .post('/sessions/:sessionId/requests/:requestId/resolve', async (c) => {
    const key = idempotencyKey(c.req.raw.headers)
    if (!key) return respondError(c, 400, 'idempotency_key_required')
    const body = await c.req.json().catch(() => null)
    const parsed = resolveAgentRequestSchema.safeParse(
      typeof body === 'object' && body != null ? { ...body, idempotencyKey: key } : body,
    )
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, MANAGED_AGENTS, (bridge) =>
      bridge.resolveRequest(c.req.param('sessionId'), c.req.param('requestId'), parsed.data.resolution, key))
  })
  .post('/sessions/:sessionId/fork', async (c) => {
    const parsed = forkBodySchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, MANAGED_AGENTS, (bridge) => bridge.fork(c.req.param('sessionId'), parsed.data.title))
  })
  .post('/sessions/:sessionId/compact', (c) =>
    viaBridge(c, MANAGED_AGENTS, async (bridge) => {
      await bridge.compact(c.req.param('sessionId'))
      return { ok: true }
    }))
  .post('/sessions/:sessionId/handoff-terminal', (c) =>
    viaBridge(c, MANAGED_AGENTS, (bridge) => bridge.handoffToTerminal(c.req.param('sessionId'))))
  .post('/sessions/:sessionId/resume-managed', (c) =>
    viaBridge(c, MANAGED_AGENTS, (bridge) => bridge.resumeManaged(c.req.param('sessionId'))))
  .post('/sessions/:sessionId/verify-imported-resume', (c) =>
    viaBridge(c, MANAGED_AGENTS, (bridge) => bridge.verifyImportedResume(c.req.param('sessionId'))))
  .get('/sessions/:sessionId/export', (c) => {
    const parsed = exportQuerySchema.safeParse(c.req.query())
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, MANAGED_AGENTS, async (bridge) => ({
      format: parsed.data.format,
      content: await bridge.exportSession(c.req.param('sessionId'), parsed.data.format),
    }))
  })
  .get('/sessions/:sessionId/wait', (c) => {
    const parsed = agentWaitQuerySchema.safeParse(c.req.query())
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, MANAGED_AGENTS, (bridge) =>
      bridge.wait(c.req.param('sessionId'), parsed.data.afterSeq, parsed.data.until, parsed.data.timeoutMs))
  })
