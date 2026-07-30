import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { bridgeSlot, viaBridge } from '../../../../core/server/bridge'
import type { AppEnv } from '../../../../core/server/middleware/auth'
import { respondError } from '../../../../core/server/respond'
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
} from '../../../../core/shared/managedAgents'
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

export const managedAgentsBridgeSlot = bridgeSlot<ManagedAgentsBridge>()
export const setManagedAgentsBridge = managedAgentsBridgeSlot.set

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

export const managedAgents = new Hono<AppEnv>()
  .use('*', bodyLimit({
    maxSize: 12 * 1024 * 1024,
    onError: (c) => respondError(c, 413, 'request_too_large'),
  }))
  .get('/providers', (c) =>
    viaBridge(c, managedAgentsBridgeSlot, (bridge) => bridge.providers(c.req.query('force') === 'true')))
  .post('/attachments', async (c) => {
    const parsed = attachmentQuerySchema.safeParse(c.req.query())
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    const declaredSize = Number(c.req.header('content-length') ?? 0)
    if (!Number.isFinite(declaredSize) || declaredSize < 0) return respondError(c, 400, 'bad_content_length')
    if (declaredSize > 11 * 1024 * 1024) return respondError(c, 413, 'attachment_too_large')
    const form = await c.req.formData().catch(() => null)
    const file = form?.get('file')
    if (!(file instanceof File)) return respondError(c, 400, 'attachment_required')
    if (file.size > 10 * 1024 * 1024) return respondError(c, 413, 'attachment_too_large')
    const bytes = new Uint8Array(await file.arrayBuffer())
    return viaBridge(c, managedAgentsBridgeSlot, (bridge) =>
      bridge.uploadAttachment(parsed.data.taskId, file.name, file.type, bytes))
  })
  .get('/attachments/:attachmentId', (c) =>
    viaBridge(c, managedAgentsBridgeSlot, async (bridge) => {
      const attachment = await bridge.attachment(c.req.param('attachmentId'))
      if (!attachment) throw new Error('Attachment not found.')
      return attachment
    }))
  .delete('/attachments/:attachmentId', (c) =>
    viaBridge(c, managedAgentsBridgeSlot, async (bridge) => ({
      removed: await bridge.removeAttachment(c.req.param('attachmentId')),
    })))
  .get('/sessions/:sessionId/artifacts', (c) =>
    viaBridge(c, managedAgentsBridgeSlot, (bridge) => bridge.artifacts(c.req.param('sessionId'))))
  .get('/artifacts/:artifactId', (c) =>
    viaBridge(c, managedAgentsBridgeSlot, async (bridge) => {
      const artifact = await bridge.artifact(c.req.param('artifactId'))
      if (!artifact) throw new Error('Artifact not found.')
      return artifact
    }))
  .get('/artifacts/:artifactId/content', async (c) => {
    const bridge = managedAgentsBridgeSlot.get()
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
  .get('/sessions', (c) => {
    const parsed = listQuerySchema.safeParse(c.req.query())
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, managedAgentsBridgeSlot, (bridge) => bridge.listSessions(parsed.data))
  })
  .get('/sessions/search', (c) => {
    const parsed = z.object({
      q: z.string().trim().min(1).max(500),
      taskId: z.string().uuid().optional(),
      workspaceId: z.string().uuid().optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }).safeParse(c.req.query())
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    const { q, ...filter } = parsed.data
    return viaBridge(c, managedAgentsBridgeSlot, (bridge) => bridge.search(q, filter))
  })
  .post('/sessions', async (c) => {
    const key = idempotencyKey(c.req.raw.headers)
    if (!key) return respondError(c, 400, 'idempotency_key_required')
    const parsed = createAgentSessionSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, managedAgentsBridgeSlot, (bridge) => bridge.createSession(parsed.data, key))
  })
  .post('/transcript-imports', async (c) => {
    const parsed = importAgentTranscriptSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, managedAgentsBridgeSlot, (bridge) => bridge.importTranscript(parsed.data))
  })
  .get('/sessions/:sessionId', (c) => {
    const parsed = pageQuerySchema.safeParse(c.req.query())
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, managedAgentsBridgeSlot, (bridge) =>
      bridge.snapshot(c.req.param('sessionId'), parsed.data.afterSeq, parsed.data.limit))
  })
  .get('/sessions/:sessionId/events', (c) => {
    const parsed = pageQuerySchema.safeParse(c.req.query())
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, managedAgentsBridgeSlot, (bridge) =>
      bridge.events(c.req.param('sessionId'), parsed.data.afterSeq, parsed.data.limit))
  })
  .patch('/sessions/:sessionId', async (c) => {
    const parsed = patchAgentSessionSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, managedAgentsBridgeSlot, (bridge) => bridge.patchSession(c.req.param('sessionId'), parsed.data))
  })
  .delete('/sessions/:sessionId', (c) =>
    viaBridge(c, managedAgentsBridgeSlot, (bridge) => bridge.deleteSession(c.req.param('sessionId'))))
  .post('/sessions/:sessionId/turns', async (c) => {
    const key = idempotencyKey(c.req.raw.headers)
    if (!key) return respondError(c, 400, 'idempotency_key_required')
    const body = await c.req.json().catch(() => null)
    const parsed = enqueueAgentTurnSchema.safeParse(
      typeof body === 'object' && body != null ? { ...body, idempotencyKey: key } : body,
    )
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, managedAgentsBridgeSlot, (bridge) => bridge.enqueueTurn(c.req.param('sessionId'), parsed.data))
  })
  .patch('/sessions/:sessionId/turns/:turnId', async (c) => {
    const parsed = patchQueuedTurnSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, managedAgentsBridgeSlot, (bridge) =>
      bridge.patchQueuedTurn(c.req.param('sessionId'), c.req.param('turnId'), parsed.data))
  })
  .delete('/sessions/:sessionId/turns/:turnId', (c) =>
    viaBridge(c, managedAgentsBridgeSlot, async (bridge) => {
      await bridge.cancelTurn(c.req.param('sessionId'), c.req.param('turnId'))
      return { ok: true }
    }))
  .post('/sessions/:sessionId/cancel', async (c) => {
    const parsed = cancelBodySchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, managedAgentsBridgeSlot, async (bridge) => {
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
    return viaBridge(c, managedAgentsBridgeSlot, (bridge) =>
      bridge.resolveRequest(c.req.param('sessionId'), c.req.param('requestId'), parsed.data.resolution, key))
  })
  .post('/sessions/:sessionId/fork', async (c) => {
    const parsed = forkBodySchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, managedAgentsBridgeSlot, (bridge) => bridge.fork(c.req.param('sessionId'), parsed.data.title))
  })
  .post('/sessions/:sessionId/compact', (c) =>
    viaBridge(c, managedAgentsBridgeSlot, async (bridge) => {
      await bridge.compact(c.req.param('sessionId'))
      return { ok: true }
    }))
  .post('/sessions/:sessionId/handoff-terminal', (c) =>
    viaBridge(c, managedAgentsBridgeSlot, (bridge) => bridge.handoffToTerminal(c.req.param('sessionId'))))
  .post('/sessions/:sessionId/resume-managed', (c) =>
    viaBridge(c, managedAgentsBridgeSlot, (bridge) => bridge.resumeManaged(c.req.param('sessionId'))))
  .post('/sessions/:sessionId/verify-imported-resume', (c) =>
    viaBridge(c, managedAgentsBridgeSlot, (bridge) => bridge.verifyImportedResume(c.req.param('sessionId'))))
  .get('/sessions/:sessionId/export', (c) => {
    const parsed = exportQuerySchema.safeParse(c.req.query())
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, managedAgentsBridgeSlot, async (bridge) => ({
      format: parsed.data.format,
      content: await bridge.exportSession(c.req.param('sessionId'), parsed.data.format),
    }))
  })
  .get('/sessions/:sessionId/wait', (c) => {
    const parsed = agentWaitQuerySchema.safeParse(c.req.query())
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, managedAgentsBridgeSlot, (bridge) =>
      bridge.wait(c.req.param('sessionId'), parsed.data.afterSeq, parsed.data.until, parsed.data.timeoutMs))
  })
