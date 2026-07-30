# Events, subscriptions and replay

Status: **Normative**
Requirement prefix: `CON-EVT`

## Event semantics

- **CON-EVT-001** An event is an immutable statement that a committed fact occurred. It MUST NOT be
  used as synchronous RPC, authority, or an instruction to mutate without an independently
  authorized command.
- **CON-EVT-002** Every durable product event uses
  [`schema/event-envelope-v2.schema.json`](schema/event-envelope-v2.schema.json), a global per-Node
  monotonically increasing sequence and UUIDv7 `eventId`.
- **CON-EVT-003** State mutation and event append are atomic in the owning SQLite database. Plugin
  events are relayed into the core outbox using the broker's durable inbox/outbox saga before they
  become globally visible.
- **CON-EVT-004** Delivery is ordered by sequence and at least once. Consumers deduplicate by
  `(nodeId,eventId)` and persist the highest contiguous applied sequence.
- **CON-EVT-011** `occurredAt` is the committed fact time and `recordedAt` is insertion into the
  globally sequenced outbox. Producer coordinate/version/generation, schema URI/digest/version,
  actor/delegation and correlation/causation are host-derived or manifest-verified; a plugin cannot
  forge them in its event draft.

Event types are lowercase reverse-DNS identifiers ending with a past-tense fact, for example
`acorn.core.task.created.v2` or `dev.acme.monitor.alert.raised.v1`. Plugin events must be declared
under their publisher/name namespace with a content-addressed JSON Schema.

## Retention

The Node keeps only events that satisfy both limits:

1. `occurredAt` is within the most recent seven days; and
2. total encoded retained event bytes do not exceed 256 MiB.

It deletes age-expired events, then oldest events until the size bound is met. A single event is
limited to 256 KiB. `oldestSequence` is the first replayable sequence and `currentSequence` is the
latest committed sequence. Compaction does not depend on client acknowledgements.

- **CON-EVT-005** A request after `oldestSequence - 1` returns `resync_required`, including
  `oldestSequence` and `currentSequence`, but no unauthorized event details.
- **CON-EVT-006** Resynchronization obtains authorized snapshots, atomically records their
  `snapshotSequence`, then subscribes with `after=snapshotSequence`.
- **CON-EVT-006A** Every recovery response validates against
  `schema/snapshot-v2.schema.json`. It is capped at 64 MiB total, 128 groups,
  8 MiB/10,000 resources per group, 256 KiB per inline payload, JSON nesting
  depth 32 and 250,000 total collection elements. `encodedBytes` and every
  digest are recomputed over RFC 8785 bytes; declared values are never trusted.
- **CON-EVT-006B** The Client accepts only its pinned Node ID, current
  authorization revision, known signed schema URI/digest, non-duplicate
  node-qualified URI, matching owner/generation and source sequence no newer
  than `snapshotSequence`. Unknown schema/digest, mixed Node, conflict, expired
  result, stale authorization or a group digest mismatch rejects that complete
  group without touching the last valid partition.
- **CON-EVT-006C** Core and each plugin are separate `atomic-group` boundaries.
  Complete groups replace their authorized owner/type partition and record
  source sequence in one Client transaction; degraded/omitted groups retain
  the last valid partition as stale with the explicit omission/error. Only
  after all valid groups and snapshot metadata commit may the event cursor
  advance to `snapshotSequence`. A crash either retains the old group or the
  complete new group.
- **CON-EVT-007** Redaction or resource deletion does not rewrite events. Sensitive payload fields
  must be omitted or encrypted at creation; tombstone events contain identifiers and reason only.

## WebSocket

There is exactly one `/v2/events` WebSocket per active device/Node session. It multiplexes:

- event subscriptions and acknowledgements;
- terminal/log/binary stream open, credit, data and close frames;
- heartbeat and protocol errors.

Client sends `subscribe` with a unique `subscriptionId`, channel, event type filters, optional
resource prefixes and `after`. Node authorizes each filter and replies `subscribed` with the effective
filter and range. Empty filters do not mean unrestricted access.

- **CON-EVT-008** Maximum subscriptions are 128, filters 64 event types and 64 resource prefixes,
  and client frame size 256 KiB. Node output frame size is at most 1 MiB.
- **CON-EVT-009** Heartbeat interval is 30 seconds; no valid pong within 10 seconds closes with
  4408. Invalid/replayed ticket closes 4401; revoked device 4403; protocol violation 4400; overload
  4429; controlled restart 4503.
- **CON-EVT-010** A slow consumer receives `flow.paused`; after 30 seconds or an 8 MiB queued-byte
  limit the Node closes it. Reconnection resumes from the last durably applied cursor.

## Custom plugin events

Publishing requires manifest declaration and broker validation. Subscribing requires a declared
required/optional plugin dependency, exact event/version range and `plugin.events.subscribe`
permission. The broker preserves originating actor and delegated caller; a subscriber cannot infer
additional authorization from receipt.
