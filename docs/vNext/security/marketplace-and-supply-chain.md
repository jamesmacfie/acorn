# Marketplace and Supply-Chain Security

Status: normative
Requirement prefix: `SEC-SUPPLY`

Acorn has a trusted marketplace for System and Acorn Verified artifacts, an
untrusted marketplace for signed Community artifacts, and Developer Source
installation pinned to a source commit. "Signed" means attributable and
untampered; it does not mean harmless.

## Repository metadata and publisher identity

- **SEC-SUPPLY-001:** Marketplace metadata MUST use a TUF-compatible root,
  targets, snapshot, and timestamp chain with threshold root keys, explicit
  expiry, monotonic versions, consistent snapshots, and rollback/freeze
  protection.
- **SEC-SUPPLY-002:** The trusted and Community marketplaces MUST have distinct
  root trust stores, visual identity, policy, and package namespaces. A
  Community key cannot publish into the trusted marketplace.
- **SEC-SUPPLY-003:** System targets require Acorn release threshold signatures
  and an exact shipped allowlist. Acorn Verified targets require an authorized
  publisher signature plus Acorn review attestation.
- **SEC-SUPPLY-004:** Community targets require a publisher signature and
  transparency-log inclusion, but the UI MUST label them unreviewed and MUST
  not imply Acorn approval.
- **SEC-SUPPLY-005:** Publisher identity binds verified legal/display identity,
  signing keys, key history, plugin namespace, trust tier, and revocation
  status. Display names are not identity.
- **SEC-SUPPLY-006:** Artifact signing MUST be keyless Sigstore-compatible
  identity or a registered offline publisher key. Verification checks identity,
  issuer, expected repository/workflow where applicable, artifact digest,
  certificate validity at signing time, transparency inclusion, and revocation.
- **SEC-SUPPLY-007:** Marketplace responses, search ranking, descriptions,
  screenshots, Markdown, URLs, permission explanations, and changelogs are
  untrusted content and use the standard safe renderers.
- **SEC-SUPPLY-008:** A package lock records marketplace root, plugin ID,
  publisher identity, trust tier, version, artifact digests by platform,
  manifest digest, dependency resolution, permission-set digest, transparency
  proof, and installation time.
- **SEC-SUPPLY-009:** Plugin IDs are reverse-DNS identifiers controlled by the
  publisher namespace. Homoglyph/confusable names are detected and shown; they
  do not replace cryptographic identity checks.
- **SEC-SUPPLY-010:** Revoked keys, publishers, artifacts, and plugin versions
  cannot be newly installed or activated. Active affected installations enter
  quarantine according to revocation severity and retain a recoverable data
  snapshot.

## Reproducibility and artifact contents

- **SEC-SUPPLY-011:** Every executable artifact MUST have provenance identifying
  source repository, exact commit, hermetic build definition, builder identity,
  dependencies, tests, and resulting digest.
- **SEC-SUPPLY-012:** Every package MUST include SPDX or CycloneDX SBOM,
  license inventory, runtime tier, supported host triples, schemas, migrations,
  and all logical client/Node artifact relationships.
- **SEC-SUPPLY-013:** Packages are immutable and content-addressed. Marketplace
  version labels resolve to exact digests; Acorn never executes mutable tags,
  branches, release URLs, or latest aliases.
- **SEC-SUPPLY-014:** Node runtime, WASI component, Electron bespoke UI,
  declarative contributions, native executable, assets, schemas, and migrations
  have separate digests under one signed release manifest.
- **SEC-SUPPLY-015:** The client independently downloads and verifies executable
  UI artifacts. A Node may advertise required plugin/version/digest but may not
  provide executable client bytes.
- **SEC-SUPPLY-016:** Node and client artifacts must share compatible plugin and
  contract versions. Mismatch remains a visible partial installation; neither
  side downloads unverified bytes from the other.
- **SEC-SUPPLY-017:** Dependency resolution is complete before permission
  approval. Dependencies are namespaced, version-constrained, digest-locked,
  cycle-checked, and shown to the owner.
- **SEC-SUPPLY-018:** Dependencies do not inherit permissions, secretRefs,
  publisher trust, event access, or caller authority. Each installation is
  independently verified and granted.
- **SEC-SUPPLY-019:** Package managers, dynamic dependency download, remote
  imports, runtime extension installation, and self-update from plugin code are
  forbidden.
- **SEC-SUPPLY-020:** Acorn MUST verify all relevant signatures and digests again
  immediately before activation, not only at download.

## Update, rollback, and revocation

- **SEC-SUPPLY-021:** Update checking verifies nonexpired timestamp/snapshot
  metadata and monotonic version counters. Cached metadata cannot override
  newer observed secure metadata.
- **SEC-SUPPLY-022:** Downgrade is denied unless the target is an explicitly
  selected, nonrevoked rollback artifact and the operation follows the rollback
  ceremony. Security revocation metadata always wins.
- **SEC-SUPPLY-023:** Permission expansion, trust-tier change, publisher change,
  new native runtime, new bespoke UI, new brokered credential purpose, or new
  destination pauses update for owner approval. `core.secret.raw` is not an
  approvable expansion and causes package rejection under `PLUG-PERM-010`.
- **SEC-SUPPLY-024:** Activation stages artifacts read-only, snapshots plugin
  data, runs migrations against the staged copy, verifies health and contracts,
  and atomically switches the active pointer. Failure retains the prior
  nonrevoked version and records the reason.

## Archive and parser safety

- **SEC-SUPPLY-025:** Downloads are limited to a configured marketplace origin,
  HTTPS, five redirects, 512 MiB compressed, 512 MiB expanded aggregate,
  100,000 entries, 100:1 expansion ratio, 512 MiB per entry, and
  platform-normalized path length. Tighter manifest or marketplace limits win.
- **SEC-SUPPLY-026:** Download digest and size are checked while streaming into a
  newly created staging directory on the same filesystem as the artifact store.
- **SEC-SUPPLY-027:** Extraction rejects absolute paths, `..`, empty/dot names,
  NUL, drive/device/UNC paths, alternate data streams, Unicode-normalization
  collisions, case-fold collisions, duplicate entries, hard links, symlinks,
  junctions, FIFOs, sockets, devices, setuid/setgid bits, and unsupported file
  types.
- **SEC-SUPPLY-028:** Extracted permissions are normalized to read-only data or
  declared executable files. Ownership, ACLs, extended attributes, quarantine
  flags, and timestamps from the archive are not trusted.
- **SEC-SUPPLY-029:** Manifest and schema parsers impose input, nesting, string,
  reference, and collection bounds, reject duplicate keys and ambiguous number
  forms, and use a deterministic canonical representation for signing.
- **SEC-SUPPLY-030:** Schemas cannot fetch remote references, execute code, load
  native extensions, or reference files outside the artifact.
- **SEC-SUPPLY-031:** Native binaries must match declared platform, architecture,
  code signature/notarization policy, and digest. Unexpected dynamic
  dependencies or writable load paths fail verification.
- **SEC-SUPPLY-032:** Staging is not executable and is invisible to runtimes
  until verification completes. Failed staging is retained only as redacted
  metadata, then safely deleted.
- **SEC-SUPPLY-033:** Installation locking prevents two transactions from
  migrating or switching the same plugin concurrently. Crash recovery resumes
  or rolls back from an authenticated journal.

## Developer Source

- **SEC-SUPPLY-034:** Developer Source accepts only an explicit repository URL
  plus exact full commit hash. Branches, tags, pull-request refs, and implicit
  submodule heads are forbidden locks.
- **SEC-SUPPLY-035:** Source retrieval and build occur in an ephemeral isolated
  builder with no Node/client master keys, provider credentials, signing keys,
  user SSH agent, cloud metadata, home directory, worktrees, or active plugin
  data.
- **SEC-SUPPLY-036:** Network is disabled during build after declared,
  digest-locked source/dependencies are fetched. No lifecycle install,
  postinstall, prepare, or arbitrary package-manager scripts run.
- **SEC-SUPPLY-037:** Submodules and large-file objects require explicit
  digest-locked declarations. Repository hooks and configuration are ignored.
- **SEC-SUPPLY-038:** Build outputs undergo the same archive, schema, SBOM,
  secret-scan, binary, runtime, and permission verification as marketplace
  artifacts and receive a local provenance statement.
- **SEC-SUPPLY-039:** Developer output is signed by a device-local development
  key and shown as Developer Source. Local signing never promotes it to
  Community, Verified, or System.
- **SEC-SUPPLY-040:** Updating Developer Source requires a new exact commit,
  rebuild, review of source/output/permission changes, and—if unrestricted
  native—repeating the arbitrary-code-execution ceremony.

## Vulnerability response

Marketplace policy MUST define a security contact, private report channel,
severity SLA, artifact/yank/revocation criteria, publisher-key rotation, and
client/Node notification behavior. A critical runtime escape or malicious
artifact triggers signed revocation, activation block, active quarantine,
credential-use review, and an incident runbook; deleting the listing alone is
insufficient.
