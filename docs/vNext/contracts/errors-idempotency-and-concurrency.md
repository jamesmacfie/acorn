# Errors, idempotency and concurrency

Status: **Normative**
Requirement prefix: `CON-ERR` / `CON-CONC`

## Error envelope

All HTTP failures use [`schema/error-envelope-v2.schema.json`](schema/error-envelope-v2.schema.json)
and media type `application/problem+json`:

| Field | Meaning |
| --- | --- |
| `type` | stable documentation URI under `https://acorn.dev/problems/v2/` |
| `title` | stable non-secret summary |
| `status` | HTTP status |
| `code` | stable snake-case machine code |
| `requestId` | UUIDv7 correlation ID |
| `retryable` | whether same request may be retried |
| `detail` | safe user-facing instance description |
| `resource` | affected Acorn URI or null |
| `currentRevision` | safe conflict revision or null |
| `retryAfterMs` | bounded delay or null |
| `errors` | bounded field validation errors |

- **CON-ERR-001** Error detail MUST NOT expose secrets, credentials, SQL, stack traces, private
  paths, command output, provider bodies or plugin-private data.
- **CON-ERR-002** Unknown internal failures return `internal_error`, a request ID and no diagnostic
  content. Diagnostics go to privacy-safe Node logs.
- **CON-ERR-003** Authentication failures are indistinguishable `authentication_failed`.
- **CON-ERR-004** Every pairing claim failure returns `pairing_failed` with HTTP 400 or, after
  admission limiting, `rate_limited` with HTTP 429. The response never identifies which transcript,
  proof, session state, fingerprint, endpoint, CSR, secret, expiry or concurrency check failed.

## Required codes

| Code | HTTP | Retryable |
| --- | ---: | --- |
| `bad_request`, `validation_failed` | 400 | no |
| `authentication_failed` | 401 | no |
| `pairing_failed` | 400 | no |
| `permission_denied` | 403 | no |
| `not_found` | 404 | no |
| `revision_conflict`, `idempotency_conflict`, `session_stale` | 409 | no |
| `already_committed`, `not_cancellable` | 409 | no |
| `resync_required`, `stream_gap` | 409 | after snapshot/reattach |
| `capability_unavailable`, `plugin_unhealthy` | 422 | no |
| `rate_limited`, `resource_exhausted` | 429 | yes |
| `internal_error`, `temporarily_unavailable` | 503 | yes |
| `deadline_exceeded` | 504 | operation-specific |
| `delegation_invalid`, `delegation_revoked` | 403 | no |

Plugin error codes are `<publisher>_<plugin>_<code>` and must be declared in the manifest schemas.

## Concurrency

- **CON-CONC-001** Resource revisions provide optimistic concurrency. SQLite write transactions
  serialize the owning database only; the Node MUST NOT hold a transaction while doing network,
  process or plugin calls.
- **CON-CONC-002** Commands affecting multiple same-Node core resources lock them in canonical URI
  byte order and commit in one short core transaction, or use a saga.
- **CON-CONC-003** Plugin database and core database MUST NOT participate in one SQLite transaction.
  Coordination uses an idempotent saga and compensating events.
- **CON-CONC-004** Deadline expiry stops waiting but MUST accurately report whether the operation
  may have committed. If unknown, return an operation URI, never invite a new command ID.

## Rate limits

Limits are per device and additionally per plugin/operation. Responses include `Retry-After`.
Authentication, pairing and secret-use limits are stricter and cannot be raised by plugins. Rate
limits MUST be enforced before expensive schema decoding or artifact allocation where practical.
