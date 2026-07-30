# WASI Component runtime

Status: Normative<br>
Requirement prefix: `PLUG-WASI`

WASI Components are the default executable runtime for Community plugins. The canonical host world
is defined by [`acorn-plugin-v2.wit`](../contracts/wit/acorn-plugin-v2.wit).

## Instance model

- **PLUG-WASI-001:** Each installation runs in a distinct component store with no ambient
  filesystem, network, environment, clock, randomness, process, socket, terminal, database or
  secret authority.
- **PLUG-WASI-002:** The host instantiates one supervised worker per installation generation.
  Concurrent command execution uses bounded logical requests within that worker unless the manifest
  and host policy allow a bounded pool.
- **PLUG-WASI-003:** Imported interfaces MUST be capability-specific handles issued after
  authorization. Handles are unforgeable, installation-bound, scope-bound, expiry-bound and invalid
  after disable, update, revocation or view-session closure.
- **PLUG-WASI-004:** The component exports the lifecycle, query/capability, command, subscribed-event
  delivery and health functions named by the WIT world. Unlisted exports are inaccessible. Storage
  migrations are separately signed artifacts executed by the host migrator, not arbitrary
  component exports.

## Resources

- **PLUG-WASI-005:** Default per-call ceilings are 64 MiB memory, 100 million fuel units, 30
  seconds wall time, 16 concurrent host calls, 1 MiB request, 8 MiB response and 64 MiB streamed
  output. A grant may lower them; increasing them requires owner-visible permission.
- **PLUG-WASI-006:** Host calls are cancellation-aware. Deadline or revocation interrupts execution,
  closes issued handles and returns a stable structured error.
- **PLUG-WASI-007:** Deterministic clocks and randomness are provided only when declared. Wall clock
  has millisecond precision; cryptographic randomness is brokered and audited by purpose.
- **PLUG-WASI-008:** Component logs are structured, rate-limited and redacted. `stdout` and `stderr`
  are treated as diagnostic streams, never protocol payloads.

## Files, network and secrets

- **PLUG-WASI-009:** File access uses resource handles rooted at an authorized workspace,
  repository, task or plugin-data location. Paths are normalized by core; components never receive
  host absolute paths unless an explicit display-only field requires one.
- **PLUG-WASI-010:** Symlink following, traversal outside the root, devices, sockets, executable
  creation and case-fold collisions are denied unless a narrower versioned capability explicitly
  defines safe behavior.
- **PLUG-WASI-011:** Network access uses the HTTP broker, not WASI sockets. The broker enforces
  scheme/host/port/method allowlists, DNS rebinding resistance, private-address policy, redirect
  revalidation, byte/time limits, TLS validation and purpose-bound credential injection.
- **PLUG-WASI-012:** Plaintext secrets MUST NOT enter component memory. A secret reference can be
  supplied only to a compatible broker operation.
- **PLUG-WASI-013:** Process creation and raw terminal attachment are unavailable to Community WASI
  components. A verified capability may expose a fixed tool operation without exposing general
  process spawn.

## State and lifecycle

- **PLUG-WASI-014:** Durable state uses the plugin storage API and the installation's isolated
  SQLite database. During a mutating invocation, host storage operations and event drafts are
  buffered in an invocation-bound transaction and commit only when the exported handler returns
  success. Components cannot receive database handles, execute SQL, load native SQLite extensions
  or attach databases.
- **PLUG-WASI-015:** Update creates a new worker generation. The old generation drains, migrations
  run against a recoverable copy, the new generation passes readiness, then routing switches
  atomically.
- **PLUG-WASI-016:** A trap fails only the current request unless health thresholds cause restart
  or quarantine. The host records trap category without leaking raw sensitive memory or payloads.
- **PLUG-WASI-017:** Subscription handlers MUST acknowledge only after their plugin transaction
  commits. Redelivery is expected and handlers MUST use event identity for idempotency.

## Resident waits, streams and output objects

- **PLUG-WASI-019:** A resident component MUST block only in `worker-wait`. The host returns one
  declared broker input, durable event batch, scheduled timer, drain, cancellation or
  capability-revoked signal. `after-cursor` is opaque and installation-generation-bound; duplicate
  signal IDs are idempotent. Deadline returns `deadline_exceeded`, cancellation returns
  `cancelled`, and revocation returns `capability_revoked`. Busy waiting, ambient sleep, sockets and
  listener creation remain unavailable.
- **PLUG-WASI-020:** `stream-open` accepts only a schema-valid manifest-declared stream profile and
  delegation-bound target. It can open a brokered provider input or plugin-owned output; it cannot
  open an arbitrary URL/socket. The returned opaque handle is bound to invocation, installation
  generation, grant version, stream resource, sensitivity and cancellation token.
- **PLUG-WASI-021:** `stream-read` returns at most 64 KiB and consumes host-issued input credit.
  `stream-write` accepts at most 64 KiB at the exact decimal sequence and returns remaining output
  credit. A component with insufficient credit MUST call `stream-wait-credit`; it cannot buffer
  beyond its worker resource ceiling. Duplicate writes are accepted only when the digest matches.
- **PLUG-WASI-022:** Stream handles close on explicit close, end-of-input, deadline, cancellation,
  disable, update, grant revocation or worker-generation change. Close is idempotent. A stale or
  foreign handle fails before any data is exposed. Stream bytes do not enter product events,
  audits or logs.
- **PLUG-WASI-023:** `output-object-create` requires declared length ceiling, media type,
  classification, purpose and owning resource. Sequential `output-object-append` chunks are at
  most 8 MiB and subject to the 64 MiB default plugin-output ceiling. Commit verifies declared
  length and digest, scans the object and returns an authorized immutable descriptor; abort or
  invocation failure deletes partial bytes.
- **PLUG-WASI-024:** A stream or object descriptor carries no ambient authority. Reading it later
  requires the ordinary device/plugin operation grant. The host attributes every byte to the
  caller's delegated authority; a callee cannot replace that authority with its own broader grant.

## Conformance

- **PLUG-WASI-018:** Conformance tests MUST attempt undeclared filesystem/network/clock/random/secret
  access, handle reuse after revocation, fuel/memory exhaustion, oversized output, path traversal,
  DNS rebinding, event redelivery and migration failure. Every attempt MUST be contained and
  auditable.
- **PLUG-WASI-025:** Conformance additionally MUST exercise worker wait cancellation, duplicate
  signals, input/output credit exhaustion, out-of-order writes, stale-generation handles,
  mid-stream grant revocation, slow-reader backpressure, partial-object cleanup and descriptor
  reuse by a different caller.
