# V2 Node contracts

Status: **Normative**
Requirement prefix: `CON-GEN`

This directory is the transport and extension contract for Acorn V2. The prose defines semantics;
the machine-readable artifacts define wire shape. A difference is a release-blocking defect, not an
implementation choice.

The closed Node-core product operation inventory and payload fields are in
[core-operation-registry.md](core-operation-registry.md). Plugin operations use the shared broker
routes but are declared by immutable manifest descriptors and the current/community plugin
catalogs; there is no private core or plugin endpoint family.

## Contract stack

| Layer | Artifact | Purpose |
| --- | --- | --- |
| HTTPS | [`openapi/acorn-node-v2.yaml`](openapi/acorn-node-v2.yaml) | Pairing, descriptor, handshake, query, command, snapshot and object transfer |
| WebSocket | [`asyncapi/acorn-node-events-v2.yaml`](asyncapi/acorn-node-events-v2.yaml) | One multiplexed authenticated socket for events and streams |
| Data | [`schema/`](schema/) | JSON Schema 2020-12 envelopes, manifests and declarative UI |
| Component ABI | [`wit/acorn-plugin-v2.wit`](wit/acorn-plugin-v2.wit) | WASI Component host/plugin boundary |
| Examples | [`examples/`](examples/) | Complete positive messages and explicitly named negative conformance fixtures |
| Herdr conformance | [`examples/herdr-top-100-fixtures.json`](examples/herdr-top-100-fixtures.json) | 100 materialized plugin-port contracts validated by [`herdr-fixture-set-v2.schema.json`](schema/herdr-fixture-set-v2.schema.json) |

- **CON-GEN-001** Protocol media type MUST be `application/vnd.acorn.v2+json`. UTF-8 is required.
- **CON-GEN-002** JSON objects are closed unless their schema explicitly permits extension data.
  Unknown discriminants, fields, enum members or invalid formats MUST fail validation.
- **CON-GEN-003** Public timestamps are RFC 3339 UTC with exactly millisecond precision. IDs are
  lowercase UUIDv7 except fixed reverse-DNS identifiers and canonical Acorn URIs.
- **CON-GEN-004** Integers that can exceed JavaScript safe integer range, including revisions,
  offsets and event sequences, MUST be non-zero-prefixed decimal strings.
- **CON-GEN-005** The V2 base path is `/v2`. V1 cookies, bearer tokens, idempotency keys, sockets and
  resource IDs MUST NOT authenticate or address V2.
- **CON-GEN-006** All product routes except the pairing and sole-owner recovery claim routes require
  TLS 1.3 mTLS. Those two pre-credential claims are permitted only over TLS 1.3 server
  authentication after verification of the exact Node-identity SPKI fingerprint and transcript
  proofs in `CON-PAIR-004`/`CON-RECOVER-002`.
- **CON-GEN-007** A successful response MUST include `X-Acorn-Request-Id`. Errors use the common
  error envelope. Product secrets, paths and provider payloads MUST NOT appear in URLs.

## Compatibility

The protocol version is `2.0`; additive optional fields and operations increment the minor version.
Removing or changing meaning requires a new major. Plugin, UI document and event schemas have their
own versions and compatibility ranges. See
[`versioning-compatibility-and-removal.md`](versioning-compatibility-and-removal.md).

## Canonical plugin signing

- **CON-GEN-008** `provenance.manifestDigest` is SHA-256 of RFC 8785 canonical JSON after omitting
  exactly `provenance.manifestDigest` and `provenance.signature`. The Ed25519 signature input is the
  ASCII domain separator `acorn-plugin-manifest-v2` followed by one zero byte and the 32 raw digest
  bytes. This avoids a self-referential digest while covering every other provenance field.
- **CON-GEN-009** Plugin lock signatures use the same construction with domain separator
  `acorn-plugin-lock-v2`, omitting the top-level `signature` property. Duplicate JSON keys,
  non-canonical Unicode and non-finite numbers MUST be rejected before canonicalization.

## Wire operation inventory

These names are the stable OpenAPI `operationId` values. They identify wire operations, not plugin
domain commands.

| `operationId` | Method and path | Purpose |
| --- | --- | --- |
| `claimPairingSession` | `POST /v2/pairing/claim` | claim an owner-confirmed one-time pairing session |
| `prepareDeviceCredentialRotation` | `POST /v2/devices/{deviceId}/credential-rotations` | prepare the two-key rotation journal defined by `CON-ROTATE-001`–`003` |
| `commitDeviceCredentialRotation` | `POST /v2/devices/{deviceId}/credential-rotations/{rotationId}/commit` | atomically activate the new device generation under `CON-ROTATE-001`–`003` |
| `claimSoleOwnerRecovery` | `POST /v2/recovery/claim` | consume fingerprint-pinned sole-owner recovery under `CON-RECOVER-001`–`003` |
| `getNodeDescriptor` | `GET /v2/node` | obtain the authenticated Node descriptor |
| `createSessionHandshake` | `POST /v2/session/handshake` | negotiate protocol, cursors, capabilities and socket ticket |
| `updateSessionCapabilities` | `PUT /v2/session/capabilities` | replace the current Client capability advertisement |
| `executeQuery` | `POST /v2/queries/{queryId}` | execute one declared authorized read query |
| `executeCommand` | `POST /v2/commands` | submit one node-qualified mutation command |
| `getCommandResult` | `GET /v2/commands/{commandId}` | read a retained terminal or accepted command outcome |
| `cancelCommand` | `DELETE /v2/commands/{commandId}` | request cancellation under the command's commit contract |
| `createAuthorizedSnapshot` | `POST /v2/snapshots` | obtain a redacted snapshot and replay sequence |
| `beginObjectUpload` | `POST /v2/objects` | create a bounded content-addressed upload grant |
| `uploadObjectChunk` | `PUT /v2/objects/{objectId}` | upload one authorized digest/range-checked chunk |
| `downloadObject` | `GET /v2/objects/{objectId}` | retrieve authorized immutable object bytes or a range |

- **CON-GEN-010** Implementations and generated SDKs MUST use these operation IDs exactly.
  Authentication, authorization, idempotency, concurrency, cancellation, errors and resulting
  events are defined by the linked operation/domain contract; an operation ID itself grants no
  authority.
- **CON-GEN-011** The three device rotation/recovery operations use the common error envelope and
  `X-Acorn-Request-Id` response header. Prepare and commit require current-device mTLS and exact
  `deviceId`; recovery is unauthenticated only until its fingerprint-pinned package, CSR-key proof,
  secret proof, rate limit and recovery epoch validate. Their commit, retry, crash and resulting
  revocation behavior is exclusively `CON-ROTATE-001`–`003` and `CON-RECOVER-001`–`003`.
- **CON-GEN-012** Every JSON example without `.invalid` in its filename MUST validate against its
  declared schema. An `.invalid.json` fixture MUST have one documented intended rejection and MUST
  fail that schema for that reason; rejection for an unrelated shape error is a validation
  failure.
- **CON-GEN-013** The Herdr fixture release gate MUST validate all 100 rows and every nested
  manifest, contribution, capability request, operation, worker and source-build plan through local
  `$ref`s; additionally it MUST assert unique/order-complete row IDs and coordinates, cross-resolve
  command/keybinding/worker references, reproduce the declared aggregate counts, and prove
  Extension activation is blocked only by its named extension while Unsupported rows have no
  executable manifest.

## Validation release gate

CI MUST parse OpenAPI, AsyncAPI, all JSON Schemas and WIT; resolve every local `$ref`; validate
examples; verify all operation/error/event IDs occur in prose; and reject unfinished-work markers.
