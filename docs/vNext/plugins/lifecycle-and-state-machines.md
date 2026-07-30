# Lifecycle and state machines

Status: Normative<br>
Requirement prefix: `PLUG-LIFE`

Lifecycle is persisted Node state, not an in-memory sequence. Artifact acquisition, permission,
setup, runtime, update and data retention are coordinated but remain separately observable.

## Installation aggregate

| State | Meaning | Allowed next states |
| --- | --- | --- |
| `absent` | no installation record | `resolving` |
| `resolving` | solving dependencies/artifacts | `awaiting_artifact`, `failed` |
| `awaiting_artifact` | acquiring Node/client artifacts | `verifying`, `failed`, `cancelled` |
| `verifying` | signature/provenance/archive checks | `awaiting_permission`, `failed` |
| `awaiting_permission` | required grant unresolved | `staging`, `cancelled`, `failed` |
| `staging` | unpacking, lock and storage preparation | `awaiting_setup`, `activating`, `failed` |
| `awaiting_setup` | required wizard incomplete | `activating`, `cancelled`, `failed` |
| `activating` | migration/start/readiness/atomic switch | `active`, `failed`, `rolling_back` |
| `active` | selected generation may serve | `updating`, `disabled`, `quarantined`, `uninstalling` |
| `updating` | replacement generation staged | `active`, `activating`, `rolling_back`, `failed` |
| `rolling_back` | restoring prior generation/data | `active`, `disabled`, `failed` |
| `disabled` | installed, no execution/contributions | `activating`, `uninstalling`, `quarantined` |
| `quarantined` | security/health isolation | `disabled`, `uninstalling`, `activating` after owner remediation |
| `uninstalling` | draining and removing activation | `retained`, `absent`, `failed` |
| `retained` | code removed, plugin data retained | `resolving`, `purging` |
| `purging` | deleting retained data/keys/audit links | `absent`, `failed` |
| `cancelled` | pre-commit install abandoned | `resolving`, `purging`, `absent` |
| `failed` | stable failed operation with recovery | state named by `resumeTarget`, `uninstalling` |

- **PLUG-LIFE-001:** Every transition MUST be a compare-and-set operation over lifecycle revision,
  persist initiator, command, time, old/new state, generation, reason, recovery and correlation, and
  emit its event through the same core transaction.
- **PLUG-LIFE-002:** Invalid transitions return `invalid_lifecycle_transition` without side effects.
- **PLUG-LIFE-003:** Restart reconciliation examines persisted state and artifact/data facts. It
  resumes an idempotent step, restores the last committed generation, or enters a stable failed
  state; it never guesses completion from process presence.
- **PLUG-LIFE-004:** The activation commit point is the atomic selection of the new ready generation
  after migration and health gates. Before it, old generation remains authoritative; after it, old
  handles are revoked.

## Transition obligations

Every transition definition MUST specify:

1. initiating command and authorized actor;
2. preconditions and lifecycle revision;
3. persisted intermediate state;
4. external and storage effects;
5. cancellation and timeout behavior;
6. exact commit point;
7. success and failure events;
8. restart reconciliation;
9. user-visible progress and recovery;
10. audit fields and redaction.

The obligations are not left to implementation convention. The exhaustive,
edge-by-edge command, precondition, persisted phase/effect, cancellation/
deadline, commit/event, restart, user recovery and audit definitions are in
[lifecycle-transition-catalog.md](./lifecycle-transition-catalog.md). That
catalog is the allowed-edge model fixture; this file's state summary cannot
create an additional edge.

- **PLUG-LIFE-005:** Required events and transitions are the lifecycle catalog in
  [commands, actions and custom events](./commands-actions-and-custom-events.md).
- **PLUG-LIFE-006:** `failed` MUST record a stable reason code, safe explanation, failing phase,
  retryability, retained artifacts/data, previous active generation and one or more valid recovery
  commands.
- **PLUG-LIFE-007:** Partial client artifact acquisition MUST remain visible and resumable. The
  Node installation MUST NOT claim fully active for a required Electron contribution until the
  initiating client's compatible artifact is verified and acknowledged.

### Descriptor projection

- **PLUG-LIFE-007A:** An installed plugin's `node-descriptor-v2.plugins[].state` is the persisted
  installation-aggregate state serialized with hyphens rather than underscores: `awaiting_artifact`
  becomes `awaiting-artifact`, `awaiting_permission` becomes `awaiting-permission`,
  `awaiting_setup` becomes `awaiting-setup`, and `rolling_back` becomes `rolling-back`; all other
  state spellings are unchanged. `absent` has no descriptor entry. The descriptor `health` field is
  the runtime-health projection and never substitutes `unhealthy` for an installation state.
- **PLUG-LIFE-007B:** `GET /v2/node` provides the bounded Fleet-summary projection. The core query
  `acorn.core.plugin-installations.get.v2` returns the full installation aggregate, current
  transition, separate permission/setup/runtime/update/data-retention substates, lifecycle revision,
  safe failure, available recovery commands and active/candidate generation. A partial installation
  therefore remains queryable even when it has no active contribution or UI artifact.

## Permission state

`unrequested → requested → partially_granted | granted | denied → changed | revoked`

- **PLUG-LIFE-008:** A changed manifest permission set creates a new request revision and leaves the
  previous generation on its previous grant until resolution.
- **PLUG-LIFE-009:** Denial of a required permission holds installation at `awaiting_permission`;
  denial of optional permission records degraded contributions and may proceed.

## Setup state

`not_required | not_started → in_progress ↔ blocked → completed | cancelled | failed`

- **PLUG-LIFE-010:** Setup state is versioned by wizard and plugin generation. Completed setup is
  reused only when the new manifest declares compatible setup and all referenced settings/secrets
  still exist.
- **PLUG-LIFE-011:** Wizard cancellation does not uninstall automatically. It returns installation
  to `awaiting_setup` or, if the owner chooses Remove, begins explicit uninstall.

## Runtime state

`stopped → starting → ready ↔ degraded → draining → stopped`; any live state may enter
`crashed` or `security_violation`, which feed restart/quarantine policy.

- **PLUG-LIFE-012:** Readiness means required exports, subscriptions, migrations and background
  services are usable. Process existence or heartbeat alone is not readiness.
- **PLUG-LIFE-013:** Disable, update, rollback and uninstall enter `draining`, reject new calls, wait
  for the manifest/host-lower drain deadline, cancel remaining work, revoke handles and stop the
  full process tree.
- **PLUG-LIFE-014:** Repeated crash, contract violation, resource abuse or health failure follows
  [health and quarantine](./health-observability-and-quarantine.md); a confirmed sandbox or
  integrity violation bypasses restart and quarantines immediately.

## Concurrency

- **PLUG-LIFE-015:** Only one lifecycle mutation may hold an installation lease. Competing commands
  receive `lifecycle_busy` with operation identity and safe retry time.
- **PLUG-LIFE-016:** Leases are persisted, owner-bound, expiring and reconciled on restart. Lease
  expiry does not itself mark the operation failed; the reconciler inspects its durable phase.
- **PLUG-LIFE-017:** Fleet clients observe the same Node-owned lifecycle revision. A stale client's
  mutation fails with the current revision and does not overwrite newer owner action.

## Acceptance

- **PLUG-LIFE-018:** Model-based tests MUST traverse every allowed edge, reject every disallowed
  edge, crash between every durable phase, race two clients, revoke permissions during work,
  disconnect the initiating client, and verify exactly one selected generation and recoverable
  owner UX.
