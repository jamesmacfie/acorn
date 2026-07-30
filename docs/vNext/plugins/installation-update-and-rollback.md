# Installation, update and rollback

Status: Normative<br>
Requirement prefix: `PLUG-INSTALL`

Installation of Node and Electron artifacts is one coordinated, resumable transaction with a
single owner-facing wizard and distinct verifiers on Node and client.

## Resolve and acquire

- **PLUG-INSTALL-001:** The owner selects an exact version, approved channel, or compatible latest
  policy. The Node resolves manifest, dependencies, signatures and Node artifacts; Electron
  independently resolves required client artifacts.
- **PLUG-INSTALL-002:** Resolution MUST use signed marketplace metadata with freshness, expiry,
  snapshot consistency and anti-rollback versioning. Cached metadata past expiry cannot authorize a
  new install.
- **PLUG-INSTALL-003:** The solver produces an immutable lock containing all coordinates, versions,
  artifact digests, selected platforms, capabilities and dependency edges before bytes are staged.
- **PLUG-INSTALL-004:** Downloads use TLS plus digest/signature verification, bounded streaming,
  archive limits, temporary no-execute storage and atomic cache placement. Verification failure
  deletes the staged member and records a supply-chain health event.
- **PLUG-INSTALL-005:** Marketplace artifacts cannot execute installers, package-manager hooks,
  build scripts or schema code during acquisition.

## Coordinated install flow

1. `install.request`: create operation and lifecycle revision.
2. `resolve`: solve dependencies and lock exact artifacts.
3. `acquire`: Node and initiating Electron client fetch independently.
4. `verify`: digest, signature, publisher, provenance, revocation, archive and platform checks.
5. `review`: show publisher/trust, artifact/runtime types, dependency changes and permissions.
6. `grant`: persist required/optional decisions through host permission UI.
7. `stage`: unpack immutable generations and prepare isolated data.
8. `setup`: run resumable host-rendered wizard.
9. `migrate`: snapshot plugin data and apply migrations in isolation.
10. `start`: launch runtime and validate readiness/health.
11. `activate`: atomically select generation and contributions.
12. `finalize`: retain rollback material, write audit and show completion.

- **PLUG-INSTALL-006:** Every step persists progress and is idempotent. Reopening Electron or
  reconnecting to the Node resumes the operation rather than creating another.
- **PLUG-INSTALL-007:** Required Node/client artifact mismatch holds at a visible partial state.
  Neither side substitutes a different digest.
- **PLUG-INSTALL-008:** Owner cancellation before activation cleans temporary bytes but follows the
  chosen data retention policy for any completed setup/storage. Cancellation after activation is a
  disable or uninstall command.
- **PLUG-INSTALL-009:** If the initiating client disconnects, safe acquisition and verification may
  continue; permission, secret, confirmation and destructive steps pause for an owner client.

## Update

- **PLUG-INSTALL-010:** Update availability is evaluated against channel policy, compatibility,
  revocation and dependency graph. It MUST show release identity, version change, permissions,
  runtime/trust changes, dependencies, data migrations and rollback support.
- **PLUG-INSTALL-011:** Security revocation may block new execution immediately, but it cannot
  silently grant a replacement plugin or discard owner data.
- **PLUG-INSTALL-012:** An update with unchanged permissions MAY use prior grants. Any new,
  broader, reclassified or newly first-use authority requires resolution before activation.
- **PLUG-INSTALL-013:** Old generation remains active during acquisition, verification, setup
  compatibility checks, data snapshot, migration and new-generation readiness.
- **PLUG-INSTALL-014:** At commit, command/event/view routing switches atomically to the new
  generation, old handles are revoked and the old runtime drains.
- **PLUG-INSTALL-015:** Dependency updates are a transaction over the installation graph's selected
  generations, not databases. All new generations must be ready before routing changes; data
  migrations remain isolated per owner and use ordered saga compensation.

## Rollback

- **PLUG-INSTALL-016:** Automatic rollback triggers when activation health gates fail before the
  observation window closes. Owner rollback remains available while compatible old artifacts and
  data snapshot are retained.
- **PLUG-INSTALL-017:** Rollback restores selected artifact generation, dependency lock, grants
  valid for that version, plugin database snapshot and contribution registration. It never restores
  revoked publisher trust or expired credentials.
- **PLUG-INSTALL-018:** A migration MUST declare rollback compatibility. If the old runtime cannot
  read migrated data, the installer retains an encrypted pre-migration snapshot before running it.
- **PLUG-INSTALL-019:** External effects completed during update/setup are not reversed by restoring
  SQLite. They require declared compensations; uncompensated effects are shown in the result.
- **PLUG-INSTALL-020:** Failed rollback leaves the installation disabled with both generations
  preserved, a safe diagnosis and explicit retry/export/uninstall choices.

## Marketplace and Developer Source

- **PLUG-INSTALL-021:** Trusted marketplace contains System and Acorn Verified artifacts.
  Community marketplace contains signed attributable but unreviewed Community artifacts and labels
  them accordingly.
- **PLUG-INSTALL-022:** Developer Source uses a full Git commit or local immutable snapshot,
  displays source and digest, builds without credentials in an isolated builder, captures produced
  digests/SBOM/log, and never promotes the result to verified trust.
- **PLUG-INSTALL-023:** Git branch names, tags and moving URLs cannot be installation locks.
- **PLUG-INSTALL-024:** Marketplace removal does not delete an installed artifact, but signature
  revocation or known compromise applies the configured security quarantine policy.
- **PLUG-INSTALL-026:** Git installation input is closed
  `{apiVersion:"acorn.dev/source-install/v2",commandId,repository,commit,
  buildPlan,expectedLifecycleRevision}` where `commit` is 40 lowercase hex and
  `buildPlan` validates against `source-build-plan-v2.schema.json`. Result is
  `{apiVersion:"acorn.dev/source-install-result/v2",commandId,operationUri,
  installationId,sourceTreeDigest,buildPlanDigest,artifactDigests,sbomDigest,
  provenanceDigest,state}`. The command is keyed by command ID plus canonical
  input digest, cancellable before artifact activation, and resumes the same
  persisted source/build operation.
- **PLUG-INSTALL-027:** Core Git acquisition disables hooks, filters, smudge/
  clean, credential helpers, submodule recursion and worktree config; it fetches
  only the exact commit, verifies the tree, then separately fetches every
  explicitly pinned submodule. Branch/tag/short SHA, unlisted submodule,
  symbolic reference, LFS network fetch or changed tree fails before builder
  start.
- **PLUG-INSTALL-028:** Core fetches declared dependency blobs by HTTPS into a
  digest-only cache before build. The builder receives read-only source,
  declared dependencies/toolchain and empty writable output/scratch mounts. It
  has no network, DNS, home, host filesystem, metadata service, SSH/GPG agent,
  credential store, environment secret, inherited handle, Docker socket or
  install hook. Only argv-vector plan steps using listed tool digests run.
- **PLUG-INSTALL-029:** The builder runs twice from clean state with fixed
  `SOURCE_DATE_EPOCH`; every declared output digest must match. Undeclared/
  oversized output, mutation after hashing, non-identical result, secret-like
  log, timeout/quota/sandbox failure or output not mapping exactly to the
  runtime manifest fails. Core emits a local provenance statement and SBOM;
  artifacts remain Developer Source and receive the normal runtime/UI review.
- **PLUG-INSTALL-030:** Herdr build entries translate automatically only when
  every source/tool/dependency/output can be expressed by the closed plan and
  any dependency install disables package lifecycle scripts. A repository
  shell string, dynamic download, implicit package script, host-tool lookup or
  undeclared output requires an author-supplied reviewed Acorn plan; if it still
  needs network/credentials/host access during build it is deliberately
  unsupported. Builds are never inferred from `package.json`, Makefile or a
  Herdr `build` string.

## Acceptance

- **PLUG-INSTALL-025:** Tests MUST interrupt every step, corrupt every artifact class, expire
  metadata, change dependency resolution, race two clients, deny a new permission, fail migration,
  fail readiness, exhaust disk, disconnect Electron, revoke a publisher and prove deterministic
  resume or rollback without mixed generations.
