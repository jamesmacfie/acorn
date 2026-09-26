# Phase 3: make trust selection atomic and keep fallback honest

Status: proposal, 2026-09-26. Not started. Waits on
[phase 2](./02-fleet-distribution.md).

Part of [Node-provided UI](./README.md).

## Goal

Discovering an update does not change the registered contribution set. Acceptance, rejection,
dismissal, and revocation each have one explicit transition, and contribution registration changes
only after the device's durable trust state and the distribution snapshot agree.

The UI describes fallback accurately. An accepted previous client remains usable only where its
matching previous node runtime is still active.

## The current failure

The current reload order is:

1. re-read the roster;
2. globally repin bundle winners;
3. refresh the trust queue; and
4. re-register contributions.

If a new hash wins at step 2 and is not accepted, `eligiblePlugins()` returns that hash as untrusted.
The registration pass removes the accepted old surfaces before the owner sees the trust dialog.
Rejecting the new hash records the rejection and removes the prompt, but does not restore the old
selection. The rejected high version remains the resolver's winner on later boots, so the accepted
old bundle remains suppressed.

The dialog currently promises that the previous version keeps running. That promise happens to be
possible while the node still runs the old node half, but the state model does not enforce it. It is
impossible after the node restarts into a different private protocol unless that new client is
accepted or compatibility is explicitly declared.

There is a second transition gap in Settings. Revoking a development grant refreshes distribution
but does not synchronously refresh contribution registrations. The prompt can reappear while code
that depended on the revoked acceptance remains registered.

## Decision: offered candidate and accepted winner are different facts

For each `(nodeId, pluginId)`, distribution tracks these independently:

```ts
type PluginTrustSelection = {
  runtime: PluginRuntimeIdentity | null
  offered: readonly OfferedPluginCandidate[]
  selected: AcceptedPluginSelection | null
  pending: PluginTrustRequest | null
}
```

- `offered` is what nodes currently advertise, including an installed candidate waiting for restart.
- `pending` is an offered exact hash with no durable decision on this device.
- `selected` is the accepted bundle whose identity is compatible with the node's active runtime.
- `runtime` is the phase 1 identity that decides whether any selected client may call this node.

An offered candidate cannot become selected as a side effect of version comparison. Version ordering
may decide which candidate is presented first when several are offered. Trust and runtime compatibility
decide selection.

The accepted winner is part of phase 2's immutable distribution snapshot. There is no second
`acceptedBundles` signal that can get ahead of or behind it.

## Transition rules

| Event | Durable decision | Selected contribution set |
| --- | --- | --- |
| Discover unaccepted installed update while old runtime remains active | None yet | Keep the accepted selection matching the old runtime. Queue the update. |
| Accept installed update before restart | Record accepted exact hash | Keep old selection while old runtime is active. New hash becomes ready for selection when the node commits it. |
| Reject installed update before restart | Record rejected exact hash | Keep old selection while old runtime is active. Remove that candidate from the prompt queue. |
| Dismiss prompt | Record nothing | Keep old selection. Defer the prompt for this UI session; a later reconciliation may offer it again. |
| Node commits an already accepted runtime hash | Existing acceptance | Atomically replace registration with the new accepted selection. |
| Node commits an unaccepted runtime hash | None | Withhold that plugin's loaded UI on that node and prompt. Do not run the previous client against the new node half. |
| Node commits a rejected runtime hash | Existing rejection | Withhold loaded UI on that node and show the rejected state in Settings. Do not prompt again until the hash changes or the owner explicitly reconsiders it. |
| Revoke a normal acceptance | Remove or supersede accepted decision | Withdraw every registration using that exact key in the same client transaction. |
| Revoke a development grant | Invalidate auto-accepted decisions covered by the grant | Withdraw affected registrations before or with the prompt state; no accepted-code interval remains. |
| Node rolls back to an accepted older runtime | Existing acceptance | Select it because it is now the actual runtime, not because the resolver silently downgraded. |

The last rule is the anti-downgrade distinction. The client never chooses an older node protocol to
avoid a rejected update. It follows the runtime the node reports and asks whether the matching client
bytes are accepted.

## What “keep the previous version” may promise

The trust dialog must derive its copy from the runtime relation:

- When the previous accepted hash still matches the node's active runtime: “The current version keeps
  working until this node activates the update.”
- When the node already runs the new unaccepted hash: “This plugin's interface stays unavailable on
  this node until you accept this version or the node runs an accepted version.”
- On a first install waiting for restart: “Accepting now allows the interface to appear after the node
  starts this plugin.”
- On a client-only package whose current runtime changed immediately: use the unavailable wording
  unless the distribution layer has a complete retained previous declaration that it can safely
  restore. Do not infer fallback from cached JavaScript alone.

Button labels should describe the decision, such as **Accept update**, **Reject update**, and **Not
now**. **Keep previous version** is used only if that is a real outcome for every node named by the
prompt.

## Prompt identity and snapshotting

A `PluginTrustRequest` must contain the immutable candidate declaration used to render it. It must not
hold a mutable roster row that can be replaced while the dialog is open. The request names:

- plugin id and client hash;
- version and source node ids;
- the manifest permission and contribution snapshot;
- the compatible active runtime relation for each source node; and
- the previous accepted acknowledgement used for the grant diff.

The decision remains keyed to `(pluginId, hash)` and the device still verifies the bytes itself. When
several nodes offer the same key, one decision covers the bytes on this device. The prompt can list all
source nodes; “first node encountered” is not stable provenance.

Before keeping that one-key rule, implementation must verify that all rows offering the same key
produce an equivalent enforced permission snapshot. If they do not, treat the observations as a
conflict and withhold the bundle. A single acknowledgement must not silently authorize two different
host-enforced declarations.

## Atomic commit order

### Accept

1. Persist the accepted decision through custody.
2. Re-read or receive the stored result; do not optimistically grant on a failed write.
3. Enqueue a distribution transition with the new durable decision set.
4. Publish the new snapshot.
5. If the accepted hash matches an active runtime and changes the active node's selected set,
   dispose and register contributions once.
6. Remove the resolved prompt as part of the same published snapshot.

### Reject

1. Persist the rejection.
2. Publish a snapshot that removes that pending request and preserves any compatible accepted
   selection.
3. Re-register only if the rejected hash had somehow been selected; the invariant tests should make
   that state unreachable.

### Dismiss

Dismissal writes no trust decision. It updates only session presentation state. It cannot alter
selection, accepted keys, or registrations. A separate queue of deferred request keys may keep the
dialog from reopening immediately; the request remains visible in Settings.

### Revoke

1. Persist the revocation or dev-grant removal and invalidate the covered acknowledgements.
2. Publish a distribution snapshot with those keys absent from accepted selection.
3. Dispose affected registrations in the same reconciliation completion.
4. Then expose the new pending or rejected state to the prompt UI.

If contribution synchronization throws, core fallback surfaces remain and the snapshot records the
registration failure. It does not restore a revoked selection.

## Candidate ordering

Highest compatible version remains useful for ordering offers, but it is not a selection policy.
Within one plugin id:

1. show the candidate matching the active runtime first when it lacks a decision;
2. then show installed candidates waiting for restart;
3. collapse the exact same `(pluginId, hash)` across nodes into one request; and
4. use version and then hash as a stable display tie-break only.

A rejection suppresses that exact hash. It does not suppress later hashes and it does not make an
unrelated accepted hash compatible with the current runtime.

## Development grants

Development grants remain an explicit convenience and keep their current warning. They do not bypass
the state machine. Auto-accepting a new hash writes an acknowledgement, then follows the same accept
transition.

Revoking a grant must return or expose the exact acceptance keys it invalidated so distribution can
withdraw them in one pass. Calling `syncPluginDistribution()` without `syncPluginContributions()` is
not a complete revocation.

## Code touched

- `packages/client-core/src/host/plugins/distribution.ts`: offered, pending, and selected state in one
  snapshot; pure trust transitions.
- `packages/client-core/src/host/trust/trustModel.ts`: durable-decision-first accept and reject paths.
- `packages/client-core/src/host/trust/PluginTrustDialog.tsx`: accurate state-dependent copy and
  a presentation-only dismiss path.
- `packages/client-core/src/features/settings/PluginsSettings.tsx`: revoke through the same
  distribution transition and show accepted, pending, rejected, and runtime-mismatch states.
- `packages/client-core/src/host/plugins/reload.ts`: roster changes offer candidates; they do not
  replace the accepted selection before a decision.
- `packages/client-core/src/host/plugins/syncContributions.ts`: one sync after a committed snapshot.
- `packages/custody/src/plugins/pluginTrustStore.ts`: return the keys invalidated by revocation if the
  current API cannot expose them reliably.
- Equivalent terminal trust presentation and transition adapters.

## Tests

- Accepted 1.0 active + untrusted 2.0 installed: the 1.0 registration remains before, during, and
  after opening the prompt.
- Accept 2.0 before restart: 1.0 remains registered; after runtime changes to 2.0, one sync swaps it.
- Reject 2.0 before restart: 1.0 remains registered across reconciliation and client restart while
  the node still runs 1.0.
- Dismiss 2.0: no custody write, no selected-key change, no contribution sync, request remains
  discoverable in Settings.
- Runtime changes to unaccepted 2.0: 1.0 is not used against it; the loaded UI is withheld only on
  nodes running 2.0.
- Node A runs accepted 1.0 and node B runs unaccepted 2.0: A has UI, B has a prompt and no loaded UI.
- Rejected 2.0 remains quiet across boot and does not suppress an accepted runtime-matching 1.0.
- Runtime rollback from rejected 2.0 to accepted 1.0 restores selection because the node identity
  changed.
- Normal revocation and dev-grant revocation remove code-bearing frames, trees, chrome, commands, and
  slots before the next paint or observable microtask boundary chosen by the implementation.
- A failed trust-store write changes neither prompt state nor registrations.
- Two nodes offering the same hash with different enforced declarations are withheld as a conflict.

## Docs owed

- `docs/security.md`: candidate versus selected trust state, revocation ordering, and declaration
  conflict handling.
- `docs/plugins/activation.md`: update, restart, rejection, rollback, and dev grant transitions.
- `docs/ui-design.md`: exact trust-dialog copy and Settings states.
- `docs/state-ownership.md`: durable decisions versus session-only prompt dismissal.
- `docs/testing.md`: update, rejection, revocation, and mixed-fleet acceptance.

## Done when

- Merely discovering or caching a candidate never changes registered contributions.
- Every selected loaded bundle has both a durable accepted decision and a compatible active runtime.
- Reject and dismiss preserve an existing compatible selection without manufacturing compatibility
  after a node restart.
- Revocation removes affected registrations in the same state transition.
- The trust dialog makes no unconditional promise that an older node interface can remain available.

## Verify before building

- Confirm `reconcilePluginChange()` still repins distribution before it synchronizes contributions.
- Confirm `recordTrustDecision()` still synchronizes contributions only for acceptance.
- Confirm rejection and dialog dismissal still lack a path that recomputes the accepted selection.
- Confirm development-grant revocation still calls distribution sync without a contribution sync.
- Confirm trust decisions remain stored by `(pluginId, hash)` and that the device computes the hash
  from cached bytes.
- Confirm whether two roster rows can currently advertise the same client hash with different
  permissions or contributions; retain the conflict check unless the protocol makes that impossible.
