# Data Protection, Backup, and Recovery

Status: normative
Requirement prefix: `SEC-DATA`

Acorn applies application encryption to credentials, identified sensitive
fields, and every backup. General databases, blobs, worktrees, plugin stores,
and caches rely on required OS full-disk encryption. This is an explicit
boundary, not a claim that SQLite is wholly application-encrypted.

## Local data protection

- **SEC-DATA-001:** Node and client startup MUST query platform disk-encryption
  state where supported. A known-unencrypted production data volume is refused:
  a Node cannot create/open its V2 root and a client may use memory-only state
  but cannot persist Node data. If the platform cannot determine encryption
  state, a local OS-authenticated owner must attest that the volume is
  encrypted; the attestation identifies the volume, is audited, survives
  reboot, and must be renewed when that volume identity changes. Non-loopback
  exposure is blocked until verification or attestation succeeds.
- **SEC-DATA-002:** Data roots and directories MUST be owner-only; database,
  WAL/SHM, key envelopes, audit, lock, blob, and metadata files MUST be created
  without group/other access. Startup repairs overly broad permissions or fails
  closed when it cannot.
- **SEC-DATA-003:** Credentials, plugin secret settings, private signing
  material, recovery material, provider refresh tokens, and fields marked
  `application-sensitive` are encrypted under
  [credentials-and-key-management.md](./credentials-and-key-management.md).
- **SEC-DATA-004:** Worktrees, repositories, ordinary task/session records,
  product events, normalized provider data, plugin domain data, thumbnails,
  terminal scrollback, and general caches are not individually encrypted by
  default and therefore require full-disk encryption.
- **SEC-DATA-005:** Sensitive schema labels are immutable without an explicit
  migration. A plugin cannot downgrade a previously sensitive field to bypass
  encryption or backup handling.
- **SEC-DATA-006:** Temporary files use the protected data root, restrictive
  permissions, unpredictable names, atomic replace, and deletion on startup
  reconciliation. Secret plaintext MUST NOT be placed in temporary files.
- **SEC-DATA-007:** Deletion removes database references, cache indexes, wrapped
  DEKs, and active copies. Flash storage and journaling make physical overwrite
  unreliable; crypto-erasure of unique DEKs is the confidentiality guarantee
  for application-encrypted data.

## Client caches and Node separation

- **SEC-DATA-008:** Client storage is partitioned by pinned Node ID and device
  identity. Resource IDs without matching Node qualification are rejected.
- **SEC-DATA-009:** Cache keys, optimistic mutations, view sessions, event
  cursors, layouts, search indexes, and notifications MUST include Node ID.
- **SEC-DATA-010:** Unpairing deletes that Node's certificates, endpoint, cached
  snapshots, search index, view state, events, and plugin artifacts no longer
  referenced by another installation. The UI offers an owner-confirmed export
  before deletion.
- **SEC-DATA-011:** A client MUST NOT copy a secret, decrypted sensitive field,
  or Node-private plugin state into federated search, notifications, clipboard,
  crash reports, or general query persistence.
- **SEC-DATA-012:** Cached responses preserve source sensitivity and expiry.
  Authorization/grant/credential status is never trusted from an offline cache.
- **SEC-DATA-013:** Content from a malicious Node is treated as untrusted by all
  renderers and indexers, with size, parser, URL, and active-content controls.
- **SEC-DATA-014:** Offline queued mutations are disabled for security,
  permission, credential, native execution, pairing, trust, and destructive
  operations. Domain commands queue only when their contract explicitly
  supports idempotent offline submission.
- **SEC-DATA-015:** Reconnect reauthenticates, verifies pin/revocation, resolves
  event gaps, and revalidates queued command preconditions before sending.

## Backup format

- **SEC-DATA-016:** A backup is a versioned manifest plus independently hashed
  encrypted chunks. The manifest names Node ID at export, schema versions,
  plugin IDs/versions, data classifications, chunk digests/sizes, creation
  time, and inclusions/exclusions.
- **SEC-DATA-017:** Every backup uses a fresh random 256-bit backup DEK and
  XChaCha20-Poly1305. Each chunk has a unique random nonce and authenticates
  manifest digest, chunk index, plaintext size, and data class.
- **SEC-DATA-018:** The backup DEK is wrapped by a 256-bit random recovery key by
  default. A passphrase option derives a wrapping key using Argon2id with a
  random 128-bit salt, 256 MiB memory, three iterations, and one lane; lower
  parameters are rejected.
- **SEC-DATA-019:** Recovery keys are displayed once in trusted Acorn UI,
  printable/exportable only by explicit owner action, and never stored beside
  the backup. Backup passwords are strength-checked but no recovery bypass or
  escrow exists.
- **SEC-DATA-020:** The final manifest is authenticated by the backup DEK and
  signed by the exporting Node identity. Restore requires encryption integrity;
  signature mismatch warns that exporter identity is untrusted and requires
  explicit local confirmation, but does not substitute for AEAD verification.

## Backup creation and content

- **SEC-DATA-021:** Backup creation obtains a consistent core snapshot and a
  coordinated versioned snapshot from each participating plugin. A plugin
  timeout marks it excluded; Acorn never represents a partial backup as
  complete.
- **SEC-DATA-022:** Included by default: workspace/repository configuration,
  core domain state, preferences owned by the Node, plugin databases/files,
  permission request history, and non-secret setup state.
- **SEC-DATA-023:** Excluded always: Node/client identity private keys, paired
  device certificates and grants, active sessions, relay session keys,
  idempotency cache, temporary files, artifact caches, and unrestricted native
  approval.
- **SEC-DATA-024:** Provider/plugin credentials may be included only by a
  separate owner checkbox after naming their providers and consequence. They
  remain application-encrypted inside the encrypted backup and restore
  disabled pending confirmation.
- **SEC-DATA-024A:** Before credential export, core canonicalizes the archive
  content manifest without credential ciphertext and computes
  `contentManifestDigest`. Each closed credential envelope contains exactly:
  `apiVersion=acorn.dev/credential-export/v2`, export Node ID, source secret
  record UUID, classification, credential kind, purpose, sorted destination
  constraints, sorted allowed plugin coordinates, source encryption algorithm/
  key version/nonce/AAD fields, encrypted value bytes, secret-DEK wrapping
  algorithm, DEK wrapped to the backup content key, content-manifest digest,
  created time and envelope digest. IDs are UUIDv7; digests are SHA-256;
  timestamps are millisecond UTC; strings are 1–500 bytes; arrays contain at
  most 128 entries; encrypted value is at most 1 MiB.
- **SEC-DATA-024B:** The key service unwraps the source secret DEK inside its
  protected process, verifies the existing ciphertext/AAD, and wraps that DEK
  with XChaCha20-Poly1305 under an HKDF-SHA-256 key derived from the random
  backup DEK using context `acorn-v2/credential-export/<sourceRecordId>`.
  Envelope AAD is RFC 8785 canonical JSON of every envelope field except
  encrypted bytes, wrap nonce/tag and envelope digest. Neither source NMK,
  domain wrapping key, DEK nor credential plaintext leaves the key service.
- **SEC-DATA-024C:** Restore authenticates the archive and envelope, verifies
  source Node/record/purpose/classification/destination/plugin bindings and
  rejects duplicate/swapped/replayed records. Inside the new Node key service,
  it unwraps the export DEK, decrypts with the authenticated source AAD, creates
  a fresh secret record ID/DEK/reference, encrypts under the new Node domain and
  immediately zeroes owned plaintext/DEK buffers. It never copies an old opaque
  reference or master key.
- **SEC-DATA-024D:** Every restored credential starts `disabled-restored`.
  Owner OS presence, provider/destination/plugin confirmation and a successful
  brokered validation advance it to `active`; first use before that fails
  `credential_confirmation_required`. Excluded or individually failed records
  are reported by safe source-record ID and remain absent.
- **SEC-DATA-024E:** Export/restore streams credential records one at a time in
  memory-locked buffers where supported, never writes plaintext temporary
  files, forbids crash/core dumps for the key service and scrubs buffers on
  success, cancellation or failure. A journal records only envelope digest and
  destination record status. Restart deletes an uncommitted destination record
  and retries idempotently; committed fresh records are not duplicated.
- **SEC-DATA-024F:** Credential envelopes may be restored once per
  `(archiveDigest,sourceRecordId,newNodeId)`. Re-running the same restore returns
  the existing disabled destination reference; another new Node creates a
  different record after the same owner/decryption ceremony. Archive possession
  never bypasses current revocation or destination policy.
- **SEC-DATA-025:** Worktrees, repositories, blobs, terminal scrollback, agent
  transcripts, and large caches are excluded by default and selectable by data
  class with an estimated size and sensitivity warning.
- **SEC-DATA-026:** Backup output is written to a newly created file with
  restrictive permissions, streamed with size limits, fsynced, atomically
  finalized, and verified by a full authenticated read before reporting
  success.
- **SEC-DATA-027:** Backup paths and removable/network destinations are selected
  by trusted UI. Plugins cannot choose or learn the destination path.
- **SEC-DATA-028:** Backup previews expose counts, classifications, plugin
  participation, size, and exclusions, never secret values or sensitive
  content.
- **SEC-DATA-029:** Failed or cancelled backup output is visibly marked
  incomplete and safely removed; it cannot be selected for normal restore.
- **SEC-DATA-030:** Backup retention and copying outside Acorn are owner
  responsibilities. Acorn records last verified backup time without recording
  its external path in plugin-visible state.

## Restore and rollback defense

- **SEC-DATA-031:** Restore always targets a new V2 data root and new Node
  identity. It never overwrites a running root, mutates V1 data, or restores the
  old trust domain.
- **SEC-DATA-032:** Restore stages on the destination filesystem, validates
  header/manifest canonical form, AEAD, chunk hashes, size/count/decompression
  limits, schemas, plugin compatibility, and path safety before any activation.
- **SEC-DATA-033:** Restored clients must re-pair. Device records, certificates,
  revocations, active sessions, unrestricted-native approvals, and outstanding
  delegations are never restored.
- **SEC-DATA-034:** Restored plugin artifacts are independently acquired and
  verified by current policy. Data for missing/revoked/incompatible plugins
  remains sealed and disabled for later export or migration.
- **SEC-DATA-035:** Restored permission grants are converted to pending requests;
  no plugin activates until current artifact, runtime, policy, and owner
  approval satisfy them.
- **SEC-DATA-036:** Restored credentials remain disabled and broker-inaccessible
  until the owner confirms provider, destination policy, plugin allowlist, and
  successful validation. Raw credentials are never displayed.
- **SEC-DATA-037:** Restore migrations operate on copies, are bounded and
  resumable, and preserve the original encrypted backup. Failure leaves the new
  root inactive and reports exact recoverable components.
- **SEC-DATA-038:** A rollback to an older backup may restore older domain data,
  but never older security authority. Current marketplace revocations,
  protocol minimums, runtime minimums, and local security policy always apply.

## V1 boundary

V2 backup/restore does not read V1 secrets, sessions, API tokens, plugin data,
or databases. The separate clean-start importer may copy only reviewed
workspace/repository configuration into a new V2 root. Importing executable
repository configuration does not establish trust.
