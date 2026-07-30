import { z } from 'zod'
import { agentInputPartSchema } from './schemas'

export const PublicAgentSessionSchema = z.strictObject({
  id: z.uuid(),
  taskId: z.uuid(),
  providerId: z.string(),
  profileId: z.string(),
  kind: z.enum(['interactive', 'workflow', 'imported']),
  driverKind: z.string(),
  driverVersion: z.string(),
  providerSessionRef: z.string().nullable(),
  controller: z.enum(['acorn', 'terminal', 'external']),
  runtimeState: z.enum([
    'creating', 'connecting', 'replaying', 'ready', 'working', 'waiting',
    'cancelling', 'reconnecting', 'stopped', 'failed', 'archived',
  ]),
  attention: z.enum(['permission', 'question', 'workflow_gate', 'completed', 'error', 'unread', 'none']),
  statusAuthority: z.enum(['protocol', 'lifecycle_hook', 'process', 'terminal_screen']),
  title: z.string(),
  model: z.string().nullable(),
  config: z.record(z.string(), z.unknown()),
  parentSessionId: z.uuid().nullable(),
  parentTurnId: z.uuid().nullable(),
  lastEventSeq: z.number().int().nonnegative(),
  lastReadSeq: z.number().int().nonnegative(),
  archivedAt: z.number().int().nonnegative().nullable(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

export const PublicAgentTurnSchema = z.strictObject({
  id: z.uuid(),
  sessionId: z.uuid(),
  ordinal: z.number().int().nonnegative(),
  source: z.enum(['interactive', 'workflow', 'automation', 'import']),
  status: z.enum(['queued', 'dispatching', 'active', 'completed', 'cancelled', 'failed', 'interrupted']),
  input: z.array(agentInputPartSchema),
  effectivePolicy: z.record(z.string(), z.unknown()),
  providerTurnRef: z.string().nullable(),
  stopReason: z.string().nullable(),
  usage: z.record(z.string(), z.unknown()).nullable(),
  error: z.strictObject({ code: z.string(), message: z.string() }).nullable(),
  attempt: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  startedAt: z.number().int().nonnegative().nullable(),
  completedAt: z.number().int().nonnegative().nullable(),
})

export const PublicAgentEventSchema = z.strictObject({
  id: z.uuid(),
  sessionId: z.uuid(),
  turnId: z.uuid().nullable(),
  seq: z.number().int().nonnegative(),
  schemaVersion: z.number().int().positive(),
  event: z.record(z.string(), z.unknown()),
  searchText: z.string().nullable(),
  createdAt: z.number().int().nonnegative(),
})

export const PublicAgentRequestSchema = z.strictObject({
  id: z.uuid(),
  sessionId: z.uuid(),
  turnId: z.uuid().nullable(),
  providerRequestId: z.string(),
  kind: z.enum(['permission', 'question', 'elicitation', 'workflow_gate']),
  status: z.enum(['pending', 'resolving', 'resolved', 'expired']),
  title: z.string(),
  detail: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  resolution: z.unknown(),
  expiresAt: z.number().int().nonnegative().nullable(),
  createdAt: z.number().int().nonnegative(),
  resolvedAt: z.number().int().nonnegative().nullable(),
})

export const PublicAgentArtifactSchema = z.strictObject({
  id: z.uuid(),
  sessionId: z.uuid(),
  turnId: z.uuid().nullable(),
  kind: z.enum(['file', 'patch', 'command_output', 'screenshot', 'plan', 'export', 'http_exchange', 'database_result', 'other']),
  title: z.string(),
  mediaType: z.string().nullable(),
  byteSize: z.number().int().nonnegative().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.number().int().nonnegative(),
})

export const PublicAgentSnapshotSchema = z.strictObject({
  session: PublicAgentSessionSchema,
  turns: z.array(PublicAgentTurnSchema),
  events: z.array(PublicAgentEventSchema),
  requests: z.array(PublicAgentRequestSchema),
})

export const PublicAgentProviderSchema = z.strictObject({
  id: z.string(),
  profileId: z.string(),
  label: z.string(),
  driverKind: z.enum(['acp', 'codex-app-server', 'terminal']),
  driverVersion: z.string(),
  installed: z.boolean(),
  authenticated: z.boolean().nullable(),
  executableVersion: z.string().optional(),
  statusAuthority: z.enum(['protocol', 'lifecycle_hook', 'process', 'terminal_screen']),
  capabilities: z.array(z.string()),
  configOptions: z.array(z.unknown()),
  commands: z.array(z.unknown()),
  skills: z.array(z.unknown()),
  diagnostics: z.array(z.string()),
})

export const PublicCreateAgentSessionSchema = z.strictObject({
  providerId: z.string().min(1).max(100),
  profileId: z.string().min(1).max(100),
  title: z.string().trim().min(1).max(500).optional(),
  config: z.record(z.string(), z.unknown()).default({}),
})

export const PublicEnqueueAgentTurnSchema = z.strictObject({
  input: z.array(agentInputPartSchema).min(1).max(32),
  effectivePolicy: z.record(z.string(), z.unknown()).default({}),
})
