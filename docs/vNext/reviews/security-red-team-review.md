# Security red-team review

Status: **Closed review record — security specification approved in §9**

Reviewed: 2026-07-30

Reviewer role: independent security red team

Requirement prefix: `REVIEW-SEC`

## 1. Initial disposition (historical)

The finding counts in this section are the state at first review. Section 9 and the final verdict
are the authoritative closure state.

The V2 specification is not ready for implementation or release approval. This review found:

| Severity | Count | Completion effect |
| --- | ---: | --- |
| Critical | 3 | Blocks implementation approval and release |
| High | 11 | Blocks implementation approval and release |
| Medium | 1 | Requires correction or a recorded accepted-risk decision |
| Low | 0 | None recorded |

The strongest parts of the security design are the explicit trust boundaries, the default denial of
ambient plugin authority, independent verification of executable UI, the secret broker, and the
supply-chain model. The principal weakness is that several of those prose controls cannot be
implemented from the current machine-readable contracts or are contradicted by another normative
document. Implementers would therefore have to choose security policy while writing V2, contrary to
the programme completion gate.

This review did not modify any authored specification. Each finding below requires an authored
specification change followed by independent re-verification.

## 2. Severity model

- **Critical** means a defect can undermine a root of trust, authorize critical secret or host
  compromise, or cause incompatible implementations to select mutually unsafe security policies.
- **High** means a realistic malicious Node, client, plugin, repository, artifact, backup, or
  network peer can cross a stated authority boundary, or a mandatory security control cannot be
  implemented or tested deterministically.
- **Medium** means the affected feature is deferred, requires substantial preconditions, or has a
  compensating boundary, but the contract still permits a material future security failure.

## 3. Findings

### SR-001 — Critical — The pairing wire contract does not bind the verified pairing transcript

**Evidence**

- `SEC-ID-008` requires the claim to bind the single-use secret, Node ID, pinned Node identity,
  normalized endpoint, device CSR, negotiated protocol major, and fresh nonce.
- `CON-PAIR-003` through `CON-PAIR-006` and
  `contracts/discovery-pairing-and-handshake.md` describe the same channel- and transcript-binding
  intent.
- `PairingClaim` in `contracts/openapi/acorn-node-v2.yaml` requires only `apiVersion`,
  `pairingCode`, `deviceId`, `deviceLabel`, `platform`, `certificateRequest`, and `nonce`. It has no
  expected Node ID, Node fingerprint or public key, normalized endpoint, protocol major, transcript
  digest, claimant signature, or explicit CSR proof of possession.
- `SEC-TEST-ID-002` requires mutation of endpoint, version, CSR, nonce, and Node identity, although
  several of those values do not exist in the machine request.

**Exploit or failure scenario**

An active attacker relays or substitutes part of a pairing exchange between a client and two
endpoints. The user verifies one fingerprint while the implementation associates the one-time code
or CSR with a different endpoint or protocol selection. Because the wire object neither carries nor
cryptographically authenticates the full canonical transcript, the receiver cannot prove which
values the claimant verified. Implementations may add incompatible private binding rules, or accept
a claim that satisfies the schema but violates `SEC-ID-008`.

**Required closure**

Define one canonical pairing transcript and include, at minimum, expected Node ID, expected Node
identity key or fingerprint, normalized endpoint, selected protocol major, pairing-session ID,
single-use challenge, client nonce, and CSR key proof. The client must sign or MAC the transcript
with the CSR private key and the pairing secret as specified by the chosen protocol. The Node must
bind the server-side pairing record to exactly those values, consume it atomically with certificate
issuance, and reject any mismatch before issuing authority. Update OpenAPI, examples, pairing state
transitions, error codes, log-redaction rules, and the test vectors.

**Closure verification**

`SEC-TEST-ID-002` must operate solely through the published contract and independently alter every
bound field, replay a consumed transcript, exchange two concurrent pairing sessions, and substitute
an endpoint and Node identity. Every case must fail before a device certificate or owner record is
committed.

### SR-002 — Critical — Capability grants cannot represent the authority the normative model requires

**Evidence**

- `SEC-AUTH-002` requires a grant to bind plugin coordinate, publisher identity, installation ID,
  artifact digest, capability name and version, resource selector, operation set,
  destination/purpose constraints, grant version, approving actor, and expiry or review policy.
- `PLUG-MAN-022` requires capability constraints to use closed, capability-specific schemas.
- `contracts/schema/capability-v2.schema.json` requires only `id`, `revision`, `scope`, and
  `constraints`. `constraints` accepts arbitrary property names with generic scalar or scalar-array
  values.
- `contracts/schema/plugin-lock-v2.schema.json` reuses that descriptor for grants rather than
  defining an approved-authority record.
- `DATA-CORE-DB-001` describes `capability_grants` with installation, capability ID/revision, scope,
  generic constraints, status, approval fields, revocation, and row revision. It does not persist
  publisher, artifact digest, operation set, grant generation, expiry, review deadline, purpose, or
  a canonical request digest.

**Exploit or failure scenario**

A plugin is updated to a different artifact under the same installation and continues to receive a
grant that was intended for the previous digest. A producer adds a constraint key that one broker
ignores and another interprets, turning an apparently narrow destination or operation grant into a
broad one. An exported lock file cannot prove which publisher and artifact received approval.
Because the database lacks required bindings, restart reconciliation cannot reconstruct the
normative authority and cannot reliably invalidate it after update, publisher change, or review
expiry.

**Required closure**

Separate capability advertisements, permission requests, renderer capability negotiation, and
persisted security grants into distinct schemas. Define closed discriminated schemas for every
security-relevant capability family. A persisted grant must include all `SEC-AUTH-002` bindings, a
canonical permission-request digest, grant generation, creation and expiry/review times, status,
approval actor, and revocation metadata. Unknown constraint keys must fail closed. Installation
generation or artifact digest change must invalidate or re-pend the grant according to an explicit
rule. Align the core table, plugin lock, manifests, command results, audit records, and examples.

**Closure verification**

Schema tests must reject unknown constraints and missing authority bindings. Conformance must show
that digest, publisher, installation generation, operation, purpose, destination, resource,
expiry, and grant-version substitutions all fail at broker dispatch and remain failed after Node
restart.

### SR-003 — High — Multi-hop plugin delegation loses caller identity and grant semantics

**Evidence**

- `SEC-AUTH-017`, `SEC-AUTH-018`, `PLUG-COLLAB-008`, and `PLUG-COLLAB-009` require every
  inter-plugin call to preserve the initiating identity, ordered delegation chain, audience,
  operation, resource, purpose, expiry, and grant version while intersecting authority at every
  hop.
- `invocation-context` in `contracts/wit/acorn-plugin-v2.wit` exposes only `caller-kind`,
  `caller-id`, one optional `delegated-device-id`, a target, a deadline, and a list of grant strings.
  It cannot represent an ordered A-to-B-to-C chain or per-hop attenuation.
- `contracts/schema/event-envelope-v2.schema.json` records one actor and one optional
  `delegatedFrom` UUID. It cannot attribute a chain involving a device and multiple plugin
  installations or the grant revisions used at commit.
- `DATA-CORE-DB-001` leaves actor and delegation material inside unstructured JSON.

**Exploit or failure scenario**

Plugin A invokes B, which invokes C. C sees only B or a single device identifier and cannot
distinguish the delegated call from B acting under its own broader installation authority. Audit
and resulting events cannot prove the initiating principal or the grants intersected at each hop.
If any host implementation trusts the plugin-supplied context or resolves the listed grant IDs
under the callee, B becomes a confused deputy.

**Required closure**

Define a core-minted, opaque delegation handle whose contents and lifetime plugins cannot forge.
Its inspectable descriptor must carry the initiating device or system principal, ordered
installation/generation hops, audience, operation, resource, purpose, deadline, and grant revisions.
The broker must derive effective authority from persisted grants and prior attenuation, never from
plugin assertions. Define the redacted attribution projection used by events and audit. Update WIT,
event schemas, capability-call contracts, core storage, cancellation behavior, and error codes.

**Closure verification**

Conformance must exercise direct, two-hop, and three-hop calls; a callee with broader authority;
revocation during a nested call; attempted handle replay to a different capability/resource; and a
plugin forging caller fields. The callee must never gain more authority than the original
intersection, and audit must identify every hop without exposing secrets.

### SR-004 — High — TLS-terminating reverse proxies contradict direct end-to-end device authentication

**Evidence**

- `SEC-TRANS-001` through `SEC-TRANS-004` require TLS 1.3, mutual TLS, Node pinning, and rejection of
  an invalid, expired, or revoked client certificate before application dispatch.
- `ARCH-TOPO-002` applies the same logical protocol to local and remote Nodes.
- `architecture/local-and-remote-topologies.md` permits a reverse proxy to terminate TLS using a
  separately pinned proxy identity, while merely prohibiting implicit header identity.
- No contract defines client proof forwarding, channel binding, proxy-to-Node authentication,
  preservation of the original device ID, certificate revocation at the Node, or proxy authority
  limits.

**Exploit or failure scenario**

When a proxy terminates client mTLS, the Node authenticates the proxy rather than the paired device.
Either all clients collapse to one proxy principal, or an undefined forwarded assertion is trusted.
A compromised or misconfigured proxy can impersonate any device, bypass per-device revocation, or
alter requests after the client-authenticated TLS channel ends. Pinning the proxy also changes the
meaning of the user-verified Node fingerprint.

**Required closure**

For V2, permit only layer-four TLS passthrough in front of the Node. If TLS termination is a product
requirement, define it as a separate later trust mode with an end-to-end device-signed application
request, replay protection, channel binding, proxy-to-Node mTLS, explicit proxy enrollment and
revocation, original-principal propagation, and visible trust ceremony. A generic proxy certificate
or header must never substitute for the paired device.

**Closure verification**

Direct topology tests must fail when a proxy terminates TLS, substitutes a device, replays a signed
request, or forwards a revoked client. Pass-through mode must preserve the exact Node certificate,
client certificate, Node pin, and device revocation semantics.

### SR-005 — High — Bundled-local bootstrap is a root of trust without a protocol or crash state machine

**Evidence**

- `ARCH-TOPO-001`, `ARCH-TOPO-002`, `SEC-ID-009`, `UX-FIRST-004`, and
  `architecture/electron-client.md` require an OS-user-protected inherited bootstrap channel that
  provisions the first local client certificate without a bearer token.
- The documents do not define the bootstrap message schema, peer/parent proof, Node binary identity
  check, transcript signatures, one-use material erasure, atomic commit point, timeout, or restart
  reconciliation.
- `UX-FIRST-019` requires interrupted bootstrap recovery, but the security conformance catalog has
  no test for the local bootstrap protocol.

**Exploit or failure scenario**

A substituted local service process wins a loopback or inherited-channel race and presents its own
Node identity, or a crashed bootstrap leaves reusable enrollment material and one side believes the
first owner exists while the other does not. A later restart can create two valid first-owner
certificates or no recoverable owner. Same-OS-user process compromise is outside the product
boundary, but binary substitution, descriptor confusion, and non-atomic recovery remain product
failures.

**Required closure**

Define a versioned local-bootstrap transcript and persisted state machine. It must bind the expected
packaged Node artifact identity, parent/child process identity where the OS supports it, inherited
anonymous channel, Node ID and identity key, device CSR, both nonces, and selected protocol. Both
sides must prove possession, certificate issuance and owner creation must share an atomic commit
point, one-use material must be erased, and every crash position must have deterministic
reconciliation. Document the allowed OS mechanisms and fail-closed fallback.

**Closure verification**

Add packaged and development conformance cases for descriptor substitution, wrong child binary,
parallel bootstrap, replay, parent death, child death, and crash before and after the commit point.
Exactly one owner device must result, or the operation must return to a clean unpaired state.

### SR-006 — High — Device-key rotation and sole-owner recovery are not contract-complete

**Evidence**

- `SEC-ID-005` defines device-certificate contents and renewal, while `SEC-ID-014` through
  `SEC-ID-016` define Node identity rotation.
- `UX-PAIR-010` requires mutually authenticated new-key registration, atomic switching, and old-key
  retirement for a client device.
- The OpenAPI contract has pairing and generic command envelopes but no device-key rotation request
  or result carrying old-key proof, new CSR proof, credential generation, serial transition, or
  recovery journal state.
- `CON-PAIR-007` permits sole-client recovery by local administration or an encrypted recovery
  package, but no recovery-package schema, authority, lifetime, revocation epoch, or ceremony is
  specified.

**Exploit or failure scenario**

After suspected device-key compromise, an implementation may renew a certificate over the same
compromised key, temporarily accept both keys without a bounded generation rule, or revoke the old
key before the new key is durably usable. A crash can strand the only owner or leave two credentials
valid indefinitely. An underspecified recovery package can become a permanent bearer credential
that bypasses lost-device revocation.

**Required closure**

Specify a device-key rotation transaction with proof by the currently valid key, proof of possession
of the new CSR key, monotonically increasing device-credential generation, atomic valid-set switch,
old serial revocation, bounded rollback/recovery behavior, and crash journal. Specify the sole-owner
recovery artifact and local-administration proof separately; bind either to Node identity and a
revocation epoch, require high-friction OS presence, make it encrypted and rate-limited, and rotate
it after use.

**Closure verification**

Tests must cover compromised-old-key attempts after commit, new-key use before commit, concurrent
rotations, every journal crash point, expired/replayed recovery artifacts, a rotated Node identity,
and recovery after all client certificates are revoked.

### SR-007 — Critical — Restore has two contradictory Node-identity security policies

**Evidence**

- `SEC-DATA-023` always excludes Node/client identity private keys and paired-client certificates
  from backup.
- `SEC-DATA-031` requires every restore to use a new V2 data root and new Node identity;
  `SEC-DATA-033` requires clients to pair again and says old trust is not restored.
- `SEC-TEST-DATA-005` treats a new root, new identity, re-pairing, and current revocations as
  mandatory.
- `data/backup-export-restore-and-retention.md` defines a normative **Preserve Node identity** mode
  using an encrypted recovery package containing the same Node identity and CA, alongside a
  separate **Create new Node** mode.

**Exploit or failure scenario**

One implementation restores an old Node private identity and revives its previous trust domain while
another always creates a new identity. An archive captured before device revocation can resurrect a
compromised or retired Node key, preserve resource URIs that current security tests require to
change, and create ambiguous client pin/revocation behavior. The two policies cannot both satisfy
the normative conformance suite.

**Required closure**

Adopt one V2 policy. The security review recommends the already-specified fail-safe rule: backups
never contain Node identity keys, restore always creates a new trust domain and Node ID, all clients
re-pair, and imported resource relationships receive an explicit old-to-new URI mapping. Remove the
identity-preserving mode from every normative document and example. If identity preservation is
retained instead, it requires a separately specified offline recovery-root hierarchy, revocation
epoch, anti-rollback proof, mandatory post-restore rotation, and replacement conformance model.

**Closure verification**

All backup, restore, identity, resource-ID, event-sequence, client-cache, and conformance documents
must state the same policy. A pre-revocation archive must not restore an old Node key, device
certificate, grant, or trust decision.

### SR-008 — High — Portable credential backup lacks a defined rewrapping and restore protocol

**Evidence**

- `SEC-KEY-001` through `SEC-KEY-005` bind secret data-encryption keys to Node key-management
  domains.
- `SEC-DATA-023` excludes identity private keys, while `SEC-DATA-024` permits selected credentials
  to be included application-encrypted inside an encrypted backup.
- `data/backup-export-restore-and-retention.md` refers to separately encrypted secret records and
  owner OS presence but does not define how a secret DEK is exported from the old Node key domain
  and re-encrypted into the new Node key domain.
- The create-new-Node path says secret references are excluded, whereas `SEC-DATA-036` describes
  restored credentials as present but disabled pending confirmation.

**Exploit or failure scenario**

An implementer copies ciphertext that cannot be decrypted under the restored Node's new key,
exports the old Node master key into the archive, or temporarily writes plaintext while translating
records. Restored opaque references can point to nonexistent or wrong-Node material. A malicious
archive can swap encrypted credential records unless the record identity, purpose, and source Node
are authenticated.

**Required closure**

Define a credential export envelope. The key service must unwrap each secret DEK internally and
rewrap it under a backup content key without exposing plaintext or the Node master key. Associated
data must bind export Node ID, secret record ID, classification, credential kind, purpose, and
archive manifest digest. Restore must authenticate the envelope, decrypt only inside the key
service, create a fresh disabled secret record and opaque reference, rewrap under the new Node key,
and require owner presence before first use. Specify cancellation, crash cleanup, memory handling,
partial failure, and exclusion behavior.

**Closure verification**

Tests must cover wrong passphrase/key, swapped records, modified purpose, archive replay, failed
mid-record restore, new-Node rewrapping, absence of old master keys and plaintext temporary files,
and confirmation before broker use.

### SR-009 — High — The core audit model cannot store or verify the required tamper-evident record

**Evidence**

- `SEC-AUD-002` requires audit version, Node ID, monotonically increasing audit sequence, wall time,
  monotonic offset, actor/delegation, request ID, policy/grant version, target, action, result, and
  safe metadata.
- `SEC-AUD-006` and `SEC-AUD-007` require an HMAC chain under a versioned audit key and signed daily
  checkpoints with sequence and chain information.
- `DATA-CORE-DB-001` gives `audit_records` only audit ID, occurrence time, category, actor JSON,
  target URI, action, outcome, safe metadata, previous hash, and record hash. It has no audit
  sequence, format version, Node ID, monotonic offset, request ID, policy/grant version, audit-key
  version, checkpoint table, or retained-range marker.
- `SEC-AUD-005` sets default retention to 90 days or 512 MiB, whichever is reached first.
  `data/backup-export-restore-and-retention.md` instead states 180 days and a configured minimum of
  256 MiB.

**Exploit or failure scenario**

After deletion, rollback, reordering, key rotation, or restore, the verifier cannot distinguish a
valid retained segment from a truncated history using the documented table. Daily checkpoints have
no normative durable representation. Different deployments erase audit evidence at different
times while all claim conformance. The tests in `SEC-TEST-AUD-002`, `SEC-TEST-AUD-005`, and
`SEC-TEST-AUD-006` cannot be implemented deterministically.

**Required closure**

Define a closed audit-envelope schema and normalized storage for records, key epochs, signed
checkpoints, and checkpointed retained-range tombstones. Persist every field in `SEC-AUD-002`.
Specify the exact canonical encoding and authenticator inputs, boot/restart monotonic behavior,
rotation linkage, deletion authorization, export verification, and one retention rule. Ensure the
audit key cannot be used through the plugin secret broker.

**Closure verification**

An independent verifier must detect modified, deleted, reordered, duplicated, truncated, and
cross-Node records; validate key rotation and retained-range markers; and reproduce the same result
from live storage and a signed export without access to sensitive payloads.

### SR-010 — High — Verified native plugins can combine raw secrets with direct network egress

**Evidence**

- `SEC-KEY-029` permits specifically granted Acorn Verified native code to receive raw secret
  material.
- `SEC-PLUG-027` and `PLUG-NATIVE-010` permit constrained direct network access when brokered access
  is insufficient and prohibit broker-managed credential plaintext on that direct channel.
- No policy states that `core.secret.raw` and direct socket authority are mutually exclusive for an
  installation, process, invocation, or credential.
- The generic capability schema cannot express or validate this toxic combination.
- `SEC-TEST-KEY-009` tests denial to ungranted runtimes, while the native network tests do not test
  a legitimately raw-secret-granted process that also has direct egress.

**Exploit or failure scenario**

A compromised Verified native plugin obtains a raw provider key for a legitimate SDK and also an
exact direct-network grant for a seemingly legitimate endpoint under its control or later
compromise. It exfiltrates the secret outside the broker, bypassing destination/purpose injection,
redirect stripping, and secret-use audit. The individual grants can each appear policy-compliant.

**Required closure**

Declare incompatible capability combinations in the authorization policy and machine schema. A
process that receives raw secret bytes must have direct sockets, child processes, writable
unbrokered files, crash dumps, diagnostics attachment, and inherited handles denied for the entire
secret lifetime; provider traffic must use a fixed broker or a dedicated credential-using helper
with equivalent confinement. Prefer prohibiting raw secrets entirely in V2 unless one named
first-party integration proves the need and confinement. Revocation must terminate the process and
scrub the secret-bearing environment.

**Closure verification**

Add a test that grants each authority separately, attempts to combine them, changes DNS and
redirects, forks a child, writes diagnostics and files, and revokes during use. No secret-bearing
runtime may establish an unmediated exfiltration path.

### SR-011 — High — Docker Compose execution is not bound to executable repository trust

**Evidence**

- `CUR-DOCKER-013` correctly states that Docker control is effectively host-code authority.
- `CUR-DOCKER-014` constrains the Docker executable and argument construction.
- `CUR-DOCKER-010` includes Compose lifecycle actions, including destructive `down`.
- `CUR-DOCKER-011` says declarative Docker matching configuration does not require executable
  repository trust, but the plugin specification never separately requires exact-snapshot trust for
  Compose YAML, override files, included files, environment files, Dockerfiles, bind mounts, or
  build context consumed by the command.
- `SEC-AUTH-021` through `SEC-AUTH-026` require exact-snapshot trust for repository-controlled
  executable configuration and commands.

**Exploit or failure scenario**

A malicious repository changes `compose.yaml` to mount the user's home or Docker socket, use a
privileged container, load an attacker-controlled environment file, or build a hostile Dockerfile.
The user clicks a normal Docker start action. Exact executable and argv allowlisting does not help:
Docker interprets repository content and grants host-level authority to it.

**Required closure**

Distinguish non-executable service matching metadata from the executable Compose plan. Resolve the
complete Compose, include, environment, Dockerfile, build-context, and override graph
descriptor-relative; hash the exact snapshot; display a materialized plan and high-risk effects; and
require repository trust before build, up, exec, or destructive lifecycle actions. Invalidate trust
on any graph change. Privileged mode, host paths, device mounts, Docker socket, host networking,
secrets, and elevated capabilities require separate explicit grants and policy.

**Closure verification**

Add repository-adversary tests for changed includes, symlinks, `.env` substitution, absolute and
relative bind mounts, Docker-socket mounting, privileged/device/host-network settings, hostile
Dockerfile changes, and trust invalidation between preview and execution.

### SR-012 — High — Bespoke UI origin, expiry, and bridge limits contradict each other

**Evidence**

- `SEC-UI-002` names the origin as
  `https://<installation-id>.plugins.acorn.invalid/` while also requiring origins never to be shared
  across versions, preview sessions, or Nodes. An installation ID alone does not encode Node,
  artifact generation, or view instance.
- `SEC-UI-010` sets an eight-hour absolute view-session lifetime.
- `UI-VIEW-002` and `UI-BESPOKE-BRIDGE-003` set a twelve-hour absolute lifetime.
- `SEC-UI-020` and `SEC-UI-021` allow 1 MiB messages and bursts of 100 messages/second.
- `UI-BESPOKE-BRIDGE-004` and `UI-BESPOKE-BRIDGE-007` instead allow 256 KiB messages and 60
  messages/second with a separate byte-rate limit. No document defines a stricter-limit-wins rule.

**Exploit or failure scenario**

An updated or preview artifact is loaded into the same synthetic origin as an older artifact, making
engine cache, process, origin-policy, or future storage mistakes cross a generation boundary.
Different components accept a stolen or detached capability for eight or twelve hours. A host and
view built to different documented size/rate limits disagree about framing, creating denial of
service or bypass behavior at their boundary.

**Required closure**

Derive each origin from a Node-scoped value, installation ID, immutable artifact digest or
generation, and random view-instance nonce. Use an ephemeral partition for every view instance and
destroy it at closure. Select one absolute lifetime and one set of control-message, rate, byte-rate,
in-flight, and stream limits; encode them in the view-session/bridge schemas and state explicitly
that negotiated limits may only become stricter. Align security, UI, examples, and tests.

**Closure verification**

Install the same coordinate on two Nodes, update it, open simultaneous preview and production
views, and attempt origin/cache/storage/process crossover. Exercise both sides of every limit and
expiry boundary. No generation, Node, or view instance may share authority or retained active
content.

### SR-013 — High — Snapshot recovery accepts untyped resource objects at the malicious-Node boundary

**Evidence**

- `SnapshotResult.resources.items` in `contracts/openapi/acorn-node-v2.yaml` is an unconstrained
  object, subject only to the surrounding item count.
- `DATA-EVT-008` through `DATA-EVT-012` allow plugin snapshot boundaries, source sequences, explicit
  degradation, and exclusions that are not represented by a closed wire envelope.
- `CON-EVT-006`, `SEC-TRANS-012`, and `DATA-CLIENT-004` require an authorized, validated, atomic
  snapshot replacement after a replay gap.
- `SEC-DATA-013` requires hostile Node content to be bounded and validated before durable client
  storage.

**Exploit or failure scenario**

A malicious or corrupted Node sends deeply nested, oversized, schema-ambiguous objects after cursor
expiry. The client cannot identify the exact schema/digest, sensitivity, resource revision, source
sequence, omission reason, or plugin owner before placing them in a cache partition. Parser/resource
exhaustion and cross-type cache poisoning are possible precisely on the mandatory recovery path.
Different clients will invent incompatible snapshot grouping and atomicity rules.

**Required closure**

Define a closed `SnapshotResource` envelope containing canonical resource URI and type, owner,
schema URI and digest, resource revision, sensitivity, source sequence, bounded payload or authorized
large-object reference, and authorization projection. Define plugin snapshot groups, overall and
per-group commit boundaries, explicit omissions/errors, byte/depth/count limits, digest selection,
and stale snapshot rejection. Unknown schemas or digests must fail closed without corrupting the
last valid partition.

**Closure verification**

Tests must submit unknown schemas, wrong digests, duplicate/conflicting URIs, mixed Nodes, stale
source sequences, authorization changes, oversized/deep payloads, partial plugin failure, and a crash
at every atomic-install boundary.

### SR-014 — Medium — The future relay boundary lacks deterministic replay and revocation semantics

**Evidence**

- `SEC-TRANS-013` through `SEC-TRANS-025` define a sound high-level Noise/AEAD and opaque-relay
  boundary.
- `SEC-TRANS-020` rejects reordering outside a receive window but does not define window size,
  bitmap/acknowledgement behavior, counter exhaustion, wrap behavior, or resume semantics.
- No relay envelope or handshake binds the channel to current device-certificate generation,
  device-revocation epoch, Node-identity generation, or relay-routing-token lifecycle.
- `ARCH-TOPO-007` through `ARCH-TOPO-009` intentionally defer relay delivery from V2.

**Exploit or failure scenario**

Future relay implementations choose incompatible replay windows and resumption rules. A stored frame
or routing credential from before device revocation or Node rotation is accepted by an endpoint that
has not bound the Noise session to the current trust epoch. Because this is not a V2 deliverable,
the defect does not expose shipped V2 direct transport, but the current claim that relay is fully
constrained is too strong.

**Required closure**

Before relay implementation begins, publish a versioned relay envelope and handshake state machine
with transcript test vectors, fixed replay-window algorithm and bounds, counters, acknowledgement
and resumption rules, device and Node trust generations, revocation checks, routing-token issuance
and revocation, offline queue bounds, rotation, and terminal failure behavior. Until then, describe
relay security as an architectural boundary rather than an implementation-complete contract.

**Closure verification**

Independent test vectors must cover duplicated, reordered, delayed, cross-session, counter-boundary,
pre-revocation, pre-rotation, and resumed frames, plus a malicious relay substituting routing
metadata.

### SR-015 — High — The remote preview tunnel is security prose without a wire and origin contract

**Evidence**

- `CON-PREVIEW-001` through `CON-PREVIEW-004` require a device/task/target/view-bound tunnel and an
  opaque ephemeral client-loopback origin with normalized request and response messages.
- The AsyncAPI contract defines generic stream frames but no preview tunnel open result, HTTP
  request/response frame schemas, per-request authorization context, header allow/deny list,
  lifecycle acknowledgement, or tunnel error envelope.
- `CUR-PREVIEW-097`, `CUR-PREVIEW-105` through `CUR-PREVIEW-107`, and `UI-MEDIA-023` require
  isolation and safe remote operation but do not define origin entropy, loopback listener
  authentication, `Host`/`Origin` validation, port reuse, service-worker teardown, or cache/cookie
  generation.
- The central security conformance catalog has no remote-preview test covering cross-view loopback
  requests or local cross-site request forgery.

**Exploit or failure scenario**

Electron reuses a loopback origin, port, cookie jar, or browser partition across Nodes or view
generations. A malicious local webpage or another preview guesses or reaches the loopback listener
and sends requests under another view's tunnel. Active preview content registers a service worker
or leaves authenticated cache/cookies that survive target or plugin changes. Generic stream framing
does not give both peers an interoperable way to reject mixed requests or late response frames.

**Required closure**

Define preview-specific AsyncAPI messages and state transitions. Generate a high-entropy origin and
listener authorization value bound to Node, device, task, target generation, view session, and
tunnel expiry. Require exact `Host` and `Origin` checks, preview-partition-only credentials, a
closed header/method policy, request IDs and byte counters, redirect reauthorization, terminal
acknowledgement, port/token retirement, and explicit service-worker/cache/cookie teardown. Bind
client-operation requests to the same origin generation and selected device.

**Closure verification**

Test cross-Node, cross-view, stale-port, guessed-token, malicious local-origin, service-worker,
redirect, DNS-rebinding, forbidden-header, oversized-body, late-frame, selected-client substitution,
and teardown cases. Only the exact active preview partition may use the tunnel.

## 4. Passing controls

The following controls survived adversarial review at the architectural level. Their implementation
still depends on closure of the machine-contract findings above.

| Control area | Passing assessment |
| --- | --- |
| Identity separation | Acorn Node identity, client-device identity, and provider identities are explicitly separate. Provider login does not grant Acorn owner authority. |
| Direct transport baseline | TLS 1.3, mutual device authentication, Node fingerprint pinning, disabled 0-RTT, bounded messages, and pre-dispatch rejection form a strong direct-connection baseline. |
| Relay confidentiality boundary | The future relay is denied application plaintext and command authority; endpoint-authenticated application encryption is required inside relay transport. |
| WASI isolation | WASI Components receive no ambient filesystem, environment, network, clock, randomness, process, or credential authority; host imports, quotas, cancellation, and revocation are explicit. |
| Native isolation honesty | Native execution requires an enforceable OS sandbox and fails closed when unavailable. Unsandboxed Developer Source is presented as unrestricted local code execution, not as a sandbox. |
| System-plugin trust | In-process System plugins are correctly identified as part of the trusted computing base rather than described as isolated third-party code. |
| Executable UI acquisition | A remote Node cannot inject JavaScript into Electron. Client artifacts are independently acquired, digest-checked, signed, compatible, and activated locally. |
| Bespoke UI default denial | Unique sandboxing intent, strict CSP, no ambient Node/Electron/network/storage/native access, typed bridge mediation, trusted permission chrome, and declarative fallback are appropriate controls. |
| Credential mediation | Write-only secret references, destination- and purpose-bound broker injection, redirect stripping, DNS rebinding checks, response redaction, and usage audit substantially reduce ordinary plugin exposure. |
| Supply chain | Separate trusted/community roots, publisher identity, immutable content digests, signatures, transparency/provenance evidence, SBOMs, locks, anti-rollback, revocation, archive safety, no install scripts, hermetic source builds, staged activation, and quarantine form a coherent model. |
| Event authority | Commands request changes and events describe committed facts. Events are explicitly not authority. Transactional outbox, per-Node sequence, at-least-once delivery, redaction, replay bounds, and snapshot recovery are sound design choices. |
| Repository-content posture | Repository config, terminal output, logs, Markdown, patches, and provider content are treated as hostile. Exact-snapshot trust and invalidation are appropriate where they are actually applied. |
| Backup staging | AEAD manifests/chunks, size and path validation, inactive staging, current-policy revalidation, pending grants, and crash-safe activation are strong once identity and credential-policy contradictions are removed. |
| Incident operations | Pairing/revocation, grant, secret-use, plugin lifecycle, native execution, update, quarantine, recovery, abuse throttling, and signed audit-export responsibilities are explicitly assigned. |

## 5. Threat and conformance coverage gaps

These are required additions to the conformance catalog, not separate severity findings. Each is
part of the closure criterion for the linked finding.

| Coverage gap | Linked finding | Required conformance addition |
| --- | --- | --- |
| Pairing fields claimed by `SEC-ID-008` are absent from the executable test contract. | SR-001 | Canonical transcript mutation and concurrent-session substitution vectors. |
| Capability grant substitution is not tested across artifact digest, publisher, generation, operation, purpose, and expiry. | SR-002 | Closed-schema rejection and persisted-grant restart tests for every binding. |
| Delegation tests do not prove ordered three-hop attenuation and attribution. | SR-003 | Core-minted handle forgery, replay, broader-callee, revocation, and chain-audit cases. |
| No supported reverse-proxy mode has an authentication test. | SR-004 | TLS pass-through acceptance and TLS-termination rejection, or complete trusted-proxy protocol tests. |
| No bundled-local bootstrap security test exists. | SR-005 | Process/channel substitution, concurrency, replay, erasure, and crash matrix. |
| Certificate renewal tests do not establish atomic device private-key replacement. | SR-006 | Old/new key proof, generation, concurrent rotation, crash, and sole-owner recovery cases. |
| Backup tests do not exercise per-secret DEK export and new-Node rewrapping. | SR-008 | No-plaintext, no-old-master-key, associated-data swap, cancellation, and disabled-first-use tests. |
| Audit tests have no canonical record/checkpoint fixtures backed by the documented database. | SR-009 | Independent verifier fixtures across tamper, retention, rotation, export, restore, and restart. |
| Raw-secret and direct-native-network permissions are tested separately. | SR-010 | A mandatory toxic-combination denial and exfiltration suite. |
| Repository trust tests do not cover Docker Compose include/build/env/mount semantics. | SR-011 | Materialized-plan snapshot and host-authority escalation corpus. |
| Bespoke UI tests do not pin one origin derivation and one negotiated limit set. | SR-012 | Cross-Node/version/view origin matrix plus exact lifetime, rate, and byte boundaries. |
| Snapshot recovery has no hostile closed-envelope validation corpus. | SR-013 | Schema/digest, bounds, mixed-Node, stale-sequence, partial-failure, and atomic-crash cases. |
| Relay tests lack standardized replay-window and trust-epoch vectors. | SR-014 | Versioned interoperability vectors before relay delivery is authorized. |
| Preview tests omit client-loopback cross-site access, service-worker survival, and cross-view origin reuse. | SR-015 | Preview-specific wire, origin, selected-client, teardown, and local-attacker suite. |

The threat matrix must also be mechanically checked after closure so that every mitigation and test
reference resolves to the requirement that actually controls the attack. For example,
`THREAT-ID-017` cites `SEC-AUTH-011` through `SEC-AUTH-014`, while the principal descriptor-relative
path controls are `SEC-AUTH-009` and `SEC-AUTH-010`.

## 6. Re-verification gate

Security approval requires all Critical and High findings to be corrected and independently
retested. The Medium finding must be corrected or recorded in the decision ledger with owner,
rationale, delivery boundary, expiry condition, and a test that prevents the deferred relay from
being enabled prematurely.

Re-verification must check the authored prose and the OpenAPI, AsyncAPI, JSON Schema, WIT, examples,
database definitions, threat mappings, and conformance cases as one contract. A prose-only closure
is insufficient. The closure report must record the changed requirement identifiers, evidence
artifacts, test identifiers, reviewer verdict, and any residual risk for every `SR-*` finding.

## 7. Closure verification — 2026-07-31

This section records the independent re-review after the first remediation pass.
`REVIEW-SEC-001` through `REVIEW-SEC-015` below correspond to `SR-001` through
`SR-015` above. “Verified Closed” means the specification now contains an
implementable normative control, matching machine shape where applicable, and
a release-blocking conformance case. It does not assert that V2 implementation
code exists or that the conformance test has executed. This section supersedes
the original finding counts for the current review disposition.

### 7.1 Re-review verdict

Security approval remains withheld.

| Result | Count |
| --- | ---: |
| Original findings Verified Closed | 13 |
| Original findings still open — High | 2 |
| New findings — High | 1 |
| Carried-forward traceability defect — Medium | 1 |

The remaining High findings are `REVIEW-SEC-009`, `REVIEW-SEC-010`, and new
finding `REVIEW-SEC-016`. The threat-mapping defect in `REVIEW-SEC-017` also
requires correction or an explicit accepted-risk decision under the review
severity rules.

### 7.2 Original finding closure matrix

#### REVIEW-SEC-001 / SR-001 — Verified Closed

The pairing claim now has one canonical, independently testable transcript.

- `CON-PAIR-008` defines the exact RFC 8785 field set, endpoint
  normalization, and CSR digest.
- `CON-PAIR-009` defines the CSR-key Ed25519 proof and
  pairing-secret HMAC over the transcript digest.
- `CON-PAIR-010` and `CON-PAIR-011` define server reconstruction, atomic
  certificate/device/session/audit commit, replay state, and restart behavior.
- `PairingClaim` and `PairingResult` in
  `contracts/openapi/acorn-node-v2.yaml` carry the session, expected Node
  identity, fingerprint, endpoint, protocol, owner confirmation, challenge,
  CSR/digest, nonce, transcript digest, and both proofs.
- `contracts/examples/pairing-claim.json` exercises that machine shape.
- `SEC-ID-008A`, `SEC-TEST-ID-002`, and `SEC-TEST-ID-004` prohibit a private
  weaker transcript and require field substitution, concurrent claim, and
  replay failures before authority commits.

The original relay/substitution attack can now be rejected using only the
published contract.

#### REVIEW-SEC-002 / SR-002 — Verified Closed

Capability advertisement, permission request, and persisted authority are now
separate discriminated machine objects.

- `contracts/schema/capability-v2.schema.json` defines
  `rendererAdvertisement`, `permissionRequest`, and `securityGrant` as distinct
  closed alternatives.
- `securityGrant` binds plugin coordinate, publisher key, installation and
  generation, artifact digest, capability/revision/operations, resource
  selector, typed constraints, permission-request digest, grant generation and
  version, decision metadata, time policy, and revocation.
- Its `securityConstraints` union contains closed family-specific schemas
  rather than an arbitrary constraint bag.
- `contracts/schema/plugin-lock-v2.schema.json` references only
  `#/$defs/securityGrant` for persisted lock grants.
- `DATA-DB-008` and the expanded `capability_grants` row in
  `data/node-core-database.md` require complete schema validation on write and
  startup and supersede authority on publisher/artifact/installation-generation
  change.
- `SEC-AUTH-002`, `SEC-AUTH-006A` through `SEC-AUTH-006C`, and
  `SEC-TEST-AUTH-001` define the dispatch-time binding and substitution tests.

The former stale-digest and unknown-constraint grant paths are closed.

#### REVIEW-SEC-003 / SR-003 — Verified Closed

Delegation is now core-minted, ordered, attenuated, and representable across
runtime, storage, event, and audit boundaries.

- `SEC-AUTH-018A` and `SEC-AUTH-018B` define the opaque 256-bit handle,
  authoritative initiating principal, ordered hops, audience, operation,
  resource, purpose, deadline, correlation, exact grant revisions, child
  attenuation, revocation, and cancellation.
- `contracts/wit/acorn-plugin-v2.wit` carries only the opaque
  `delegation-handle` in invocation context and exposes a redacted ordered
  `delegation-descriptor`; plugins cannot supply a caller or grant list.
- `delegations` in `data/node-core-database.md` stores only the handle hash plus
  authoritative chain and attenuation fields. `DATA-DB-009` forbids
  plugin-created roots, hops, or grant sets.
- `contracts/schema/event-envelope-v2.schema.json` can attribute initiating
  principal, ordered installation generations, and grant versions.
- `contracts/schema/audit-envelope-v2.schema.json` carries installation and
  grant identity per delegation hop.
- `SEC-TEST-AUTH-003` covers direct, two-hop, and three-hop calls, broader
  callees, forgery, replay, and mid-call revocation.

The callee no longer needs to substitute its own authority or trust a
plugin-asserted caller.

#### REVIEW-SEC-004 / SR-004 — Verified Closed

V2 now has one direct-transport proxy policy: layer-four pass-through only.

- `architecture/local-and-remote-topologies.md` rejects TLS termination,
  forwarded certificate identity, proxy identity, trusted headers, and
  application gateways.
- `ARCH-TOPO-010` requires the externally observed certificate and TLS exporter
  to terminate at the Node and Client.
- `SEC-TRANS-004A` repeats the rule at the transport security boundary.
- `SEC-TEST-TRANS-006A` distinguishes valid pass-through from termination,
  forwarded identity, replay, and a revoked forwarded client.

The Node always authenticates the actual paired device rather than a proxy
principal.

#### REVIEW-SEC-005 / SR-005 — Verified Closed

Bundled-local bootstrap now has an OS mechanism, transcript, journal, commit
point, and crash matrix.

- `CON-BOOT-001` defines anonymous inherited socket/pipe transports and forbids
  discoverable or ambient secret channels.
- `CON-BOOT-002` binds signed release identity, artifact digest, and OS
  parent/child peer checks before data-root initialization.
- `CON-BOOT-003` defines the protected journals, exact canonical transcript,
  dual identity-key signatures, and bootstrap-secret HMAC.
- `CON-BOOT-004` and `CON-BOOT-005` define the complete persisted state
  machine, atomic owner/certificate/audit commit, acknowledgement, erasure,
  idempotent retry, concurrency, and every crash side.
- `CON-BOOT-006` gives development mode an explicit weaker-but-visible trust
  ceremony while packaged mode fails closed.
- `local_bootstrap_sessions` in `data/node-core-database.md`,
  `UX-FIRST-004A`, and `SEC-TEST-ID-002A` make the state durable, visible, and
  testable.

The bootstrap can result only in the same owner credential or a clean,
explicitly recoverable unpaired root.

#### REVIEW-SEC-006 / SR-006 — Verified Closed

Device private-key rotation and sole-owner recovery now have complete security
state machines and machine request/result shapes.

- `CON-ROTATE-001` through `CON-ROTATE-003` define dual-key proof, credential
  generation, commit-only pending authority, atomic serial switch, crash
  reconciliation, and replay/concurrency failure.
- `CON-RECOVER-001` through `CON-RECOVER-003` define the encrypted,
  fingerprint/epoch/expiry-bound recovery package, proof transcript, complete
  prior-device revocation, rate limits, local administration, and post-use
  replacement.
- OpenAPI defines prepare and commit rotation routes plus sole-owner recovery,
  with closed `DeviceRotation*` and `SoleOwnerRecovery*` schemas.
- `device_credential_rotations` and `recovery_authorities` in
  `data/node-core-database.md` persist the required journals and generations.
- `SEC-ID-017`, `SEC-ID-018`, `SEC-TEST-ID-008`, and `SEC-TEST-ID-009` cover
  old/new-key transition, every crash point, package replay, Node/epoch
  substitution, and recovery after all clients are revoked.

The original security mechanism is closed. `REVIEW-SEC-016` separately records
that these new OpenAPI operations have not been integrated into the canonical
wire-operation inventory and common response rules.

#### REVIEW-SEC-007 / SR-007 — Verified Closed

Restore now has exactly one trust-domain policy.

- `SEC-DATA-023`, `SEC-DATA-031`, and `SEC-DATA-033` exclude identity keys and
  device authority, create a new root and Node identity, and require re-pairing.
- `data/backup-export-restore-and-retention.md` now states that **Create new
  Node** is the only restore mode and `DATA-BACKUP-005A` makes any live
  identity-preserving restore a fatal archive-policy violation.
- The same document defines signed, application-encrypted old-to-new resource
  URI mapping without treating the old ID as authority.
- `data/event-outbox-replay-and-compaction.md` starts a new sequence domain.
- `SEC-TEST-DATA-005` requires a new root/identity and prevents restoration of
  old grants, certificates, and revocations as current authority.

No normative identity-preserving restore mode remains.

#### REVIEW-SEC-008 / SR-008 — Verified Closed

Credential portability now defines key-service-only export rewrapping and
fresh disabled restore records.

- `SEC-DATA-024A` defines the closed authenticated credential envelope and its
  record, purpose, destination, plugin, source-key, and manifest bindings.
- `SEC-DATA-024B` rewraps the source DEK under an HKDF-derived backup context
  without releasing NMK, wrapping key, DEK, or plaintext.
- `SEC-DATA-024C` through `SEC-DATA-024F` define new-Node re-encryption, fresh
  IDs and opaque references, disabled-first-use state, OS-presence confirmation,
  streaming/memory handling, cancellation cleanup, crash idempotency, and
  archive replay behavior.
- `SEC-KEY-015A` makes the key-service boundary authoritative.
- `data/backup-export-restore-and-retention.md` adopts the same mechanism.
- `SEC-TEST-DATA-018` covers key/passphrase failure, record and purpose swaps,
  manifest modification, duplicate archive, crash/cancel, absence of old
  master keys/plaintext files, and pre-confirmation broker denial.

The archive no longer requires exporting the old Node master key or creating a
plaintext translation path.

#### REVIEW-SEC-009 / SR-009 — Still open — High

The remediation creates a strong audit algorithm and most storage structures,
but the machine record and durable retained-range representation still cannot
carry the complete normative audit data.

**Verified progress**

- `SEC-AUD-013A` through `SEC-AUD-013E` define canonical HMAC inputs, audit key
  epochs, signed checkpoints, checkpoint-linked range markers, one retention
  rule, boot monotonic behavior, and independent verification.
- `contracts/schema/audit-envelope-v2.schema.json` defines closed record,
  checkpoint, and retained-range variants.
- `audit_key_epochs`, `audit_records`, `audit_checkpoints`, and
  `audit_retained_ranges` now exist in `data/node-core-database.md`.
- The 90-day/512-MiB rule agrees with
  `data/backup-export-restore-and-retention.md`.
- `SEC-TEST-AUD-005A` defines an independent hostile-fixture verifier.

**Remaining defect**

- `SEC-AUD-002` requires policy **and grant version** on every record.
  `audit_records` has `grant_versions_json`, but the closed audit
  `record` schema has no `grantVersions` property and rejects it through
  `additionalProperties: false`. A schema-valid canonical record therefore
  cannot carry the grant versions the database and security requirement demand.
- The closed `retainedRange` schema requires `nodeId`, `signingKeyId`, and
  `signature`. The `audit_retained_ranges` table has none of those columns and
  has no canonical-record column. It cannot durably reproduce the signed marker
  required by `SEC-AUD-013C` and `SEC-TEST-AUD-005A`.
- `audit_records` exposes singular `target_uri` and `action`, while the schema
  requires `targets[]` and `eventType`. `canonical_record` could preserve the
  latter, but no normative mapping says which columns are indexes versus the
  canonical authority.

**Required closure**

Add a closed `grantVersions` array to the audit record schema, keyed by grant
ID and version and required even when empty. Make the retained-range table
persist its Node ID, signing key ID, signature, and canonical marker bytes.
Define that `canonical_record` is authoritative and map `targets[]`/`eventType`
to any denormalized indexes, or change the columns to match the schema. Add
record, checkpoint, and retained-range examples that the independent verifier
uses without a private field projection.

#### REVIEW-SEC-010 / SR-010 — Still open — High

The primary security policy now prohibits plugin raw-secret access, but another
normative plugin contract still grants exactly the exception the remediation
intends to remove.

**Verified progress**

- `SEC-AUTH-030` prohibits `core.secret.raw` in every V2 plugin runtime and
  permits only a release-owned provider-specific helper that never returns
  bytes.
- `SEC-AUTH-031`, `SEC-KEY-029`, and `SEC-KEY-030` deny direct sockets, child
  processes, writable unbrokered files, inherited handles, diagnostics,
  debugger access, and core dumps for the helper lifetime.
- `SEC-TEST-KEY-009` now tests every plugin tier and the toxic combinations.

**Remaining contradiction**

- `PLUG-PERM-010` in `plugins/permissions-and-capabilities.md` says Verified
  native plugins may receive `core.secret.raw` after broker-impossibility
  documentation and per-secret approval.
- `PLUG-PERM-009` still describes raw-secret access as a separately grantable
  high-risk operation.
- Informative community guidance in
  `examples/community-plugin-archetypes.md` `EX-060` still instructs authors
  that a runtime tier and explicit permission can declare an unavoidable
  raw-secret exception.

An implementer following the normative plugin permission contract can grant
raw credentials to the same Verified-native runtime that may receive direct
egress under `SEC-PLUG-027`, recreating the original exfiltration path despite
the security conformance text.

**Required closure**

Make `PLUG-PERM-009`, `PLUG-PERM-010`, the authoring example, marketplace
permission-expansion wording, manifest/schema generation, and UX agree with
`SEC-AUTH-030`: no V2 plugin may request or receive `core.secret.raw`.
Represent the fixed-purpose credential helper as a core-only internal
operation that cannot appear in a plugin manifest, grant, or lock. Add a
schema-negative fixture proving every plugin permission request containing
`raw` is rejected before installation review.

#### REVIEW-SEC-011 / SR-011 — Verified Closed

Docker execution now binds the complete repository-controlled execution plan to
snapshot trust and separately grants host-risk effects.

- `SEC-AUTH-026A` classifies Compose as repository-authored executable input.
- `CUR-DOCKER-011A` resolves the complete descriptor-relative Compose/include/
  environment/Dockerfile/build-context graph with traversal, symlink, depth,
  and parser protections.
- `CUR-DOCKER-011B` defines a no-daemon canonical materialized plan and hashes
  every input, path, parser/Docker version, and repository identity.
- `CUR-DOCKER-010A` requires the current plan digest immediately before every
  build/up/start/restart/exec/stop/down invocation.
- `CUR-DOCKER-017A` requires separate closed high-risk grants for privileged
  mode, host mounts/socket/devices/namespaces/capabilities, external secrets,
  and writable root mounts.
- `SEC-TEST-AUTH-011A` mutates every graph and high-risk host effect between
  review and execution.

Exact executable and argv allowlisting is no longer mistaken for approval of
repository-controlled Compose semantics.

#### REVIEW-SEC-012 / SR-012 — Verified Closed

Bespoke origins, session lifetime, and bridge limits now agree.

- `SEC-UI-002` derives a 52-character origin ID from Client key material and
  Node, installation, generation, artifact, contribution, session, and fresh
  per-view nonce; the ephemeral partition is destroyed on closure.
- `SEC-UI-010`, `UI-BESPOKE-BRIDGE-003`, and `UI-VIEW-002` all use 15 minutes
  idle and eight hours absolute.
- `SEC-UI-020`, `SEC-UI-021`, `UI-BESPOKE-BRIDGE-004`, and
  `UI-BESPOKE-BRIDGE-007` all use 256 KiB, 60 messages/second, 2 MiB/second,
  16 in-flight requests, and 32 MiB live data.
- `SEC-UI-021A` establishes lower-limit-wins negotiation.
- `contracts/schema/view-session-v2.schema.json` encodes those ceilings.
- `SEC-TEST-UI-009` tests cross-Node/generation/view separation and both sides
  of every lifetime and resource bound.

No origin, generation, or limit choice remains for an implementer.

#### REVIEW-SEC-013 / SR-013 — Verified Closed

Snapshot recovery now has a closed, grouped, bounded machine envelope.

- OpenAPI `/v2/snapshots` returns
  `contracts/schema/snapshot-v2.schema.json` rather than arbitrary objects.
- The schema carries Node/snapshot/authorization revisions, expiry, digest,
  atomic plugin/core groups, owner and source sequence, explicit degradation/
  omission/error, resource URI/type/schema/digest/revision/sensitivity,
  authorization projection, and bounded inline/object-reference content.
- `CON-EVT-006A` defines total, group, resource, inline, nesting, and collection
  limits and requires digest recomputation.
- `CON-EVT-006B` rejects unknown schema/digest, mixed Node, duplicate URI,
  wrong owner/generation, stale authorization, and invalid source sequence.
- `CON-EVT-006C` defines per-owner atomic replacement and event-cursor advance.
- `SEC-TEST-DATA-019` covers hostile payloads, partial plugin failure, and
  crashes at group-install boundaries.

The mandatory replay-gap path no longer accepts a schema-ambiguous resource
bag.

#### REVIEW-SEC-014 / SR-014 — Verified Closed

The future relay boundary is now deterministic while remaining impossible to
enable in V2.

- `contracts/schema/relay-envelope-v2.schema.json` closes the routing,
  session, trust-context, direction, key-epoch, sequence, and ciphertext
  envelope.
- `SEC-TRANS-026` binds the Noise transcript to both Acorn identities, identity
  and credential generations, revocation epochs, routing-token generation and
  expiry, service identity, nonces, and transcript signatures.
- `SEC-TRANS-027` fixes a 4,096-record replay bitmap, slide/jump behavior,
  ordered delivery, retransmission, and close deadlines.
- `SEC-TRANS-028` fixes sequence exhaustion, rekey cadence and state, failure,
  and full-handshake resumption.
- `SEC-TRANS-029` fixes routing-token lifetime/rotation/revocation, queue bounds,
  and periodic trust-generation checks.
- `SEC-TRANS-030` and `DEC-026` prohibit a V2 relay toggle and require published
  interoperability vectors plus `SEC-TEST-TRANS-011` through
  `SEC-TEST-TRANS-012A` before a later release can enable it.

The absence of relay vectors in V2 is now an enforced future-delivery gate,
not an underspecified enabled transport.

#### REVIEW-SEC-015 / SR-015 — Verified Closed

Remote Preview now has a dedicated authenticated wire protocol and a
per-tunnel Client origin lifecycle.

- AsyncAPI defines closed `preview.tunnel.open|opened`,
  `preview.http.request|response|cancel`, and
  `preview.tunnel.close|closed` frame families, including tunnel/view/task/
  target/origin generation, request sequence, body digest/stream, limits, and
  terminal acknowledgement.
- `CON-PREVIEW-005` defines the complete state machine and mixed/late-generation
  rejection.
- `CON-PREVIEW-006` derives a high-entropy per-tunnel HTTPS origin and
  certificate, binds the listener token to Host/Origin and the isolated
  partition, and prevents another local origin from emitting a Node frame.
- `CON-PREVIEW-007` and `CON-PREVIEW-008` close the method/header policy,
  strip credentials, bind body counts/digests, and reauthorize redirect and DNS
  results.
- `CON-PREVIEW-009` requires terminal teardown of listener, token, key,
  certificate, cookie, cache, service worker, partition, port, and origin
  authority.
- `CUR-PREVIEW-098A`, `UI-MEDIA-023`, `UI-MEDIA-024`,
  `SEC-TEST-UI-009A`, and `SEC-TEST-UI-014` apply and test the protocol at the
  plugin, renderer, and malicious-local-page boundaries.

The substantive tunnel and origin attack surface is closed. The stale
`preview.tunnel.open.v1` identifier in `CON-PREVIEW-001` is included in new
integration finding `REVIEW-SEC-016`.

### 7.3 New and carried-forward findings

#### REVIEW-SEC-016 — High — Security-sensitive wire operations are not integrated into the canonical contract inventory

**Evidence**

- OpenAPI now defines `prepareDeviceCredentialRotation`,
  `commitDeviceCredentialRotation`, and `claimSoleOwnerRecovery`.
- The normative wire inventory in `contracts/README.md` omits all three while
  stating that its listed names are the stable OpenAPI operation IDs.
- The same README validation gate requires every operation ID to occur in
  prose. Repository-wide search finds those three identifiers only in
  OpenAPI.
- `CON-GEN-007` requires every successful response to include
  `X-Acorn-Request-Id`. The new rotation prepare, rotation commit, and recovery
  success responses omit that header in OpenAPI.
- `CON-PREVIEW-001` names `preview.tunnel.open.v1`, while `CON-PREVIEW-005` and
  AsyncAPI define the wire discriminator as `preview.tunnel.open`. The contract
  does not say the former is a distinct domain capability rather than the wire
  frame.

**Failure scenario**

One generated SDK or dispatcher follows OpenAPI while another follows the
canonical inventory or prose identifier. Rotation/recovery becomes unavailable
or is routed outside the common request-correlation and operation-policy
machinery. A Preview implementation can authorize one identifier and dispatch
the other. These are identity-recovery and remote-browser boundaries; private
aliases or divergent generated clients are not safe compatibility behavior.

**Required closure**

Add the three identity operations to the canonical inventory and reference
their exact security/state requirements. Add `X-Acorn-Request-Id` to every
successful response and make their common error/request-correlation behavior
explicit. Rename `preview.tunnel.open.v1` to the AsyncAPI discriminator or
define and map it explicitly as a separate non-wire capability. Run the stated
operation/error/event ID agreement gate over the full corpus.

#### REVIEW-SEC-017 — Medium — The path-escape threat still maps to the wrong mitigation requirements

**Evidence**

- `THREAT-ID-017` continues to cite `SEC-AUTH-011` through `SEC-AUTH-014`.
  Those requirements principally cover process, terminal, network, and payload
  limits.
- The descriptor-relative path and symlink/junction protections are
  `SEC-AUTH-009` and `SEC-AUTH-010`.
- `SEC-TEST-AUTH-005` does exercise the right path attacks, so behavior coverage
  exists, but the threat-to-mitigation trace is inaccurate.

**Required closure**

Map `THREAT-ID-017` to `SEC-AUTH-009`, `SEC-AUTH-010`, the relevant archive
controls, and its existing tests. Re-run mechanical threat/mitigation/test
reference validation.

### 7.4 Re-verification checks performed

- Read the current pairing, bootstrap, rotation/recovery, transport/relay,
  authorization/delegation, credential/backup, audit, plugin-runtime,
  Docker, bespoke UI, snapshot, Preview, threat, data, OpenAPI, AsyncAPI, JSON
  Schema, WIT, examples, and conformance documents.
- Parsed every contract and example JSON file with `jq`.
- Parsed the OpenAPI, AsyncAPI, and YAML example files with Ruby's safe YAML
  parser.
- Compared all OpenAPI `operationId` values with the normative wire inventory
  and searched the corpus for each new identifier.
- Scanned the repaired policies for the original contradictory values and
  authority exceptions.
- `git diff --check -- docs/vNext` reports no whitespace errors.

Security approval may be reconsidered after `REVIEW-SEC-009`,
`REVIEW-SEC-010`, and `REVIEW-SEC-016` are corrected and independently
verified, and `REVIEW-SEC-017` is corrected or explicitly accepted under the
Medium-finding policy.

## 8. Second closure verification — 2026-07-31

Scope was limited to `REVIEW-SEC-009`, `REVIEW-SEC-010`,
`REVIEW-SEC-016`, and `REVIEW-SEC-017`. This section supersedes §7 for those
four findings. No normative specification was modified during verification.

### 8.1 Verdict

| Finding | Result | Evidence |
| --- | --- | --- |
| `REVIEW-SEC-009` | **Verified Closed** | Audit record schema, signed-marker schema, database canonical mapping, examples, and verifier requirements now agree. |
| `REVIEW-SEC-010` | **Still open — High** | Machine contracts deny plugin raw-secret authority, but `SEC-AUTH-005` still describes raw secrets as an individually shown high-risk permission. |
| `REVIEW-SEC-016` | **Verified Closed** | OpenAPI, operation inventory, common headers/semantics, and Preview discriminator now agree. |
| `REVIEW-SEC-017` | **Verified Closed** | `THREAT-ID-017` now maps to the descriptor-relative path controls and existing tests. |

No new Critical, High, or Medium finding was identified. One High finding,
`REVIEW-SEC-010`, remains.

### 8.2 REVIEW-SEC-009 — Verified Closed

- `contracts/schema/audit-envelope-v2.schema.json` now requires a closed
  `grantVersions[]` field on every audit record.
- `audit_records` in `data/node-core-database.md` now uses `event_type`,
  `targets_json`, `grant_versions_json`, and authoritative
  `canonical_record`.
- `DATA-DB-010` defines exact `eventType`, `targets[]`, and
  `grantVersions[]` projection mapping and fails startup/insert on divergence.
- `audit_retained_ranges` now persists `node_id`, `signing_key_id`,
  `signature`, and authoritative `canonical_marker`.
- `DATA-DB-011` requires every retained-range projection to reproduce the
  signed marker and enters `recovery-required` on missing or mismatched bytes.
- `audit-record.json`, `audit-checkpoint.json`, and
  `audit-retained-range.json` contain the complete closed machine variants.
- `SEC-AUD-013F` makes those artifacts the independent verifier corpus and
  prohibits a private projection that drops grant, target, Node, signing-key,
  or signature data.

The original inability to reconstruct and independently verify complete audit
records and retained-range markers is removed.

### 8.3 REVIEW-SEC-010 — Still open — High

The enforcement path is now correctly fail-closed:

- `pluginCapabilityId` in
  `contracts/schema/capability-v2.schema.json` excludes
  `^core\.secret\.raw/`.
- Both plugin permission requests and persisted security grants use that
  restricted identifier.
- `capability-raw-secret-rejected.invalid.json` is a dedicated negative
  fixture, and `PLUG-PERM-010A` requires rejection specifically because its
  capability ID is forbidden.
- `PLUG-PERM-009`, `PLUG-PERM-010`, `EX-060`, and marketplace wording now say
  plugins receive only brokered use and cannot request raw-secret authority.
- `SEC-AUTH-030`, `SEC-AUTH-031`, `SEC-KEY-029`, `SEC-KEY-030`, and
  `SEC-TEST-KEY-009` agree on the core-only helper and toxic-combination
  denial.

One normative contradiction remains in
`security/authorization-and-capabilities.md`:

- `SEC-AUTH-005` lists “raw secrets” among high-risk **permissions** that
  “MUST be individually shown.”
- `SEC-AUTH-030` in the same document says `core.secret.raw` is prohibited in
  V2 and cannot be a plugin permission.

This does not bypass the repaired schema, but it still instructs an
implementation or generated permission UX to represent a forbidden authority
as grantable. The original closure criterion required every normative
permission statement to agree.

**Required closure:** remove raw secrets from the grantable-permission list in
`SEC-AUTH-005`, or state there explicitly that raw-secret requests are rejected
and only Acorn-owned fixed-purpose helper use receives a trusted core ceremony.
After that wording change, repeat the corpus scan and negative-fixture
validation.

### 8.4 REVIEW-SEC-016 — Verified Closed

- `contracts/README.md` now inventories
  `prepareDeviceCredentialRotation`, `commitDeviceCredentialRotation`, and
  `claimSoleOwnerRecovery` with their exact routes and `CON-ROTATE`/
  `CON-RECOVER` semantics.
- `CON-GEN-011` defines current-device mTLS and exact-device binding for
  rotation, fingerprint/proof/epoch validation for recovery, the common error
  envelope, correlation header, and state-machine ownership.
- Each corresponding OpenAPI success response now includes
  `X-Acorn-Request-Id`.
- The three operation IDs occur in both OpenAPI and normative prose.
- `CON-PREVIEW-001`, `CON-PREVIEW-005`, and AsyncAPI now use the same
  `preview.tunnel.open` discriminator; the stale `.v1` alias is absent outside
  historical review text.

The security operations no longer sit outside the canonical SDK/dispatch
inventory or common response contract.

### 8.5 REVIEW-SEC-017 — Verified Closed

`THREAT-ID-017` now maps path traversal and symlink race to
`SEC-AUTH-009` and `SEC-AUTH-010`, archive handling to `SEC-SUPPLY-027`, and
the existing `SEC-TEST-AUTH-005`, `SEC-TEST-AUTH-006`, and
`SEC-TEST-SUPPLY-008` cases. The mitigation and test references now describe
the stated threat.

### 8.6 Verification checks

- Parsed all contract/example JSON with `jq`.
- Parsed current OpenAPI and AsyncAPI YAML with Ruby safe YAML loading.
- Compared the three security `operationId` values and Preview discriminator
  across prose and machine contracts.
- Inspected the raw-secret negative fixture against the
  `pluginCapabilityId` references used by permission requests and grants.
- Scanned all normative and informative vNext files for remaining raw-secret
  authority wording.
- Compared the audit schema variants, database columns, canonical mapping,
  examples, and independent-verifier requirements field by field.
- `git diff --check -- docs/vNext/reviews/security-red-team-review.md` passes.

Security approval remains withheld solely for `REVIEW-SEC-010`.

## 9. Final security disposition — 2026-07-31

Scope was limited to final closure of `REVIEW-SEC-010`. This section
supersedes §8 for the current security disposition. No normative specification
was modified during verification.

### REVIEW-SEC-010 — Verified Closed

- `SEC-AUTH-005` no longer lists raw secrets among grantable high-risk
  permissions. It explicitly requires a plugin raw-secret request to be
  rejected before permission review under `SEC-AUTH-030`, so no approval UI may
  present it.
- `SEC-AUTH-030`, `SEC-AUTH-031`, `SEC-KEY-029`, and `SEC-KEY-030` consistently
  allow only an Acorn-owned fixed-purpose helper that never returns credential
  bytes and cannot combine secret-bearing execution with direct egress or
  process/file/diagnostic escape paths.
- `pluginCapabilityId` in
  `contracts/schema/capability-v2.schema.json` excludes
  `core.secret.raw/*`; both permission requests and persisted security grants
  use that restricted identifier.
- `PLUG-PERM-009`, `PLUG-PERM-010`, `PLUG-PERM-010A`, marketplace wording, and
  `EX-060` agree that plugin trust/runtime tier creates no raw-secret
  exception.
- `capability-raw-secret-rejected.invalid.json` is the required
  schema-negative fixture, and `SEC-TEST-KEY-009` tests denial across every
  plugin tier/runtime plus the fixed-helper toxic combinations.
- A corpus scan found no remaining normative text that presents plugin
  raw-secret authority as approvable.

All Critical, High, and Medium findings from this security review are now
Verified Closed. No new finding was identified.

**Final verdict: security specification approval is granted.** This approval
means the vNext security architecture and documentation contracts passed this
independent review. V2 implementation and release remain conditional on
successful execution of the mandated production-boundary security conformance
suite on every supported platform/runtime.
