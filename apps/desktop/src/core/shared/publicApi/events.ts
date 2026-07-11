import { z } from 'zod'
import { IdSchema, UnixMillisSchema } from './primitives'

// Public WebSocket protocol (docs/next/api/events.md §2–§8). Strict frames; unknown types/fields
// produce a correlated error frame. This is distinct from the internal renderer socket.

export const ClientBaseSchema = z.strictObject({
  version: z.literal(1),
  id: z.string().min(1).max(128),
})

const EventFilterSchema = z.strictObject({
  channels: z.array(z.string().min(1).max(200)).min(1).max(100),
  taskIds: z.array(IdSchema).max(100).optional(),
  workspaceIds: z.array(IdSchema).max(100).optional(),
})

export const SubscribeFrameSchema = ClientBaseSchema.extend({
  type: z.literal('subscribe'),
  subscriptionId: z.string().min(1).max(128),
  filter: EventFilterSchema,
  after: z.number().int().nonnegative().optional(),
})
export const UnsubscribeFrameSchema = ClientBaseSchema.extend({
  type: z.literal('unsubscribe'),
  subscriptionId: z.string().min(1).max(128),
})
export const TerminalAttachFrameSchema = ClientBaseSchema.extend({ type: z.literal('terminal.attach'), sessionId: IdSchema })
export const TerminalDetachFrameSchema = ClientBaseSchema.extend({ type: z.literal('terminal.detach'), sessionId: IdSchema })
export const TerminalInputFrameSchema = ClientBaseSchema.extend({ type: z.literal('terminal.input'), sessionId: IdSchema, data: z.string().max(262_144) })
export const PingFrameSchema = ClientBaseSchema.extend({ type: z.literal('ping') })

export const ClientFrameSchema = z.discriminatedUnion('type', [
  SubscribeFrameSchema,
  UnsubscribeFrameSchema,
  TerminalAttachFrameSchema,
  TerminalDetachFrameSchema,
  TerminalInputFrameSchema,
  PingFrameSchema,
])
export type ClientFrame = z.infer<typeof ClientFrameSchema>

export const ServerBaseSchema = z.strictObject({
  version: z.literal(1),
  id: z.string().min(1).max(128),
  at: UnixMillisSchema,
})

export const ReadyFrameSchema = ServerBaseSchema.extend({
  type: z.literal('ready'),
  connectionId: z.string(),
  apiVersion: z.literal('v1'),
  scopes: z.array(z.enum(['read', 'write'])),
  heartbeatMs: z.number().int().positive(),
  maxFrameBytes: z.number().int().positive(),
})
export const AckFrameSchema = ServerBaseSchema.extend({ type: z.literal('ack'), requestId: z.string(), result: z.unknown().optional() })
export const ErrorFrameSchema = ServerBaseSchema.extend({
  type: z.literal('error'),
  requestId: z.string().optional(),
  error: z.strictObject({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
})
export const EventFrameSchema = ServerBaseSchema.extend({
  type: z.literal('event'),
  subscriptionId: z.string(),
  sequence: z.number().int().nonnegative(),
  channel: z.string(),
  actor: z.strictObject({ kind: z.enum(['browser', 'internal', 'api-token', 'system']), id: z.string().optional() }),
  resource: z.strictObject({ type: z.string(), id: z.string() }).optional(),
  data: z.unknown(),
})
export const PongFrameSchema = ServerBaseSchema.extend({ type: z.literal('pong') })

// Close codes (events.md §9).
export const CLOSE = {
  normal: 1000,
  shuttingDown: 1001,
  invalidProtocol: 4400,
  tokenRevoked: 4401,
  forbidden: 4403,
  slowConsumer: 4408,
  frameTooLarge: 4413,
  serverError: 4500,
} as const
