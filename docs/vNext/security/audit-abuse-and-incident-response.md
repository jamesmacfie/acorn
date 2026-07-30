# Audit, Abuse Controls, and Incident Response

Status: normative
Requirement prefix: `SEC-AUD`

Security audit records support owner understanding and incident reconstruction.
They are tamper-evident against accidental modification and unprivileged
processes; they are not an immutable external ledger against the machine owner
or root.

## Security audit stream

- **SEC-AUD-001:** The Node MUST record pairing window changes, pair success/
  failure limits, client renewal/revocation, identity/key rotation, permission
  grant/deny/revoke, secret create/use/rotate/delete, plugin lifecycle and
  quarantine, native execution, bespoke bridge violations, marketplace
  verification/revocation, backup/restore, repository trust, policy change, and
  recovery actions.
- **SEC-AUD-002:** Each record has audit version, Node ID, monotonically
  increasing audit sequence, UTC time, monotonic offset, event type, outcome,
  authenticated actor, effective principal/delegation chain, Node-qualified
  resource references, request ID, policy/grant version, reason code, and
  previous-record authenticator.
- **SEC-AUD-003:** Records MUST NOT contain secret values, key material, pairing
  secrets, authorization headers, cookies, provider bodies, command/stdin
  contents, source contents, full terminal output, full URLs with queries,
  environment values, or arbitrary plugin logs.
- **SEC-AUD-004:** Owner-supplied names and reasons are control-character
  stripped, length-bounded, and explicitly marked untrusted. Hidden resources
  are represented by stable opaque IDs.
- **SEC-AUD-005:** Security audit is separate from the seven-day/256-MiB product
  event log. Default security retention is 90 days or 512 MiB, whichever first
  requires rotation; security policy may extend it.
- **SEC-AUD-006:** Records are append-only through a core service and chained
  with HMAC-SHA-256 under the audit key derived from the NMK. Sequence gaps,
  invalid chain, truncation before the signed checkpoint, or unexpected reset
  raise a persistent integrity incident.
- **SEC-AUD-007:** Core emits a signed daily checkpoint containing Node ID,
  first/last sequence, final authenticator, and policy version. Export includes
  checkpoints and chain verification results.
- **SEC-AUD-008:** Plugin operational logs are installation-scoped, structured,
  size/rate-bounded, and redacted. Plugins cannot write security audit records;
  they request audited operations from core.
- **SEC-AUD-009:** Diagnostics, telemetry, and crash reporting are opt-in and
  pass a second allowlist/redaction boundary. Process memory and raw databases
  are never automatic diagnostics.
- **SEC-AUD-010:** Only paired owner clients can read security audit. A plugin
  may read its own bounded operational/audit subset through `read-own`; no
  plugin receives fleet-wide security audit.
- **SEC-AUD-011:** Export is an explicit owner action, application-encrypted,
  signed by the Node identity, and records its own audit event without storing
  the destination path.
- **SEC-AUD-012:** Retention deletion occurs only after a checkpoint and records
  the deleted sequence/time range in the next retained segment.
- **SEC-AUD-013:** Clock rollback cannot reorder audit sequence. Time
  uncertainty is recorded; sequence and monotonic offset remain authoritative.
- **SEC-AUD-013A:** Records, checkpoints and retained-range markers MUST
  validate against
  `contracts/schema/audit-envelope-v2.schema.json`; unknown fields and
  versions fail closed. RFC 8785 JSON is the canonical encoding. For record
  sequence `n`, `authenticator = HMAC-SHA-256(epochKey,
  "acorn-audit-record-v2\\0" || u64be(n) || previousAuthenticator-or-32-zero-bytes
  || SHA-256(canonical record without authenticator))`.
- **SEC-AUD-013B:** `epochKey` is HKDF-SHA-256 from the NMK with Node ID salt
  and context `acorn-v2/audit/<epoch>`. It is available only inside the audit
  service and MUST NOT be addressed by a secret reference, credential helper
  or plugin broker. Rotation begins a new epoch whose first record names the
  previous epoch's signed final checkpoint; old epoch keys remain wrapped only
  for retained-chain/export verification.
- **SEC-AUD-013C:** At least daily and before retention/rotation, core signs RFC
  8785 canonical checkpoint bytes without `signature` using the Node identity
  Ed25519 key. A retention deletion removes only complete checkpointed prefixes
  after creating and signing the closed retained-range marker. The first
  retained record's verification root is that marker plus its referenced
  checkpoint; deletion without this linkage enters `recovery-required`.
- **SEC-AUD-013D:** The single default retention rule is 90 days or 512 MiB of
  canonical record bytes, whichever limit is reached first. Owner policy may
  extend but not shorten it. A core retention operation is bounded,
  authenticated as `system`, stores its authorization and never deletes an
  uncheckpointed record or the markers/checkpoints required to verify the
  retained segment.
- **SEC-AUD-013E:** Monotonic offset is nanoseconds since a boot-specific
  monotonic origin. The first record after boot records safe metadata
  `bootBoundary=true` and starts offset at the current monotonic value; wall
  time may move but audit sequence cannot. Export contains records, key-epoch
  public metadata, signed checkpoints and range markers in sequence order.
  The independent verifier checks schema, canonical bytes, HMAC chain,
  checkpoint signatures, epoch linkage, range boundaries, Node ID and
  duplicates before reporting verified.
- **SEC-AUD-013F:** The independent verifier corpus MUST include the exact closed-schema
  [`record`](../contracts/examples/audit-record.json),
  [`checkpoint`](../contracts/examples/audit-checkpoint.json), and
  [`retained-range`](../contracts/examples/audit-retained-range.json) artifacts. Core MUST persist
  and export their complete RFC 8785 canonical bytes; it cannot use a private projection that
  omits `grantVersions`, `targets`, Node identity, signing key identity, or signature.

## Abuse and resource controls

- **SEC-AUD-014:** Node applies independent limits per device, plugin
  installation, view session, endpoint, stream, and destination: request bytes,
  response bytes, concurrent operations, CPU, memory, disk, handles, event
  rate, log rate, and retry rate.
- **SEC-AUD-015:** Authentication failures use exponential backoff with jitter
  and non-oracular responses. Pairing limits are defined in the pairing
  specification. Valid owner traffic cannot disable those limits remotely.
- **SEC-AUD-016:** Expensive commands require admission before allocating PTYs,
  processes, database transactions, component instances, browser views, large
  buffers, or provider requests.
- **SEC-AUD-017:** Cancellation, client disconnect, deadline, revocation, and
  quarantine propagate to pending broker operations. Cleanup has bounded time
  and does not commit a command after cancellation unless its documented commit
  point already passed.
- **SEC-AUD-018:** Automatic retry uses exponential backoff and idempotency;
  persistent authentication, permission, schema, sandbox, revocation, or
  integrity failures are not retried.
- **SEC-AUD-019:** Repeated policy denial, malformed input, CSP violation,
  sandbox denial, signature failure, crash loop, secret misuse, or quota abuse
  raises health severity and may quarantine the installation/device session.

## Incident states and owner response

- **SEC-AUD-020:** Security health has `normal`, `warning`, `restricted`,
  `quarantined`, and `recovery-required`. The most severe active condition wins;
  plugin UI cannot hide or downgrade it.
- **SEC-AUD-021:** Critical identity, key-integrity, artifact-signature, sandbox,
  or audit-chain failure enters `recovery-required` or quarantines the affected
  principal before further privileged work.
- **SEC-AUD-022:** Quarantine stops runtimes, revokes live view/delegation
  tokens, closes broker streams, blocks activation/update carry-forward, and
  preserves immutable artifacts plus a recoverable data snapshot.
- **SEC-AUD-023:** Trusted Acorn UI presents incident type, affected Node/plugin/
  device, first/last observation, containment already applied, potentially
  exposed capabilities/secrets, recommended actions, and exportable redacted
  evidence.
- **SEC-AUD-024:** Recovery actions are idempotent, journaled, and require
  reauthentication appropriate to impact. A plugin cannot acknowledge,
  suppress, or resolve its own security incident.
- **SEC-AUD-025:** Secret exposure response enumerates audited secret use since
  the suspected time, disables affected references, guides provider-side
  rotation, and re-enables only after validation and owner confirmation.
- **SEC-AUD-026:** Incident closure records root cause, affected versions,
  containment, key/credential rotation, data recovery, conformance reruns,
  residual risk, actor, and closure time. Closing a warning does not delete its
  record or restore revoked authority.

## Required runbooks

Implementations MUST ship owner-facing runbooks for lost client, compromised
Node identity, missing master key, malicious/revoked plugin, sandbox escape,
publisher-key compromise, leaked provider credential, corrupt audit chain,
tampered backup, and relay identity failure. Each runbook follows: contain,
preserve redacted evidence, revoke/rotate, verify data integrity, recover into
a known trust domain, rerun affected conformance tests, and document residual
risk.
