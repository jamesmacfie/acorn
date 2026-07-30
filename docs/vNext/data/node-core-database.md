# Node core database

Status: **Normative**
Requirement prefix: `DATA-DB`

The Node uses SQLite 3 in WAL mode with `foreign_keys=ON`, `trusted_schema=OFF`, `recursive_triggers=OFF`,
`busy_timeout=5000`, `synchronous=FULL` and application-controlled migrations. The database is
`core/core.sqlite`; files/directories are owner-only.

## Common encoding

`TEXT` IDs are lowercase UUIDv7/canonical URIs; timestamps are signed 64-bit epoch milliseconds;
booleans are `INTEGER` checked to 0/1; JSON is canonical UTF-8 `TEXT` checked with `json_valid`;
digests are `BLOB(32)`; encrypted values are a versioned AEAD `BLOB`. Every foreign key explicitly
chooses `RESTRICT` or `CASCADE`.

## Required tables

The following is the complete core table ownership catalog. Implementations may add indexes, not
domain tables or columns without updating the V2 schema version.

| Table | Primary/unique keys | Required columns |
| --- | --- | --- |
| `schema_migrations` | `version` | `digest`, `applied_at` |
| `node_metadata` | singleton `id=1` | `node_id` unique, `display_name`, `identity_fingerprint`, `created_at`, `schema_version`, `event_sequence`, `plugin_lock_generation` |
| `devices` | `(device_id,credential_generation)`; unique `certificate_serial`; one active generation/device | `label`, `platform`, `public_key`, `certificate_serial`, `credential_generation`, `issued_at`, `expires_at`, `status`, `revoked_at`, `revocation_reason`, `last_seen_at`, `revision` |
| `pairing_sessions` | `session_id` | `node_id`, `node_identity_public_key`, `identity_fingerprint`, `normalized_endpoint`, `selected_protocol_major`, `owner_confirmation_id`, `owner_actor_json`, `challenge_digest`, `verifier`, `salt`, `created_by`, `created_at`, `expires_at`, `attempts`, `claim_transcript_digest`, `claimed_by`, `certificate_serial`, `claimed_at`, `status`, `revision` |
| `local_bootstrap_sessions` | `bootstrap_id`; unique active singleton | `verifier`, `salt`, `release_manifest_digest`, `node_artifact_digest`, `parent_identity_json`, `child_identity_json`, `channel_kind`, `node_nonce_digest`, `client_nonce_digest`, `device_id`, `csr_digest`, `transcript_digest`, `certificate_serial`, `state`, `created_at`, `expires_at`, `acknowledged_at`, `revision` |
| `device_credential_rotations` | `rotation_id`; unique device/pending generation | `device_id`, `current_generation`, `pending_generation`, `pending_public_key`, `pending_certificate_serial`, `csr_digest`, `client_nonce_digest`, `commit_challenge_digest`, `state`, `created_at`, `expires_at`, `committed_at`, `revision` |
| `recovery_authorities` | `(recovery_id,recovery_epoch)` | `secret_verifier`, `salt`, `identity_fingerprint`, `created_by`, `created_at`, `expires_at`, `attempts`, `status`, `consumed_at`, `replacement_device_id`, `revision` |
| `workspaces` | `workspace_id` | `name`, `appearance_json`, `archived_at`, `created_at`, `updated_at`, `revision` |
| `repositories` | `repository_id`; unique normalized `real_path_key` | `real_path_encrypted`, `real_path_key`, `display_name`, `vcs`, `remote_json`, `config_trust_digest`, `created_at`, `updated_at`, `revision` |
| `workspace_repositories` | `repository_id`; unique `(workspace_id,repository_id)` | `workspace_id`, `assigned_at`, `revision` |
| `tasks` | `task_id` | `workspace_id`, `repository_id`, `name`, `branch`, `worktree_json`, `origin_json`, `archived_at`, `created_at`, `updated_at`, `revision` |
| `resource_tombstones` | `resource_uri` | `kind`, `deleted_at`, `purge_after`, `last_revision`, `reason` |
| `plugin_installations` | `installation_id`; unique `coordinate` | `version`, `manifest_digest`, `trust_tier`, `state`, `health`, `storage_schema_version`, `lock_generation`, `created_at`, `updated_at`, `revision` |
| `plugin_artifacts` | `(installation_id,artifact_id)`; unique digest/target/platform/arch | `kind`, `runtime`, `digest`, `size`, `media_type`, `path`, `state` |
| `plugin_dependencies` | `(installation_id,dependency_coordinate)` | `resolved_installation_id`, `version_range`, `optional`, `contract_json` |
| `capability_grants` | `(grant_id,grant_version)`; unique active installation generation/capability/scope | `grant_generation`, `plugin_coordinate`, `publisher_key_id`, `installation_id`, `installation_generation`, `artifact_digest`, `capability_id`, `capability_revision`, `operations_json`, `scope_kind`, `resource_selector_json`, `constraint_family`, `constraints_json`, `permission_request_digest`, `status`, `approved_by_json`, `approved_at`, `expires_at`, `review_at`, `revoked_at`, `revoked_by`, `revocation_reason`, `revision` |
| `settings_values` | `(owner_coordinate,setting_id,scope_kind,scope_uri)` | `schema_digest`, `value_encrypted`, `sensitivity`, `provenance_json`, `created_at`, `updated_at`, `revision` |
| `setup_wizard_instances` | `instance_id` | `installation_id`, `wizard_id`, `wizard_version`, `definition_digest`, `purpose`, `scope_kind`, `scope_uri`, `state`, `current_step`, `answers_encrypted`, `secret_refs_json`, `effects_json`, `validation_json`, `resume_until`, `created_at`, `updated_at`, `revision` |
| `plugin_lifecycle_operations` | `operation_id` | `installation_id`, `kind`, `state`, `plan_json`, `started_at`, `updated_at`, `error_json`, `revision` |
| `commands` | `command_id` | `device_id`, `operation_id`, `target_uri`, `input_hash`, `input_encrypted`, `state`, `result_encrypted`, `resource_revision`, `event_sequence`, `created_at`, `terminal_at`, `expires_at` |
| `command_tombstones` | `command_id` | `device_id`, `operation_id`, `target_uri`, `input_hash`, `created_at`, `purge_after` |
| `operations` | `operation_id` | `command_id` unique, `target_uri`, `kind`, `state`, `progress_json`, `commit_state`, `result_encrypted`, `error_json`, `created_at`, `updated_at`, `terminal_at`, `revision` |
| `saga_steps` | `(operation_id,step_index)` | `step_id`, `state`, `idempotency_key`, `attempts`, `result_encrypted`, `compensation_state`, `updated_at` |
| `event_outbox` | `sequence`; unique `event_id` | `type`, `schema_uri`, `schema_digest`, `schema_version`, `resource_uri`, `producer_json`, `actor_json`, `command_id`, `correlation_id`, `causation_id`, `occurred_at`, `recorded_at`, `sensitivity`, `payload_encrypted`, `encoded_bytes` |
| `plugin_event_inbox` | `(installation_id,plugin_event_id)` | `plugin_sequence`, `received_at`, `global_sequence`, `state`, `error_json` |
| `view_sessions` | `session_id`; unique `uri`, `capability_hash` | `device_id`, `installation_id`, `contribution_id`, `state`, `session_revision`, `document_revision`, `document_digest`, `capability_hash`, `last_used_at`, `idle_expires_at`, `absolute_expires_at`, `grants_json`, `limits_json`, `revision` |
| `streams` | `stream_id`; unique `uri` | `device_id`, `owner_uri`, `media_type`, `direction`, `oldest_offset`, `current_offset`, `state`, `expires_at`, `revision` |
| `secret_refs` | `secret_ref_id`; unique `uri` | `installation_id`, `scope_uri`, `purpose`, `keystore_locator`, `algorithm`, `created_at`, `rotated_at`, `expires_at`, `status`, `revision` |
| `delegations` | `handle_hash`; unique `invocation_id` | `root_principal_json`, `agent_session_json`, `ordered_hops_json`, `audience`, `operation`, `resource_uri`, `purpose`, `grant_revisions_json`, `parent_handle_hash`, `correlation_id`, `issued_at`, `deadline_at`, `mutation_single_use`, `consumed_at`, `cancelled_at`, `status`, `revision` |
| `audit_key_epochs` | `epoch` | `key_version`, `started_at`, `ended_at`, `previous_epoch_final_authenticator`, `status` |
| `audit_records` | `audit_sequence`; unique `audit_id` | `audit_version`, `node_id`, `audit_key_epoch`, `occurred_at`, `monotonic_offset_ns`, `category`, `event_type`, `actor_json`, `delegation_json`, `request_id`, `policy_version`, `grant_versions_json`, `targets_json`, `outcome`, `reason_code`, `safe_metadata_json`, `previous_authenticator`, `record_authenticator`, `canonical_record` |
| `audit_checkpoints` | `(audit_key_epoch,checkpoint_sequence)` | `node_id`, `first_sequence`, `last_sequence`, `final_authenticator`, `policy_version`, `created_at`, `signing_key_id`, `signature` |
| `audit_retained_ranges` | `range_id` | `node_id`, `first_deleted_sequence`, `last_deleted_sequence`, `first_occurred_at`, `last_occurred_at`, `prior_checkpoint_sequence`, `authorized_by`, `deleted_at`, `reason`, `marker_authenticator`, `signing_key_id`, `signature`, `canonical_marker` |
| `backups` | `backup_id`; unique `uri` | `state`, `scope_json`, `snapshot_sequence`, `archive_digest`, `key_envelope`, `created_at`, `completed_at`, `size`, `error_json`, `revision` |
| `configuration_imports` | `import_id` | `source_root_digest`, `state`, `plan_json`, `mapping_json`, `created_at`, `completed_at`, `error_json` |

## Constraints and indexes

- **DATA-DB-001** `node_metadata`, `event_outbox` insertion and core mutation share transactions;
  sequence increments cannot roll back independently.
- **DATA-DB-002** `tasks(workspace_id,repository_id)` must match an active
  `workspace_repositories` row, enforced by the domain service in the same transaction.
- **DATA-DB-003** Index active/archived resource lists, event `occurred_at`, command expiry, device
  status/expiry, operations state, plugin state/health and audit time/category.
- **DATA-DB-004** Core MUST NOT use arbitrary triggers or loadable SQLite extensions. FTS virtual
  tables require a reviewed core migration and store only explicitly searchable non-secret content.
- **DATA-DB-005** Every write uses a typed repository transaction. Direct route/plugin SQL is
  prohibited.
- **DATA-DB-006** `settings_values` is a host-owned typed settings ledger, not a plugin scratch
  database. It stores only values allowed by the signed definition and scope; secret fields contain
  opaque references. Paired-client presentation values remain in the Client store and never appear
  here.
- **DATA-DB-007** `setup_wizard_instances` is the authoritative resumable wizard state. Step
  transition, declared effect journal, lifecycle gate and emitted setup event commit together.
  Secret entry plaintext never enters `answers_encrypted`; only the vault reference is persisted.
- **DATA-DB-008** Capability JSON columns are canonical copies of the closed
  security-grant fields, not extension bags. Repository code reconstructs the
  complete grant and validates it against
  `capability-v2.schema.json#/$defs/securityGrant` on every write and startup
  reconciliation. Artifact/publisher/installation-generation changes
  supersede grants in the installation switch transaction.
- **DATA-DB-009** Delegation handles are stored only as SHA-256 hashes. Core
  creates and resolves them; plugin input cannot set the root principal, hops
  or grants. Terminal state is retained for 60 seconds after its deadline to
  reject replay and then removed.
- **DATA-DB-010** `audit_records.canonical_record` is the authoritative RFC 8785 byte string for
  the complete schema-valid audit record. Every other record column is a typed index projection:
  `event_type` maps exactly to `eventType`, `targets_json` preserves the complete ordered
  `targets[]`, and `grant_versions_json` preserves the complete ordered `grantVersions[]`. Insert
  and startup verification MUST reject a projection that differs from the decoded canonical
  record; projection columns never participate in authentication independently.
- **DATA-DB-011** `audit_retained_ranges.canonical_marker` is the authoritative RFC 8785 byte
  string for the complete schema-valid retained-range marker. `node_id`, `signing_key_id`,
  `signature`, and every other column are exact index projections and MUST reproduce the signed
  marker without a private field mapping. Missing or mismatched canonical bytes enter
  `recovery-required`.

## Migration

Migrations are ordered integers with SHA-256 digests signed as part of the Node release. Startup
verifies the complete applied chain, takes a recoverable pre-migration snapshot, applies each
transactional migration, runs integrity/foreign-key checks, then advances `schema_version`.
Non-transactional file transformations use a durable lifecycle operation and atomic rename.

Migration failure leaves the prior database and snapshot untouched, prevents readiness and reports
only a safe operator error.
