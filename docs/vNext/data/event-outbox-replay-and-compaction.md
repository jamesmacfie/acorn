# Event outbox, replay and compaction

Status: **Normative**
Requirement prefix: `DATA-EVT`

## Append

Core event append allocates `sequence = node_metadata.event_sequence + 1`, inserts the complete
event, and updates the singleton counter inside the same `BEGIN IMMEDIATE` transaction as the domain
mutation. A running Node never imports a prior outbox. V2 restore always creates a new Node identity
and starts a new sequence at zero; old events/sequence are archive evidence only and are not inserted,
so a restored Node's live sequence has no inherited gaps.

- **DATA-EVT-001** Event ID is generated before the transaction. A unique constraint makes broker
  retries idempotent.
- **DATA-EVT-002** `encoded_bytes` is the exact canonical event-envelope UTF-8 length and drives the
  256 MiB limit. Payload maximum is 256 KiB after encoding.
- **DATA-EVT-003** Sensitive payload is application-encrypted at rest with associated data
  `(nodeId,sequence,eventId,type,resourceUri)`. Authorization and redaction occur before delivery.

## Plugin relay

1. plugin commits domain rows plus a plugin-local outbox row;
2. broker reads it through scoped storage and claims `(installationId,pluginEventId)`;
3. core transaction inserts/loads `plugin_event_inbox`, allocates global sequence, inserts global
   outbox, and records that sequence;
4. broker marks plugin row delivered with the global sequence.

Every step is restartable. A duplicate plugin ID with different digest quarantines the plugin.

## Replay

Replay query is `sequence > after ORDER BY sequence LIMIT 500`, additionally filtered and authorized.
The sender batches no more than 1 MiB or 500 events. An event skipped for authorization still
advances the subscription's delivered sequence through a control cursor so absence cannot be used to
stall retention; payload/details are not disclosed.

- **DATA-EVT-004** Acknowledgement is advisory flow control and client progress only. It does not
  authorize, delete or extend retention.
- **DATA-EVT-005** Client records only the highest contiguous applied Node-global sequence. Multiple
  subscriptions share a product cursor only if their combined authorized filter is complete for the
  cache they update.

## Compaction

Every hour and after each 16 MiB growth:

1. delete rows with `occurred_at < now - 7 days`;
2. compute retained `SUM(encoded_bytes)`;
3. if above 256 MiB, delete oldest whole rows until at or below the limit;
4. atomically update advertised `oldestSequence`;
5. checkpoint WAL opportunistically.

- **DATA-EVT-006** Limits are **whichever is reached first**, not guarantees of seven days or
  256 MiB. Compaction is independent of connected clients.
- **DATA-EVT-007** Audit records have separate retention and MUST NOT be placed in product replay
  merely to escape compaction.
- **DATA-EVT-008** If disk pressure prevents a safe append, the domain mutation MUST fail before
  commit with `resource_exhausted`; mutation without its required event is prohibited.

## Snapshot boundary

Snapshot generation opens a core read transaction, reads current global sequence, serializes all
authorized core resources, and commits. Plugin snapshots are fetched with plugin-specific snapshot
tokens tied to the same requested boundary; because databases are independent, their
`sourceSequence` may precede the global boundary and is included. Subsequent events converge them.
Plugins unable to provide a consistent snapshot are marked degraded and excluded with an explicit
error.

- **DATA-EVT-009** The closed snapshot/group/resource envelopes, schema/digest
  selection, bounds and per-group atomic install are `CON-EVT-006A` through
  `CON-EVT-006C`. Plugin payload schemas are signed installation artifacts; a
  plugin cannot ask the Client to infer a schema or commit a partial group.
- **DATA-EVT-010** A snapshot expires after five minutes. `authorizationRevision`
  is sampled at creation and rechecked before Client commit. Changed authority
  aborts affected groups and requests a new snapshot; it never broadens cached
  fields.
- **DATA-EVT-011** Every plugin snapshot group MUST identify its installation,
  installation generation, schema URI and digest, sensitivity, source sequence,
  target global boundary and complete member set. The Client MUST validate and
  commit that group atomically; it MUST NOT combine members from different
  generations or install a partial group.
- **DATA-EVT-012** An unavailable or inconsistent plugin snapshot MUST appear as
  an explicit bounded group error or omission. An unknown schema/digest,
  authorization change, expired boundary, limit violation or invalid member
  MUST reject only the affected group, preserve the last valid Client partition
  for that group as stale, and expose the plugin as degraded until authorized
  resynchronization succeeds.
