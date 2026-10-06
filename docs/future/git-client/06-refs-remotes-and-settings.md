# Phase 06: refs, remotes, comparison, and settings

Date: October 7, 2026. Status: planned; implementation not started.
Depends on [phase 05](./05-task-and-workflow-launches.md).
Read the [full implementation context](./README.md), especially
[settings and refs](./README.md#refs-comparison-and-git-settings) and
[mutation contracts](./README.md#mutation-contracts).

## Deliverable

A person manages named refs and remotes, compares pinned revisions, configures Git behavior in
Acorn settings, and optionally enables Node-scheduled fetching. Checkout writes still require a
task, and remote actions retain Changes' hooks and semantics.

## Delivery units

Implement these units sequentially and verify each as a demoable slice before the next:

1. **Refs:** add branch/tag navigation and create/rename/delete/upstream actions. Recheck ref
   identity and reject task-reserved or checked-out branch mutation across project aliases. Offer
   task/workflow launch through phase 05; selection does not change a task branch.
2. **Remotes:** add remote navigation, add/remove/URL editing, and manual repository fetch. Validate
   URLs and names, disallow executable helper transports, retain explicit targets, and report
   network failures. Expose the Changes remote owner through a public contract where Git needs
   task pull/push, preserving before-push hooks and lease-based behavior.
3. **Comparison:** select two refs/commits, pin their IDs, and show direct or merge-base comparison
   with direction and base visible. Reuse topology, lazy diff, and bounded search from phase 02.
4. **Settings:** contribute scoped Git settings with effective identity/origin, explicit local or
   Node-global writes, fast-forward/rebase pull policy, and device graph/diff presentation. Use
   standard save/readback/dirty-form behavior; surface override and partial-write results.
5. **Auto-fetch:** default off and opt in at five minutes. Schedule on the Node, deduplicate
   aliased repositories, bound network work, prevent overlap, respect disabled/disposed plugin
   state, and expose last success/failure. A client read or mount must not fetch.

## Acceptance

- Real repositories cover checked-out/task-reserved branches, invalid names, annotated/lightweight
  tags, stale refs, aliases, direct/merge-base comparison, root histories, and merge parents.
- A local bare remote proves manual fetch, both pull strategies, push hooks, lease refusal when
  another actor advances the remote, and lease behavior after an auto-fetch updates tracking refs.
- Settings tests isolate a temporary HOME/config and prove effective origins, local versus
  Node-global writes, overridden values, readback, failure preservation, and Node switching.
- Scheduler tests prove off means no network calls, repository deduplication, cadence, no overlap,
  failures that do not stop other repositories, and disposal. Use an injected clock and controlled
  Git work rather than wall-clock sleeps.
- Both hosts demonstrate each delivery unit. Run [phase gates](./README.md#verification-strategy)
  for Git, Changes, settings/scheduler owners, public API, and affected clients.

## Verify before building

- Recheck settings scope/save contracts, Node schedule lifecycle, and Changes' remote contract.
- Confirm lease expectations under background fetching before exposing any force-with-lease action.
