// The agents plugin's own tables (docs/data-layer.md § Plugin databases). Lives in
// <data-root>/plugins/agents.sqlite with its own Drizzle chain, migrated at plugin init.
//
// The companion FTS5 virtual table (`agent_events_fts`, plus its three triggers over `agent_events`)
// is hand-written into the migration rather than declared here; see docs/data-layer.md § Migrations
// for why. main/sessionRepository.ts's search path reads it with raw SQL, migrations/0000_*.sql is
// the only place its shape is stated, and node/ftsSchema.test.ts guards the two staying in step.
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

// Managed agent sessions are task-scoped execution records. Provider-specific resumability remains
// provider-owned (`providerSessionRef`); Acorn owns the normalized local transcript and projections.
export const agentSessions = sqliteTable(
  'agent_sessions',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').notNull(),
    providerId: text('provider_id').notNull(),
    profileId: text('profile_id').notNull(),
    kind: text('kind').notNull(), // interactive | workflow | imported
    driverKind: text('driver_kind').notNull(),
    driverVersion: text('driver_version').notNull(),
    providerSessionRef: text('provider_session_ref'),
    controller: text('controller').notNull().default('acorn'), // acorn | terminal | external
    runtimeState: text('runtime_state').notNull(), // protocol/managedAgents.ts
    attention: text('attention').notNull().default('none'),
    statusAuthority: text('status_authority').notNull(),
    title: text('title').notNull(),
    model: text('model'),
    configJson: text('config_json').notNull().default('{}'),
    parentSessionId: text('parent_session_id'),
    parentTurnId: text('parent_turn_id'),
    lastEventSeq: integer('last_event_seq').notNull().default(0),
    lastReadSeq: integer('last_read_seq').notNull().default(0),
    archivedAt: integer('archived_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('agent_sessions_task_updated_idx').on(t.taskId, t.updatedAt),
    index('agent_sessions_attention_updated_idx').on(t.attention, t.updatedAt),
    index('agent_sessions_provider_ref_idx').on(t.providerId, t.providerSessionRef),
    index('agent_sessions_parent_idx').on(t.parentSessionId),
  ],
)

// A durable queue entry and the canonical turn projection. One active turn per session (docs/managed-
// agents.md § Operations and failure) is enforced by the service scheduler, not a SQLite constraint,
// since Drizzle models partial uniqueness awkwardly.
export const agentTurns = sqliteTable(
  'agent_turns',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    ordinal: integer('ordinal').notNull(),
    source: text('source').notNull(), // interactive | workflow | automation | import
    status: text('status').notNull(), // queued | dispatching | active | completed | cancelled | failed | interrupted
    inputJson: text('input_json').notNull(),
    effectivePolicyJson: text('effective_policy_json').notNull().default('{}'),
    providerTurnRef: text('provider_turn_ref'),
    stopReason: text('stop_reason'),
    usageJson: text('usage_json'),
    errorJson: text('error_json'),
    idempotencyKey: text('idempotency_key').notNull(),
    attempt: integer('attempt').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    startedAt: integer('started_at'),
    completedAt: integer('completed_at'),
  },
  (t) => [
    uniqueIndex('agent_turns_session_ordinal_idx').on(t.sessionId, t.ordinal),
    uniqueIndex('agent_turns_session_idempotency_idx').on(t.sessionId, t.idempotencyKey),
    index('agent_turns_session_status_idx').on(t.sessionId, t.status),
  ],
)

// Append-only normalized event ledger, the durable ordered history docs/api-reference.md § Streams
// describes. `searchText` feeds the migration-owned FTS5 virtual table; large bytes and verbose command
// output live in agent_artifacts instead of this row.
export const agentEvents = sqliteTable(
  'agent_events',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    turnId: text('turn_id'),
    seq: integer('seq').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    eventJson: text('event_json').notNull(),
    searchText: text('search_text'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('agent_events_session_seq_idx').on(t.sessionId, t.seq),
    index('agent_events_turn_seq_idx').on(t.turnId, t.seq),
    index('agent_events_created_idx').on(t.createdAt),
  ],
)

export const agentRequests = sqliteTable(
  'agent_requests',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    turnId: text('turn_id'),
    providerRequestId: text('provider_request_id').notNull(),
    kind: text('kind').notNull(), // permission | question | elicitation | workflow_gate
    // `resolving` is a durable claim made before Acorn sends a response to the provider. It closes
    // the double-submit window without pretending a response is complete before the provider acks.
    status: text('status').notNull(), // pending | resolving | resolved | expired
    title: text('title').notNull(),
    detail: text('detail'),
    payloadJson: text('payload_json').notNull().default('{}'),
    resolutionJson: text('resolution_json'),
    resolutionIdempotencyKey: text('resolution_idempotency_key'),
    expiresAt: integer('expires_at'),
    createdAt: integer('created_at').notNull(),
    resolvedAt: integer('resolved_at'),
  },
  (t) => [
    uniqueIndex('agent_requests_session_provider_idx').on(t.sessionId, t.providerRequestId),
    index('agent_requests_status_created_idx').on(t.status, t.createdAt),
  ],
)

export const agentAttachments = sqliteTable(
  'agent_attachments',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').notNull(),
    storageKey: text('storage_key').notNull(),
    contentHash: text('content_hash').notNull(),
    filename: text('filename').notNull(),
    mediaType: text('media_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    textEncoding: text('text_encoding'),
    createdAt: integer('created_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (t) => [
    uniqueIndex('agent_attachments_task_hash_idx').on(t.taskId, t.contentHash),
    index('agent_attachments_storage_idx').on(t.storageKey),
  ],
)

export const agentAttachmentRefs = sqliteTable(
  'agent_attachment_refs',
  {
    attachmentId: text('attachment_id').notNull(),
    turnId: text('turn_id').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.attachmentId, t.turnId] }),
    index('agent_attachment_refs_turn_position_idx').on(t.turnId, t.position),
  ],
)

export const agentArtifacts = sqliteTable(
  'agent_artifacts',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    turnId: text('turn_id'),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    mediaType: text('media_type'),
    storageKey: text('storage_key'),
    byteSize: integer('byte_size'),
    metadataJson: text('metadata_json').notNull().default('{}'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('agent_artifacts_session_created_idx').on(t.sessionId, t.createdAt),
    index('agent_artifacts_turn_idx').on(t.turnId),
  ],
)

// Idempotency for commands whose resource row does not naturally carry the caller's key (session creation
// and lifecycle changes): internal callers get no device-keyed replay (docs/api-reference.md § Request
// processing), so this table stands in for it here. Results are small, normalized JSON only, and this is
// distinct from core's `idempotency` table, which keys on deviceId at the HTTP layer.
export const agentOperations = sqliteTable(
  'agent_operations',
  {
    idempotencyKey: text('idempotency_key').primaryKey(),
    command: text('command').notNull(),
    resourceId: text('resource_id'),
    resultJson: text('result_json').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('agent_operations_created_idx').on(t.createdAt)],
)

export const agentWebhooks = sqliteTable(
  'agent_webhooks',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id'),
    url: text('url').notNull(),
    eventsJson: text('events_json').notNull(),
    secretEnc: text('secret_enc').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('agent_webhooks_task_enabled_idx').on(table.taskId, table.enabled),
  ],
)

export const agentWebhookDeliveries = sqliteTable(
  'agent_webhook_deliveries',
  {
    id: text('id').primaryKey(),
    webhookId: text('webhook_id').notNull(),
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(), // completion | attention
    payloadJson: text('payload_json').notNull(),
    status: text('status').notNull(), // pending | retrying | delivered | failed
    attempt: integer('attempt').notNull().default(0),
    nextAttemptAt: integer('next_attempt_at').notNull(),
    responseStatus: integer('response_status'),
    error: text('error'),
    createdAt: integer('created_at').notNull(),
    deliveredAt: integer('delivered_at'),
  },
  (table) => [
    uniqueIndex('agent_webhook_deliveries_event_idx').on(table.webhookId, table.eventId),
    index('agent_webhook_deliveries_due_idx').on(table.status, table.nextAttemptAt),
    index('agent_webhook_deliveries_created_idx').on(table.webhookId, table.createdAt),
  ],
)
