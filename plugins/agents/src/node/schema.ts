// The agents plugin's own tables (docs/data-layer.md § Plugin databases). Lives in
// <data-root>/plugins/agents.sqlite with its own Drizzle chain, migrated at plugin init.
//
// The companion FTS5 virtual table (`agent_events_fts` and its three triggers over `agent_events`) is
// hand-written into the migration rather than declared here. See docs/data-layer.md § Migrations.
// migrations/0000_*.sql is the only place its shape is stated, server/sessions/sessionRepository.ts reads it with
// raw SQL, and node/ftsSchema.test.ts keeps the two in step.
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
    // The subagent roster, projected from this session's own `subagent` events by
    // server/sessions/sessionRepository.ts. On the row rather than in a table of its own because the row is
    // already broadcast to every client after every event, which is what makes the task sidebar's
    // sub-rows live for sessions nobody has opened.
    subagentsJson: text('subagents_json'),
    // How many turns are queued and waiting to dispatch. On the row for the same reason as the subagent
    // roster: the row is broadcast after every event, so the task sidebar can mark a session whose only
    // sign of a waiting prompt is this count. Kept current by server/sessions/store.ts on every turn that
    // enters or leaves the queue.
    queuedTurns: integer('queued_turns').notNull().default(0),
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

// A durable queue entry and the canonical turn projection. The service scheduler enforces one active
// turn per session (docs/managed-agents.md § Operations and failure), not a SQLite constraint, because
// Drizzle models partial uniqueness awkwardly.
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

// Idempotency for commands whose resource row does not carry the caller's key: session creation and
// lifecycle changes. Internal callers get no device-keyed replay (docs/api-reference.md § Request
// processing), so this table stands in. Results are small normalized JSON. Core's `idempotency` table
// is separate and keys on deviceId at the HTTP layer.
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

// Durable authority and provisioning ledger for managed sessions created by another signed
// task-scoped session. Runtime state remains on agent_sessions; this row answers who may address the
// child, where it sits in the delegation tree, and whether spawn provisioning can be replayed.
export const agentSpawns = sqliteTable(
  'agent_spawns',
  {
    id: text('id').primaryKey(),
    rootTaskId: text('root_task_id').notNull(),
    rootSessionId: text('root_session_id').notNull(),
    ownerTaskId: text('owner_task_id').notNull(),
    ownerSessionId: text('owner_session_id').notNull(),
    parentSpawnId: text('parent_spawn_id'),
    childTaskId: text('child_task_id').notNull(),
    childSessionId: text('child_session_id'),
    childTurnId: text('child_turn_id'),
    depth: integer('depth').notNull(),
    isolation: text('isolation').notNull(), // shared | worktree
    provisioningState: text('provisioning_state').notNull(), // creating | provisioned | failed
    // Immutable input needed to finish a worktree spawn after the Node exits between core task,
    // managed session, and initial-turn writes. Shared spawns predate this recovery path and keep it
    // null.
    provisioningJson: text('provisioning_json'),
    idempotencyKey: text('idempotency_key').notNull(),
    error: text('error'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('agent_spawns_owner_session_idx').on(t.ownerSessionId),
    index('agent_spawns_child_session_idx').on(t.childSessionId),
    index('agent_spawns_root_state_idx').on(t.rootTaskId, t.rootSessionId, t.provisioningState),
    uniqueIndex('agent_spawns_owner_idempotency_idx').on(t.ownerTaskId, t.ownerSessionId, t.idempotencyKey),
  ],
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
