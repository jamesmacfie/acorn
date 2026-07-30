# Commands, actions and custom events

Status: Normative<br>
Requirement prefix: `PLUG-CAE`

Commands request work. Actions are UI bindings that invoke commands or presentation intents. Events
record committed facts. These concepts remain separate across core and plugin contracts.

## Commands

Every plugin command declaration includes:

| Field | Meaning |
| --- | --- |
| `id` and `version` | namespaced stable contract |
| `inputSchema`, `resultSchema` | signed schemas |
| `scope` | target resource type and Node locality |
| `capabilities` | authority checked at execution |
| `idempotency` | `none`, `keyed`, or `naturally-idempotent` |
| `preconditions` | supported resource version/condition |
| `deadlineMs` | maximum 1–300,000 |
| `cancellable` | behavior before and after commit point |
| `confirmation` | `none`, `risk`, `destructive`, `unrestricted-code` |
| `effects` | declared files/network/process/secrets/resources |
| `resultEvents` | events that follow successful commit |
| `errors` | closed stable domain error set |

- **PLUG-CAE-001:** Every mutating command MUST reauthenticate and reauthorize at the Node command
  boundary. UI visibility, a valid view session, a dependency, or prior approval is insufficient.
- **PLUG-CAE-002:** Input validation occurs before side effects. Provider and dependency outputs are
  separately validated before commit.
- **PLUG-CAE-003:** A keyed command stores `{caller, command, target, key, canonicalInputHash,
  outcome}` atomically with the effect or its durable intent. Reusing a key with different input
  returns `idempotency_conflict`.
- **PLUG-CAE-004:** Optimistic concurrency uses an opaque resource version. A mismatch returns
  `version_conflict` with an authorized current version and no mutation.
- **PLUG-CAE-005:** Cancellation before the declared commit point produces no committed effect.
  Cancellation after it returns the committed result or `outcome_pending`; it never claims rollback
  without a compensating operation.
- **PLUG-CAE-006:** Command errors MUST be stable, redacted envelopes and MUST NOT include stack
  traces, raw provider bodies, filesystem roots, credentials or sandbox internals.

## UI actions

- **PLUG-CAE-007:** A UI action binds a renderer interaction to exactly one declared command,
  navigation intent, local presentation operation or wizard transition.
- **PLUG-CAE-008:** Action input is produced by a typed mapping from view data, form state,
  selection and host context. It cannot evaluate code or read ambient client state.
- **PLUG-CAE-009:** Debounce, throttle, repeat, confirmation, optimistic patch, pending state,
  success state, failure rollback and focus return MUST be declared where relevant.
- **PLUG-CAE-010:** Destructive, permission-changing, native-execution, secret-use and external-send
  actions use host-owned confirmation surfaces that bespoke UI cannot imitate or suppress.
- **PLUG-CAE-011:** Presentation intents change only client presentation and cannot mutate Node
  state. A presentation intent targeting another Node MUST retain the node-qualified resource.

## Event envelope

Plugin events use the shared event envelope and add a plugin-owned payload:

| Field | Semantics |
| --- | --- |
| `eventId` | globally unique opaque ID |
| `sequence` | monotonically increasing unsigned 64-bit decimal sequence per Node |
| `nodeId` | emitting Node |
| `type` | namespaced event coordinate |
| `schema` | immutable URI, SHA-256 digest and positive event schema version |
| `occurredAt` | server UTC timestamp of fact |
| `recordedAt` | outbox UTC timestamp |
| `producer` | core/plugin kind, coordinate, version and installation generation |
| `resource` | canonical node-qualified resource ID |
| `correlationId`, `causationId` | trace relationship |
| `actor` | redacted effective actor plus core-derived initiator, ordered installation-generation hops and evaluated grant versions; no bearer handle |
| `sensitivity` | `public-metadata`, `internal`, or `sensitive`; secret plaintext is forbidden |
| `payload` | validated event-specific object |

- **PLUG-CAE-012:** A custom event is inserted in the same local transaction as the plugin state
  change. If no state change commits, no success event exists.
- **PLUG-CAE-013:** Maximum normal event payload is 256 KiB. Larger content MUST be an authorized,
  expiring blob resource reference; secret plaintext is never event content.
- **PLUG-CAE-014:** Event payloads are immutable. Corrections are new events that reference the
  superseded fact.
- **PLUG-CAE-015:** Authorization and redaction are evaluated on subscription and snapshot replay.
  An event envelope's presence never proves the viewer can read its payload or subject.
- **PLUG-CAE-016:** Plugin events participate in the Node retention rule: seven days or 256 MiB,
  whichever is reached first. A subscriber behind the oldest sequence MUST perform an authorized
  snapshot resynchronization.
- **PLUG-CAE-017:** Plugins cannot choose infinite retention. Domain history required beyond replay
  belongs in plugin state and is exposed through a bounded snapshot query.

## Standard plugin lifecycle events

The core publishes:

`plugin.install.requested`, `plugin.artifact.resolved`, `plugin.artifact.verified`,
`plugin.permissions.required`, `plugin.permissions.changed`, `plugin.install.staged`,
`plugin.setup.started`, `plugin.setup.step_changed`, `plugin.setup.blocked`,
`plugin.setup.completed`, `plugin.activation.started`, `plugin.activated`,
`plugin.activation.failed`, `plugin.health.changed`, `plugin.update.available`,
`plugin.update.started`, `plugin.update.activated`, `plugin.rollback.started`,
`plugin.rolled_back`, `plugin.disabled`, `plugin.quarantined`, `plugin.uninstall.started`,
`plugin.uninstalled`, and `plugin.data.purged`.

- **PLUG-CAE-018:** Each lifecycle event identifies installation, coordinate, old/new generation
  where applicable, persisted lifecycle state, actor, reason code and recovery action. It excludes
  secret input and raw diagnostic output.
- **PLUG-CAE-019:** A plugin MAY observe its lifecycle events but cannot publish them, acknowledge
  its own health recovery, or forge a core event namespace.
- **PLUG-CAE-020:** Event conformance tests MUST cover sequence monotonicity, transaction rollback,
  replay redelivery, redaction, schema evolution, unknown event types, payload bounds, expired
  cursors and publisher namespace enforcement.
