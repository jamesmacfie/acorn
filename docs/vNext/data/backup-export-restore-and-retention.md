# Backup, export, restore and retention

Status: **Normative**
Requirement prefix: `DATA-BACKUP`

## Backup scope

A Node backup includes non-authority Node metadata, core SQLite snapshot, included plugin snapshots and durable
plugin files, manifest/lock/provenance records, configuration and an object manifest. It excludes
Node identity/CA/device private keys without exception, device certificates and grants,
OS-keystore credentials, caches, logs, event replay payloads,
PTY buffers, worktrees, immutable marketplace artifacts and client state.

- **DATA-BACKUP-001** Backup MUST use SQLite online backup/snapshot APIs after checkpointing. Copying
  live database files directly is prohibited.
- **DATA-BACKUP-002** Each entry is hashed, length bounded, stored under a fixed generated archive
  path and listed in a signed canonical manifest. Symlinks, devices, hard links, absolute paths,
  traversal segments and duplicate normalized names are prohibited.
- **DATA-BACKUP-003** The complete archive is encrypted with XChaCha20-Poly1305 using a random
  per-backup data key. That key is wrapped to a user recovery key using Argon2id-derived
  KEK parameters stored in the header, or to a configured hardware/enterprise recovery key.
- **DATA-BACKUP-004** Backup creation requires sufficient space for the complete temporary archive,
  fsyncs data and directory, verifies decryption/digests, then atomically renames it.

## Consistency

Backup records a core `snapshotSequence`, each database schema/version/digest, plugin artifact lock,
and whether a plugin snapshot is complete. A plugin with `include` policy that cannot checkpoint
makes the backup fail; excluded caches are named in the manifest. Secrets are exported only as
separately encrypted secret records when the owner opts into credential backup and performs OS user
presence. Their key-service-only wrapping, authenticated bindings, restart cleanup and fresh
disabled-reference restore are exactly `SEC-DATA-024A` through `SEC-DATA-024F`.

## Restore trust-domain policy

V2 has exactly one restore mode: **Create new Node**. Every restore generates a new Node ID,
identity key, CA, NMK and event/audit sequence domains. Backups never contain the old Node/CA/device
private keys, device certificates, active grants or trust decisions. Every client pairs again.

Restore assigns new IDs to all imported core and plugin resources and writes a signed,
application-encrypted `oldNodeId`, `newNodeId`, `oldUri`, `newUri`, owner and schema mapping. Plugin
URI migration receives only its authorized slice through the broker. The mapping is retained with
the restore record, is never interpreted as authority, and is excluded from normal plugin queries.
Old IDs cannot authenticate, address the new Node or alias live resources. Event sequence restarts
at zero before the first `node.restored.v2` event.

- **DATA-BACKUP-005** Restore always targets a new empty data root. It validates archive limits,
  signatures, schema compatibility, SQLite integrity, foreign keys and plugin locks before atomic
  root selection. It never overlays a live root.
- **DATA-BACKUP-005A** Restoring an identity key, CA key, device certificate,
  grant, unrestricted-native approval, pairing/recovery verifier or old Node ID
  as the live identity is a fatal archive-policy violation. There is no
  identity-preserving feature flag or recovery-package exception.
- **DATA-BACKUP-006** Unavailable plugins retain sealed databases and appear disabled; restore MUST
  NOT execute archived plugin code or fetch artifacts automatically.
- **DATA-BACKUP-007** A failed restore leaves the active root unchanged and deletes temporary
  plaintext/key material.

## Export and transfer

Workspace export is a scoped encrypted archive using the same format but excludes credentials,
devices, Node settings, active process state and unrelated plugins. Import assigns new IDs and
requires explicit path/repository reconciliation.

## Retention defaults

| Data | Default |
| --- | --- |
| Product event replay | 7 days or 256 MiB, whichever first |
| Security audit | 90 days or 512 MiB, whichever limit is reached first |
| Command result | 7 days |
| Command tombstone | 30 days |
| Terminal detached ring | 15 minutes / 4 MiB |
| Operation/stream terminal metadata | 7 days |
| Removed plugin data | 30 days |
| Resource tombstone | 30 days |
| Automatic backups | 7 daily and 4 weekly |

- **DATA-BACKUP-008** Retention changes are owner-audited and cannot reduce legal/security minimums
  silently. Expiry jobs are idempotent, bounded and report failures without deleting newer data.
- **DATA-BACKUP-009** Backup deletion removes the wrapped data key first, then the archive. Remote
  storage deletion cannot be guaranteed and is reported accurately.
