# Ownership and state model

Status: **Normative**
Requirement prefix: `DATA-OWN`

## Rules

- **DATA-OWN-001** The Node is authoritative for domain/execution state; Electron is authoritative
  only for device presentation, fleet endpoint hints and caches.
- **DATA-OWN-002** `core.sqlite` contains only core entities, broker records and plugin
  installation/grant metadata. A plugin MUST NOT add a table, trigger or view to core.
- **DATA-OWN-003** Each plugin installation has a distinct `plugins/<publisher>--<name>/data.sqlite`.
  A plugin MUST NOT attach, open, copy, introspect or query another database.
- **DATA-OWN-004** Cross-boundary references use canonical Acorn URIs. They are validated by the
  broker and do not create cross-database foreign keys.
- **DATA-OWN-005** Each durable value has exactly one classification: `public-metadata`, `internal`,
  `sensitive`, `secret`, `cache` or `ephemeral`. The classification controls encryption, logging,
  event payload, backup and deletion behavior.

## Classification

| Class | Examples | Application encryption | Backup | Logging |
| --- | --- | --- | --- | --- |
| `public-metadata` | plugin coordinate/version, non-secret capability IDs | No | Yes | Allowed |
| `internal` | names, Node resource IDs, layouts owned by Node | No; full-disk encryption required | Yes | Redacted/limited |
| `sensitive` | private repo metadata, prompts, file paths, HTTP definitions | Field encryption where designated | Encrypted archive | Identifier/digest only |
| `secret` | tokens, private keys, passwords | Always; preferably OS keystore | Wrapped encrypted secret entry | Never |
| `cache` | provider mirrors, fetched blobs, client query cache | No unless sensitive field | Excluded by default | Never body |
| `ephemeral` | socket ticket, PTY buffers, CSRF-equivalent nonce | Memory or bounded ring only | Never | Never |

- **DATA-OWN-006** Full-disk encryption is an installation prerequisite but is not a substitute for
  secret/sensitive field and backup encryption.
- **DATA-OWN-007** Provider ownership must be represented explicitly. Provider mirrors are
  disposable plugin caches; Acorn-authored notes, tasks, workflows and setup state are durable.

## State boundaries

| State | Store |
| --- | --- |
| Node identity key, CA key, credential root key | OS credential store or encrypted unlock store |
| Core domain and coordination | `core/core.sqlite` |
| Plugin domain, mirror, plugin outbox | plugin `data.sqlite` |
| Immutable artifacts | content-addressed artifact store |
| Large bodies | object/blob store, partitioned by classification and authority |
| Worktrees | managed worktree root, referenced by repository/task URI |
| Fleet connections, layouts, cache | Electron `fleet.sqlite` |
| Client device private key | OS credential store |

## Deletion

Deletion is a command with a documented retention. It first creates a tombstone, revokes active
capabilities/streams, schedules owned external resources, and emits a content-minimal event. Secret
material is cryptographically erased by deleting its wrapped data key. SQLite pages are not assumed
immediately erased; encrypted sensitive values and periodic `VACUUM INTO` maintenance bound
residual data.

- **DATA-OWN-008** Cache deletion MAY be immediate. Durable owner data MUST use the entity's explicit
  archive/retention/delete policy.
- **DATA-OWN-009** Uninstalling a plugin does not implicitly delete its database. Retained data is
  inaccessible to other plugins and is identified by coordinate and schema version.
