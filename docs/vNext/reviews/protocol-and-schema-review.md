# Protocol and schema closure review

**Status:** Closure review completed; no open specification finding<br>
**Review date:** 2026-07-31<br>
**Reviewer:** Primary architectural closure pass<br>
**Requirement prefix:** `REVIEW-PROTO`

## Verdict

The V2 HTTPS, WebSocket, JSON Schema, manifest, plugin-operation and WIT contracts now agree at the
architecture boundary. The review found and resolved nine inconsistencies. JSON/YAML parsing,
strict JSON Schema compilation/example validation, local/external reference resolution and Herdr
cross-object/digest validation pass.

This report approves the documentation contract. Production implementation remains required to
run a pinned WIT parser/bindgen and OpenAPI/AsyncAPI linter in CI; that is verification of the
frozen contract, not permission to redesign it.

## Method

The review compared:

- discovery/pairing, identity, transport and OpenAPI security declarations;
- query/command prose, OpenAPI status/result unions, idempotency and transport replay rules;
- event prose, AsyncAPI subscribe/ack/replay frames and the event envelope schema;
- Node descriptor plugin state against the exhaustive lifecycle aggregate;
- plugin manifest runtime/artifact declarations against current-plugin classifications;
- core/current-plugin operation inventories against V1 dispositions;
- the Herdr fixture set against operation, manifest, contribution, capability, worker and stream
  schemas; and
- WIT imports/exports against WASI runtime, worker, stream, storage, broker and delegation prose.

Checks executed against the closure corpus:

1. all 46 JSON documentation artifacts parsed;
2. all four YAML documents parsed with aliases enabled;
3. every local/external OpenAPI and AsyncAPI `$ref` resolved;
4. all JSON Schemas compiled under strict Ajv 2020-12 with formats;
5. 15 positive JSON examples and 20 manifest/28 contribution fixtures validated;
6. four negative JSON examples failed for their intended condition;
7. all 100 Herdr rows, 449 operation descriptors, 898 operation schemas and their canonical
   digests/cross-references validated; and
8. Markdown link validation ran across the full corpus.

## Findings and resolutions

### `REVIEW-PROTO-001` — Node fingerprint serialization

**Finding:** Pairing prose could be read as hashing the raw 32-byte Ed25519 key while security
prose required SubjectPublicKeyInfo.

**Resolution:** `CON-PAIR` and `SEC-ID` now require SHA-256 of the exact 44-byte RFC 8410 Ed25519
SubjectPublicKeyInfo DER value, prohibit alternate serializations and carry that DER value in the
pairing transcript. OpenAPI and the positive claim example use the same field and length.

**Result:** Closed.

### `REVIEW-PROTO-002` — Pre-credential TLS authentication

**Finding:** Global mTLS language contradicted unauthenticated-at-the-certificate-layer pairing and
sole-owner recovery claims.

**Resolution:** The two exact claim routes are the only exceptions. They use TLS 1.3 server
authentication, verified Node-identity SPKI fingerprint/certificate binding and transcript
key/HMAC proof. Every other route and every post-issuance connection requires mTLS.

**Result:** Closed.

### `REVIEW-PROTO-003` — Future command time

**Finding:** The command contract accepted a UUID timestamp five minutes in the future while the
transport contract rejected beyond 120 seconds.

**Resolution:** Both now use 120 seconds and the same `command_id_out_of_range` behavior.

**Result:** Closed.

### `REVIEW-PROTO-004` — Durable terminal failures

**Finding:** OpenAPI permitted `failed` and `cancelled` statuses without a discriminated payload.

**Resolution:** `CommandTerminalResult` is now a discriminated union of committed, cancelled and
failed. Cancellation has stable code/time/detail. Failure carries a bounded command-failure object
with code, retryability, safe detail, resource/revision, retry delay and field errors. Accepted
results include resource revision. Prose fixes HTTP and replay semantics.

**Result:** Closed.

### `REVIEW-PROTO-005` — Effective subscription filters

**Finding:** Event prose promised the authorized effective filters while AsyncAPI omitted them.

**Resolution:** `subscribed` requires bounded unique `eventTypes` and `resourcePrefixes` alongside
the accepted cursor/range.

**Result:** Closed.

### `REVIEW-PROTO-006` — Product-event identifiers

**Finding:** Three architecture documents used unversioned event literals rejected by the event
schema.

**Resolution:** They now use `acorn.core.node.ready.v2`,
`acorn.core.node.resource-pressure.v2` and `acorn.core.capabilities.changed.v2`.

**Result:** Closed.

### `REVIEW-PROTO-007` — Plugin lifecycle projection

**Finding:** The Node descriptor's six-state summary lost partial installation and recovery state.

**Resolution:** The descriptor exposes every non-absent installation aggregate state using an
explicit underscore-to-hyphen mapping. The full-detail query exposes installation, permission,
setup, runtime, update, retention, failure and recovery substates. Health remains separate.

**Result:** Closed.

### `REVIEW-PROTO-008` — Current fixture runtime inheritance

**Finding:** Onboarding and three executable-profile fixtures inherited a WASI Node artifact even
though their packages are declarative-only.

**Resolution:** Those fixtures override artifacts to the declarative view artifact only. External
execution remains delegated to Terminal/Agents/Workflows.

**Result:** Closed.

### `REVIEW-PROTO-009` — Product operation closure

**Finding:** V1 disposition tables pointed to generic brokers without a closed core operation
inventory, and current-plugin release payload fields were distributed across prose.

**Resolution:** The core operation registry fixes core IDs, exact fields, result records,
reliability, authorization and errors. The current-plugin operation and payload catalogs jointly
fix every default-profile operation and release-schema compilation rule. Primary-contribution YAML
fixtures are explicitly distinguished from complete signed release manifests.

**Result:** Closed.

## WIT semantic agreement

The `acorn:plugin@2.0.0` world contains no ambient WASI filesystem, socket, environment, process or
clock import. It imports only the Acorn host interface and exports the plugin interface. Every
broker call executes under the active invocation context and delegation handle; stream/object
handles are opaque; workers have explicit scheduled/event/resident entrypoints; storage, HTTP,
events, randomness, time and logging are host-mediated.

`REVIEW-PROTO-WIT-001` The implementation repository MUST pin a WIT parser and component bindgen
version, parse this exact file, generate both host and guest bindings and compare the generated
world hash in CI. A parser or generated-signature failure blocks implementation/release. No manual
syntax repair may alter the world without returning to specification review.

## Final assertion

**`REVIEW-PROTO-FINAL-001`:** No reviewed discrepancy requires an implementer to choose identity,
pre-authentication, command-result, subscription, event-name, lifecycle, runtime-artifact or
operation-payload policy. Machine-readable contracts parse and cross-reference correctly. The
protocol/schema specification is approved for implementation subject to mechanical CI replay.
