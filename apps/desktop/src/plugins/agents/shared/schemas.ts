import { z } from 'zod'

export const agentRuntimeStateSchema = z.enum([
  'creating',
  'connecting',
  'replaying',
  'ready',
  'working',
  'waiting',
  'cancelling',
  'reconnecting',
  'stopped',
  'failed',
  'archived',
])

export const agentAttentionReasonSchema = z.enum([
  'permission',
  'question',
  'workflow_gate',
  'completed',
  'error',
  'unread',
  'none',
])

export const agentInputPartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().max(1_000_000) }),
  z.object({ type: z.literal('attachment'), attachmentId: z.string().min(1).max(200) }),
  z.object({
    type: z.literal('file'),
    path: z.string().min(1).max(4_096),
    lineStart: z.number().int().positive().optional(),
    lineEnd: z.number().int().positive().optional(),
  }),
  z.object({
    type: z.literal('context'),
    contextId: z.string().min(1).max(200),
    label: z.string().min(1).max(500),
    content: z.string().max(1_000_000),
    source: z.string().min(1).max(200),
    resourceId: z.string().max(1_000).optional(),
    provenance: z.string().max(2_000).optional(),
    deepLink: z.object({
      pane: z.string().min(1).max(200),
      intent: z.record(z.string(), z.unknown()).optional(),
    }).optional(),
    byteSize: z.number().int().nonnegative().optional(),
    estimatedTokens: z.number().int().nonnegative().optional(),
    freshness: z.enum(['live', 'cached', 'stale', 'unknown']).optional(),
    sensitivity: z.enum(['public', 'workspace', 'private', 'secret']).optional(),
    capturedAt: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal('image'), attachmentId: z.string().min(1).max(200), alt: z.string().max(1_000).optional() }),
])

export const createAgentSessionSchema = z.object({
  taskId: z.string().uuid(),
  providerId: z.string().min(1).max(100),
  profileId: z.string().min(1).max(100),
  title: z.string().trim().min(1).max(500).optional(),
  kind: z.enum(['interactive', 'workflow', 'imported']).default('interactive'),
  resumeProviderSessionRef: z.string().min(1).max(2_000).optional(),
  parentSessionId: z.string().uuid().optional(),
  parentTurnId: z.string().uuid().optional(),
  config: z.record(z.string(), z.unknown()).default({}),
})

export const importAgentTranscriptSchema = z.object({
  taskId: z.string().uuid(),
  providerId: z.string().min(1).max(100),
  profileId: z.string().min(1).max(100),
  title: z.string().trim().min(1).max(500).optional(),
  content: z.string().min(1).max(10 * 1024 * 1024),
})

export const enqueueAgentTurnSchema = z.object({
  input: z.array(agentInputPartSchema).min(1).max(32),
  source: z.enum(['interactive', 'workflow', 'automation', 'import']).default('interactive'),
  effectivePolicy: z.record(z.string(), z.unknown()).default({}),
  idempotencyKey: z.string().min(8).max(200),
})

export const resolveAgentRequestSchema = z.object({
  resolution: z.unknown(),
  idempotencyKey: z.string().min(8).max(200),
})

export const patchAgentSessionSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  archived: z.boolean().optional(),
  lastReadSeq: z.number().int().nonnegative().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
})

export const patchQueuedTurnSchema = z.object({
  input: z.array(agentInputPartSchema).min(1).max(32).optional(),
  ordinal: z.number().int().nonnegative().optional(),
})

export const agentWaitQuerySchema = z.object({
  afterSeq: z.coerce.number().int().nonnegative().default(0),
  until: z.enum(['ready', 'attention', 'turn_completed', 'stopped']).default('turn_completed'),
  timeoutMs: z.coerce.number().int().min(0).max(30_000).default(30_000),
})

export type CreateAgentSessionInput = z.infer<typeof createAgentSessionSchema>
export type ImportAgentTranscriptInput = z.infer<typeof importAgentTranscriptSchema>
export type EnqueueAgentTurnInput = z.infer<typeof enqueueAgentTurnSchema>
export type ResolveAgentRequestInput = z.infer<typeof resolveAgentRequestSchema>
