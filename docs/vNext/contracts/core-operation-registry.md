# Core operation registry

**Status:** Normative<br>
**Requirement prefix:** `CON-CORE-OP`

This is the closed V2 operation inventory owned by Acorn Node core. Plugins cannot shadow these
identifiers or obtain them through a generic RPC surface. All operations use the shared query or
command envelope, node-qualified target, authentication, authorization, errors, deadline,
idempotency and concurrency rules.

## Schema notation

The following notation is normative shorthand for generated Draft 2020-12 JSON Schema:

- `uri<T>` is a canonical `acorn://<nodeId>/<T>/<uuidv7>` belonging to the connected Node;
- `decimal` is the string form `0|[1-9][0-9]*`;
- `timestamp` is UTC RFC 3339 with exactly millisecond precision;
- `string[a..b]` is UTF-8 text with inclusive code-point bounds and no NUL;
- `array<T>[a..b]` has inclusive item bounds;
- `?` means the property is optional; `|null` means it is required and nullable;
- `page<T>` is exactly `{items:array<T>[0..limit],nextCursor:string[1..4096]|null,
  snapshotSequence:decimal,observedAt:timestamp}`;
- `ack<T>` is exactly `{resource:uri<T>,revision:decimal,eventSequence:decimal}`;
- `accepted` is exactly `{operation:uri<operation>,revision:decimal}`;
- an object not explicitly marked extensible has `additionalProperties:false`.

Defaults named below are inserted during schema validation and participate in canonical request
hashing. Every list cursor is authorization-bound. Every mutation re-derives target ancestry.

## Workspace and repository operations

| Operation | Kind/target | Exact operation input | Exact success data/result |
| --- | --- | --- | --- |
| `acorn.core.workspaces.list.v2` | query/node | `{cursor?:string[1..4096],limit?:integer[1..100]=50,includeArchived?:boolean=false}` | `page<WorkspaceSummary>` |
| `acorn.core.workspaces.get.v2` | query/workspace | `{}` | `WorkspaceDetail` |
| `acorn.core.workspace.create.v2` | command/node | `{name:string[1..100],description?:string[0..500],repositoryUris?:array<uri<repository>>[0..100]}` | `ack<workspace>` |
| `acorn.core.workspace.update.v2` | command/workspace | `{name?:string[1..100],description?:string[0..500],archived?:boolean}` with at least one property | `ack<workspace>` |
| `acorn.core.workspace.delete.v2` | command/workspace | `{confirmation:string[1..100]}` equal to current name | `{tombstone:uri<workspace>,eventSequence:decimal}` |
| `acorn.core.repositories.list.v2` | query/node/workspace | `{workspace?:uri<workspace>,cursor?:string[1..4096],limit?:integer[1..100]=50}` | `page<RepositorySummary>` |
| `acorn.core.repositories.get.v2` | query/repository | `{}` | `RepositoryDetail` |
| `acorn.core.repository.register.v2` | command/node | `{kind:"local-git"|"provider",displayName:string[1..160],localPathRef?:string[1..128],providerRef?:ExternalRef}`; exactly one source | `ack<repository>` |
| `acorn.core.repository.unregister.v2` | command/repository | `{removeManagedWorktrees?:boolean=false,confirmation:string[1..160]}` | `{tombstone:uri<repository>,eventSequence:decimal}` |
| `acorn.core.workspace.repository.assign.v2` | command/workspace | `{repository:uri<repository>,position?:integer[0..10000]}` | `ack<workspace>` |
| `acorn.core.workspace.repository.unassign.v2` | command/workspace | `{repository:uri<repository>}` | `ack<workspace>` |
| `acorn.core.repository.pin.set.v2` | command/repository | `{pinned:boolean,position?:integer[0..10000]}` | `ack<repository>` |

`WorkspaceSummary` is exactly `{resource:uri<workspace>,name:string[1..100],
archived:boolean,repositoryCount:integer[0..100000],taskCount:integer[0..100000],
revision:decimal}`. `WorkspaceDetail` adds `description:string[0..500]`,
`repositories:array<RepositorySummary>[0..100]`, `createdAt:timestamp`, and `updatedAt:timestamp`.
`RepositorySummary` is exactly `{resource:uri<repository>,displayName:string[1..160],
kind:"local-git"|"provider",workspaceUris:array<uri<workspace>>[0..100],pinned:boolean,
revision:decimal}`. `RepositoryDetail` adds `defaultBranch:string[1..255]|null`,
`head:string[7..64]|null`, `providerRef:ExternalRef|null`, `availability:
"available"|"missing"|"offline"`, and timestamps. A local absolute path never crosses this API;
`localPathRef` is a Node-keystore/data-root reference issued by the local administration flow.

## Task operations

| Operation | Kind/target | Exact operation input | Exact success data/result |
| --- | --- | --- | --- |
| `acorn.core.tasks.list.v2` | query/node/workspace/repository | `{workspace?:uri<workspace>,repository?:uri<repository>,states?:array<"open"|"active"|"blocked"|"done"|"archived">[0..5],attentionOnly?:boolean=false,cursor?:string[1..4096],limit?:integer[1..100]=50}` | `page<TaskSummary>` |
| `acorn.core.tasks.get.v2` | query/task | `{includeLinks?:boolean=true}` | `TaskDetail` |
| `acorn.core.task.create.v2` | command/workspace | `{title:string[1..300],description?:string[0..20000],repository?:uri<repository>,externalRef?:ExternalRef,preferredBranch?:string[1..255]}` | `ack<task>` |
| `acorn.core.task.update.v2` | command/task | `{title?:string[1..300],description?:string[0..20000],state?:"open"|"active"|"blocked"|"done"}` with at least one property | `ack<task>` |
| `acorn.core.task.archive.v2` | command/task | `{}` | `ack<task>` |
| `acorn.core.task.restore.v2` | command/task | `{state?:"open"|"active"|"blocked"|"done"="open"}` | `ack<task>` |
| `acorn.core.task.delete.v2` | command/task | `{deleteManagedWorktree?:boolean=false,confirmation:string[1..300]}` equal to current title | `{tombstone:uri<task>,eventSequence:decimal}` |
| `acorn.core.task.external-link.set.v2` | command/task | `{kind:string[1..64],reference:ExternalRef}` | `ack<task>` |
| `acorn.core.task.external-link.remove.v2` | command/task | `{kind:string[1..64],referenceId:string[1..300]}` | `ack<task>` |

`TaskSummary` is exactly `{resource:uri<task>,workspace:uri<workspace>,
repository:uri<repository>|null,title:string[1..300],state:"open"|"active"|"blocked"|"done"|
"archived",attentionCount:integer[0..100000],updatedAt:timestamp,revision:decimal}`.
`TaskDetail` adds `description:string[0..20000]`, `preferredBranch:string[1..255]|null`,
`worktree:uri<worktree>|null`, `links:array<ExternalRef>[0..32]`, and `createdAt:timestamp`.
`ExternalRef` is exactly `{provider:string[1..64],connection:uri<plugin-resource>,
kind:string[1..64],externalId:string[1..300],display:string[1..300],
url:string[1..2048]|null}`.

## Worktree operations

The six worktree operations and their exact inputs/results are `CON-CMD-008`–`CON-CMD-012` in
[queries, commands and results](./queries-commands-and-results.md#core-worktree-operation-family).
They are part of this registry by reference; no second operation family or Terminal-owned alias
exists.

## Device, pairing and recovery administration

| Operation | Kind/target | Exact operation input | Exact success data/result |
| --- | --- | --- | --- |
| `acorn.core.devices.list.v2` | query/node | `{includeRevoked?:boolean=false,cursor?:string[1..4096],limit?:integer[1..100]=50}` | `page<DeviceSummary>` |
| `acorn.core.devices.get.v2` | query/client-device | `{}` | `DeviceDetail` |
| `acorn.core.device.label.update.v2` | command/client-device | `{label:string[1..80]}` | `ack<client-device>` |
| `acorn.core.device.revoke.v2` | command/client-device | `{confirmation:string[1..80],reason?:"lost"|"replaced"|"compromised"|"owner-request"="owner-request"}` | `{device:uri<client-device>,revokedAt:timestamp,eventSequence:decimal}` |
| `acorn.core.pairing-window.create.v2` | command/node | `{deviceLabelHint?:string[1..80]}` | `{pairingSession:uri<pairing-session>,expiresAt:timestamp,displaySecret:string[26..26],fingerprint:string[59..59]}` |
| `acorn.core.pairing-window.cancel.v2` | command/pairing-session | `{}` | `ack<pairing-session>` |
| `acorn.core.recovery-export.create.v2` | command/node | `{expiresInDays?:integer[1..90]=90,ownerKdfSalt:string[22..22],ownerKdfProfile:"argon2id-v2"}` | `{recoveryExport:uri<recovery-export>,encryptedObject:uri<object>,expiresAt:timestamp,eventSequence:decimal}` |
| `acorn.core.recovery-export.revoke.v2` | command/recovery-export | `{}` | `ack<recovery-export>` |

`DeviceSummary` is exactly `{resource:uri<client-device>,label:string[1..80],
platform:"darwin"|"linux"|"windows"|"ios"|"android"|"web",generation:decimal,
pairedAt:timestamp,lastSeenAt:timestamp|null,expiresAt:timestamp,revokedAt:timestamp|null,
revision:decimal}`. `DeviceDetail` adds certificate serial fingerprint, safe endpoint origins and
audit-safe rotation state, never key material. Creating/revoking pairing and recovery authority
requires owner reauthentication and uses the ceremonies in the pairing specification.

## Plugin installation operations

| Operation | Kind/target | Exact operation input | Exact success data/result |
| --- | --- | --- | --- |
| `acorn.core.plugin-installations.list.v2` | query/node | `{states?:array<PluginState>[0..17],cursor?:string[1..4096],limit?:integer[1..100]=50}` | `page<PluginInstallationSummary>` |
| `acorn.core.plugin-installations.get.v2` | query/plugin-installation | `{}` | `PluginInstallationDetail` |
| `acorn.core.plugin.install.v2` | command/node | `{source:PluginSource,requestedVersion?:string[1..64],expectedManifestDigest?:string[71..71],resumeOperation?:uri<operation>}` | `accepted` |
| `acorn.core.plugin.permission.resolve.v2` | command/plugin-installation | `{requestRevision:decimal,decisions:array<GrantDecision>[1..64]}` | `ack<plugin-installation>` |
| `acorn.core.plugin.setup.resume.v2` | command/plugin-installation | `{wizard:uri<wizard-session>}` | `accepted` |
| `acorn.core.plugin.update.v2` | command/plugin-installation | `{requestedVersion?:string[1..64],expectedManifestDigest?:string[71..71],allowPermissionExpansion?:boolean=false}` | `accepted` |
| `acorn.core.plugin.rollback.v2` | command/plugin-installation | `{generation:decimal,confirmation?:string[1..127]}` | `accepted` |
| `acorn.core.plugin.enable.v2` | command/plugin-installation | `{}` | `accepted` |
| `acorn.core.plugin.disable.v2` | command/plugin-installation | `{reason?:"owner"|"maintenance"="owner"}` | `ack<plugin-installation>` |
| `acorn.core.plugin.quarantine.acknowledge.v2` | command/plugin-installation | `{incidentId:string[1..128],action:"keep-disabled"|"reactivate-after-repair",confirmation:string[1..127]}` | `accepted` |
| `acorn.core.plugin.uninstall.v2` | command/plugin-installation | `{data:"retain"|"delete-after-recovery-window"|"delete-now",confirmation:string[1..127]}` | `accepted` |
| `acorn.core.plugin.data.purge.v2` | command/plugin-installation | `{confirmation:string[1..127]}` | `accepted` |

`PluginSource` is a discriminated union: marketplace
`{kind:"marketplace",marketplace:string[1..100],coordinate:string[3..127],
catalogDigest:string[71..71]}` or Developer Source `{kind:"git",repository:string[1..2048],
commit:string[40..64],buildPlanDigest:string[71..71]}`. Floating refs are forbidden.
`GrantDecision` is exactly `{capability:string[3..220],requestRevision:decimal,
decision:"grant"|"deny",constraints:object}` where `constraints` validates against the capability
family's closed schema. `PluginInstallationDetail` is the full aggregate required by
`PLUG-LIFE-007B`; `PluginInstallationSummary` is its Node-descriptor projection plus coordinate,
version, health, current operation and safe recovery label.

## Settings and secret references

| Operation | Kind/target | Exact operation input | Exact success data/result |
| --- | --- | --- | --- |
| `acorn.core.settings.get.v2` | query/node/workspace/repository/task/plugin-installation | `{plugin?:string[3..127],keys?:array<string[1..160]>[0..256]}` | `{values:object,provenance:array<SettingProvenance>[0..256],revision:decimal}` |
| `acorn.core.settings.update.v2` | command/node/workspace/repository/task/plugin-installation | `{plugin?:string[3..127],changes:array<SettingChange>[1..256]}` | `{revision:decimal,changedKeys:array<string[1..160]>[1..256],eventSequence:decimal}` |
| `acorn.core.secret-reference.delete.v2` | command/plugin-resource | `{secretRef:string[1..256],confirmationPurpose:string[1..160]}` | `{deleted:boolean,eventSequence:decimal}` |

`SettingChange` is exactly `{key:string[1..160],value:JSONValue|null}`. Its value validates against
the owning settings schema and cannot contain a secret; secret fields are written through wizard
secret-entry operations and appear only as opaque references. `SettingProvenance` is exactly
`{key:string[1..160],effectiveScope:string[1..64],sourceResource:string|null,
overridden:boolean}`.

## Reliability and authorization matrix

- **CON-CORE-OP-001:** List/get operations are read-only, 10-second default/30-second maximum,
  safely retryable after reauthorization and require the corresponding core `list`/`read` grant.
- **CON-CORE-OP-002:** Create/update/link/settings operations require a command ID for seven-day
  replay and use optimistic revision when the target exists. Their core SQLite commit and named
  product event share the outbox transaction.
- **CON-CORE-OP-003:** Delete/revoke/purge operations require current revision, high-friction
  confirmation, are cancellable only before the tombstone/revocation commit and are never
  automatically retried after an ambiguous external cleanup.
- **CON-CORE-OP-004:** Plugin install/update/rollback/setup/enable/uninstall operations commit a
  durable lifecycle operation before returning `accepted`; the lifecycle transition catalog defines
  subsequent commit points, events, compensation and restart reconciliation.
- **CON-CORE-OP-005:** In addition to common errors, exact domain errors are
  `workspace_not_empty`, `repository_in_use`, `repository_unavailable`, `task_has_active_execution`,
  `worktree_dirty`, `sole_device_recovery_required`, `pairing_window_exists`,
  `plugin_dependency_conflict`, `plugin_permission_required`, `plugin_setup_required`,
  `plugin_generation_unavailable`, `secret_reference_in_use` and `confirmation_mismatch`.
- **CON-CORE-OP-006:** Release conformance MUST compile this notation to closed JSON Schemas, compare
  the generated operation ID/input/result signatures with OpenAPI broker routes and validate one
  positive plus each named negative/error vector before Phase 1 may freeze the protocol.
