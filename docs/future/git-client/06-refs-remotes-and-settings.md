# Phase 06: refs, remotes, comparison, and settings

Date: October 7, 2026. Status: complete October 9, 2026.

## Completion note — October 9, 2026

Refs, remotes, pinned comparison, scoped settings, and Node auto-fetch landed in that order. Git
owns repository projections and mutations; Changes retains task pull/push and its before-push hook.
The Git task actions call Changes' exported remote contract. Core still owns task checkout and
lifecycle, so selecting a ref only offers the phase 05 task/workflow launch callbacks.

Branch mutations recheck current object ID and canonical Git common directory, including project
aliases, other checkouts, and tasks with pending or archiving ownership. Manual fetch and remote
edits require explicit targets, reject helper transports, and return post-state. Force push uses
the remote object ID observed before the action in an explicit `--force-with-lease` argument; a
background fetch cannot silently advance that lease. Comparison URLs pin source, destination, and
base object IDs and expose direction and direct versus merge-base mode. Identity saves report each
field's result and readback for an explicit repository-local or Node-user-global scope. Auto-fetch
is off by default, runs only from the Node scheduler at a five-minute cadence, deduplicates Git
common directories, limits a pass to 128 projects and two repositories in flight, and aborts on
disable/disposal. Client mounting and refreshing only read state.

Focused evidence: Git 63 tests passed; Changes 272 passed and one skipped. The real bare-remote
tests cover manual fetch, both pull strategies, hook veto, stale and background-fetch-advanced
leases. Controlled-clock tests cover auto-fetch cadence, overlap, failures, alias deduplication,
and disposal. Git, Changes, protocol, client-core, Node, desktop, and TUI type checks passed.
Architecture checks passed 86/87; the unchanged documentation-length rule fails on
`docs/api-reference/core-routes.md` (211 lines) and `plugin-routes.md` (201 lines).

The rebuilt isolated desktop host used `/private/tmp/acorn-phase06-hosts-0God4B/desktop/repo`
and its local bare remote. Its snapshots showed 9 refs, creation of `phase06-desktop`, a manual
fetch success timestamp, direct comparison of 2 files and merge-base comparison of 1 file, local
identity readback from `.git/config`, the auto-fetch switch, and device display settings. The
fresh merge-base screenshot is in `.acorn/agent-dev/git-phase06/screenshots/screenshot-1791515946626.png`.
The rebuilt isolated TUI host used the sibling `tui/repo` fixture. At 120×40 it showed all 9 refs
and branch actions; at 80×24 keyboard scrolling revealed the selected ref and task/workflow
launches. TUI keyboard actions pinned `41852dc6` → `5c674821` in merge-base mode and displayed
base `b4046913` with `story.txt` in the detail. Earlier TUI snapshots in the same session showed
remote fetch success and Node and device settings. Both hosts were stopped after verification.

Payloads: Node startup 3,199,794/3,200,000 bytes; TUI startup 731,617/732,000 bytes. Desktop
renderer startup is 802,674/775,000 bytes, 83 bytes above the Phase 05 measurement of 802,591;
the cap is unchanged and the final branch gate must resolve the existing overage. Phase 07 may
build on the pinned comparison and scoped settings contracts. Phase 08 conflict resolution remains
deferred.
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
