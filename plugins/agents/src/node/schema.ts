import { sql } from 'drizzle-orm'
// The agents plugin's own tables (docs/data-layer/plugin-databases.md § Plugin databases). Lives in
// <data-root>/plugins/agents.sqlite with its own Drizzle chain, migrated at plugin init.
//
// The companion FTS5 virtual table (`agent_events_fts` and its three triggers over `agent_events`) is
// hand-written into the migration rather than declared here. See docs/data-layer/migrations.md § Migrations.
// Migration 0005 owns its shape, migration 0012 owns dirty progress, and
// server/ftsSchema.test.ts checks the actual migrated objects.
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

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
    originJson: text('origin_json'),
    driverKind: text('driver_kind').notNull(),
    driverVersion: text('driver_version').notNull(),
    providerSessionRef: text('provider_session_ref'),
    controller: text('controller').notNull().default('acorn'), // acorn | terminal | external
    runtimeState: text('runtime_state').notNull(), // AgentRuntimeState
    attention: text('attention').notNull().default('none'),
    statusAuthority: text('status_authority').notNull(),
    title: text('title').notNull(),
    model: text('model'),
    goalObjective: text('goal_objective'),
    goalStatus: text('goal_status'),
    goalContinuations: integer('goal_continuations').notNull().default(0),
    goalNoProgress: integer('goal_no_progress').notNull().default(0),
    goalVerdictJson: text('goal_verdict_json'),
    configJson: text('config_json').notNull().default('{}'),
    parentSessionId: text('parent_session_id'),
    parentTurnId: text('parent_turn_id'),
    // The subagent roster, projected from this session's own `subagent` events by
    // `AgentStore`. On the row rather than in a table of its own because the row is
    // broadcast to every client whenever an event changes it, which is what makes the task sidebar's
    // sub-rows live for sessions nobody has opened.
    subagentsJson: text('subagents_json'),
    // How many turns are queued and waiting to dispatch. On the row for the same reason as the subagent
    // roster: the row is broadcast whenever it changes, so the task sidebar can mark a session whose only
    // sign of a waiting prompt is this count. Kept current by `AgentStore` on every turn that enters or
    // leaves the queue.
    queuedTurns: integer('queued_turns').notNull().default(0),
    lastEventSeq: integer('last_event_seq').notNull().default(0),
    lastReadSeq: integer('last_read_seq').notNull().default(0),
    // When the session last recorded an event, which is what the sidebar's "last activity" order reads.
    // Not `updated_at`, because that also moves when you open a session, rename it or change who
    // controls it, and a row that jumped every time you clicked it would be no order at all. Null
    // until the first event.
    lastEventAt: integer('last_event_at'),
    archivedAt: integer('archived_at'),
    // When the background pass last put this session's stored tool calls and file changes into the
    // shape recordEvent writes (`compactLedgers`). Null means it has not run yet, so
    // the pass reads only the sessions that still need it.
    ledgerCompactedAt: integer('ledger_compacted_at'),
    // When the retention pass removed this session's history because its task had been archived
    // longer than the owner keeps it (`AgentStore.finishHistoryRemoval`). The row
    // stays so the task still lists the session. Null means the history is still here.
    historyRemovedAt: integer('history_removed_at'),
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
// turn per session (docs/managed-agents/operations.md § Operations and failure), not a SQLite constraint, because
// Drizzle models partial uniqueness awkwardly.
export const agentTurns = sqliteTable(
  'agent_turns',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    ordinal: integer('ordinal').notNull(),
    source: text('source').notNull(), // interactive | workflow | delegation | delegation_report | automation | import | plugin
    status: text('status').notNull(), // queued | dispatching | active | completed | cancelled | failed | interrupted | steering | steered
    inputJson: text('input_json').notNull(),
    continuationInputJson: text('continuation_input_json'),
    notBefore: integer('not_before'),
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
    // For a `steered` row, the running turn it joined.
    steeredIntoTurnId: text('steered_into_turn_id'),
  },
  (t) => [
    uniqueIndex('agent_turns_session_ordinal_idx').on(t.sessionId, t.ordinal),
    uniqueIndex('agent_turns_session_idempotency_idx').on(t.sessionId, t.idempotencyKey),
    index('agent_turns_session_status_idx').on(t.sessionId, t.status),
    index('agent_turns_queued_head_idx')
      .on(t.sessionId, t.ordinal)
      .where(sql`${t.status} = 'queued'`),
  ],
)

// Normalized event ledger, the durable ordered history docs/api-reference/websocket.md § Events describes. It
// appends, and a sequence is never reused. It deletes a tool call's or a file change's superseded
// row, once a newer row carries its whole state (`LedgerFold`), and every row of a session whose task
// was archived longer than the owner keeps history (docs/data-layer/backup-and-retention.md § Retention).
// `searchText` feeds the migration-owned FTS5 virtual table; large bytes and verbose command output
// live in agent_artifacts instead of this row.
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

// SQLite triggers commit this marker with canonical mutations. SearchProjection clears it only
// after complete message materialization and FTS updates commit.
export const agentSearchDirty = sqliteTable('agent_search_dirty', {
  sessionId: text('session_id').primaryKey(),
  fromSeq: integer('from_seq').notNull(),
})

// One row: the index format the search projection last checked the whole index against. No row,
// or a different number, makes the next start run the full check.
export const agentSearchFormat = sqliteTable('agent_search_format', {
  version: integer('version').notNull(),
})

// One row: when the last start's command settle began. No harness outlives the Node, so every command
// opened before then was settled by that pass, and the next start reads only newer events. No row makes
// the next start read every event once.
export const agentCommandSettle = sqliteTable('agent_command_settle', {
  settledBefore: integer('settled_before').notNull(),
})

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

// One row of numbers per finished turn, written by TurnFactsWriter and rewritten by the backfill pass
// when the rules' version moves (docs/managed-agents/turn-facts.md). No text: no prompt, tool input or
// output, or file content. The rows outlive the retention pass, which removes the turns they describe,
// and go only with their session.
export const agentTurnFacts = sqliteTable(
  'agent_turn_facts',
  {
    turnId: text('turn_id').primaryKey(),
    sessionId: text('session_id').notNull(),
    taskId: text('task_id').notNull(),
    // Null when core no longer knows the task.
    projectId: text('project_id'),
    ordinal: integer('ordinal').notNull(),
    firstSeq: integer('first_seq'),
    provider: text('provider').notNull(),
    model: text('model'),
    source: text('source').notNull(),
    status: text('status').notNull(),
    startedAt: integer('started_at').notNull(),
    completedAt: integer('completed_at').notNull(),
    activeMs: integer('active_ms').notNull(),
    firstOutputMs: integer('first_output_ms'),
    approvalWaitMs: integer('approval_wait_ms').notNull(),
    approvals: integer('approvals').notNull(),
    toolCalls: integer('tool_calls').notNull(),
    toolFailures: integer('tool_failures').notNull(),
    longestFailureRun: integer('longest_failure_run').notNull(),
    failureRunSeq: integer('failure_run_seq'),
    repeatedCalls: integer('repeated_calls').notNull(),
    repeatRunSeq: integer('repeat_run_seq'),
    filesChanged: integer('files_changed').notNull(),
    filesRewritten: integer('files_rewritten').notNull(),
    subagents: integer('subagents').notNull(),
    peakContextUsed: integer('peak_context_used'),
    contextSize: integer('context_size'),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    cacheReadTokens: integer('cache_read_tokens').notNull(),
    cacheWriteTokens: integer('cache_write_tokens').notNull(),
    reportedCostUsd: real('reported_cost_usd'),
    version: integer('version').notNull(),
  },
  (t) => [
    index('agent_turn_facts_task_completed_idx').on(t.taskId, t.completedAt),
    index('agent_turn_facts_session_started_idx').on(t.sessionId, t.startedAt),
  ],
)

// One row per tool call of a finished turn, written with the turn's facts and gone with them. Numbers
// and identifiers only: no tool input, output, title, or path. A busy week holds tens of thousands of
// calls, too many to fold from the ledger at read time (docs/managed-agents/turn-facts.md).
export const agentToolCallFacts = sqliteTable(
  'agent_tool_call_facts',
  {
    turnId: text('turn_id').notNull(),
    // The sequence of the call's first ledger row.
    seq: integer('seq').notNull(),
    sessionId: text('session_id').notNull(),
    taskId: text('task_id').notNull(),
    projectId: text('project_id'),
    provider: text('provider').notNull(),
    // The MCP tool name, or the call's kind when it has none.
    tool: text('tool'),
    status: text('status').notNull(),
    exitCode: integer('exit_code'),
    failed: integer('failed', { mode: 'boolean' }).notNull(),
    inSubagent: integer('in_subagent', { mode: 'boolean' }).notNull(),
    startedAt: integer('started_at').notNull(),
    durationMs: integer('duration_ms'),
  },
  (t) => [
    primaryKey({ columns: [t.turnId, t.seq] }),
    index('agent_tool_call_facts_task_started_idx').on(t.taskId, t.startedAt),
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
// lifecycle changes. Internal callers get no device-keyed replay (docs/api-reference/transport.md § Request
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
  (table) => [index('agent_webhooks_task_enabled_idx').on(table.taskId, table.enabled)],
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

// The MCP servers acorn declares to agent sessions (docs/mcp.md § Your own servers). The name is the
// key because it is also what each session stores in `config.mcpServers` and what every harness shows.
// `config_json` holds the command or URL and the environment or headers, with each secret value
// sealed by the node's secret service, so the plaintext exists only at spawn time.
export const agentMcpServers = sqliteTable('agent_mcp_servers', {
  name: text('name').primaryKey(),
  configJson: text('config_json').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

// One sign-in per MCP server that has one (docs/mcp/sign-in.md). Kept out of
// `agent_mcp_servers.config_json` because that config's digest keys consent and tool approval, and a
// token refresh every hour would void both. `state_json` is sealed: tokens, the client registration,
// and the discovered endpoints. `url` is the server the tokens were issued for.
export const agentMcpOauth = sqliteTable('agent_mcp_oauth', {
  name: text('name').primaryKey(),
  url: text('url').notNull(),
  stateJson: text('state_json').notNull(),
  status: text('status').notNull(), // signed_in | expired
  signedInAt: integer('signed_in_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

// One project owns its review history. Metadata remains queryable without opening instruction bodies.
// A second row is retained for the previous approved version, never more than two per project.
export const agentInstructionSnapshots = sqliteTable(
  'agent_instruction_snapshots',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    digest: text('digest').notNull(),
    scope: text('scope').notNull(),
    analyzerVersion: integer('analyzer_version').notNull(),
    filesJson: text('files_json').notNull(),
    bodyEnc: text('body_enc').notNull(),
    approvedAt: integer('approved_at'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('agent_instruction_snapshots_project_idx').on(t.projectId, t.createdAt)],
)
