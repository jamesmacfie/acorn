# Failure, degraded and offline modes

Status: **Normative**
Requirement prefix: `ARCH-FAIL`

## Classification

| State | Meaning | Mutations |
| --- | --- | --- |
| `online` | Authenticated and fully negotiated | Allowed by policy |
| `degraded` | Connected; named capabilities/plugins unavailable | Only unaffected operations |
| `draining` | Node shutting down | New mutations rejected |
| `offline` | No authenticated transport | Never queued implicitly |
| `incompatible` | No protocol overlap or identity mismatch | Prohibited |
| `revoked` | Client device rejected | Prohibited; local credentials removed |

- **ARCH-FAIL-001** Electron MUST display the Node state and last successful observation for cached
  content. Offline content MUST never appear live.
- **ARCH-FAIL-002** V2 MUST NOT implicitly queue mutations while offline. An explicit draft may be
  stored locally, but submission is a new user-visible command after reconnect and revision check.
- **ARCH-FAIL-003** Read aggregation MUST return partial fleet results with per-Node errors rather
  than fail the whole fleet.
- **ARCH-FAIL-004** Identity/fingerprint mismatch MUST be treated as a security incident, never an
  endpoint update. Re-pairing requires deleting the old trust record after explicit confirmation.

## Recovery

1. Transport reconnects and performs a fresh handshake.
2. Client resumes events from its last durably applied cursor.
3. If the cursor is retained, duplicate events are deduplicated by `eventId`.
4. If the Node returns `resync_required`, the client discards Node-derived query caches, obtains
   authorized snapshots, records the snapshot sequence, and subscribes after that sequence.
5. Locally owned layouts remain; references to deleted resources become recoverable placeholders.

## Partial failures

- A command response lost after commit is retried with the same `commandId`; idempotency returns the
  original terminal result.
- A process command accepted but not yet committed reports `accepted` and exposes an operation URI.
  Cancellation is best effort until the documented commit point.
- Stream loss does not imply process termination. Reattach uses stream-specific retained offsets;
  otherwise the client receives `stream_gap`.
- Plugin update failure leaves the prior artifact active or enters visible quarantine. It cannot
  silently run a partially migrated version.
- Backup failure cannot corrupt the live databases; restore is performed into a new data root and
  switched only after validation.

## Clock and resource pressure

- **ARCH-FAIL-005** Protocol correctness MUST rely on Node sequence/revisions, not wall-clock order.
  Timestamps are UTC RFC 3339 with milliseconds and informational ordering only.
- **ARCH-FAIL-006** At low disk space the Node MUST stop new plugin installs/backups and large
  operations before SQLite safety is threatened, emit `acorn.core.node.resource-pressure.v2`, and continue
  safe reads. It MUST NOT compact unexpired events below the stated retention rules except in an
  explicitly reported emergency fail-closed state.
- **ARCH-FAIL-007** Authentication, schema corruption, key unwrap failure and event sequence
  regression are fatal fail-closed conditions requiring operator recovery.
