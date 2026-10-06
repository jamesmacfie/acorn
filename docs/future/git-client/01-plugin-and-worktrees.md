# Phase 01: plugin and worktrees

Date: October 7, 2026. Status: planned; implementation not started. Dependencies: none.
Read the [full implementation context](./README.md), especially
[source ownership](./README.md#source-baseline-and-ownership),
[the two surfaces](./README.md#two-surfaces), and
[mutation contracts](./README.md#mutation-contracts). It owns the decisions for this phase.

## Deliverable

A person opens **Git > Worktrees** for the selected project, inspects a registered worktree and its
task ownership, opens its task, and safely removes an eligible unowned worktree. A separate Git task
pane shows that task's checkout identity and links to the repository source. Both hosts support it.

## Steps

1. Recheck the baseline and external worktree plugin. Record differences in roster, ownership,
   status reads, path normalization, archive behavior, and cleanup policy before adapting code.
2. Create the compiled `git` plugin package, thin Node/client entrypoints, shared typed wire
   contracts, and focused repository/worktree modules. Register it in Node, desktop, and terminal
   rosters and app dependencies through the public plugin API. Keep the external plugin installed
   until phase 04 acceptance.
3. Register the project-scoped Git source with host list/detail regions and routes. Register a
   task Git pane with a host-owned model/layout. Use the kit for navigation and item lists. Hide or
   explain the source on non-Git projects without changing other source selection.
4. Resolve mapped project roots on the Node and read the NUL-delimited Git worktree roster. Return
   branch/HEAD, main/locked/prunable state, last commit, bounded changed-file summaries, task
   ownership, errors, and observation identity. Canonicalize path identity and deduplicate aliased
   projects; preserve missing registrations as readable rows.
5. Implement paired-device cleanup with a fresh roster and ownership check. Offer archive/open
   navigation for task-owned worktrees. Refuse main, locked, dirty, or newly owned worktrees. Check
   every affected record before repository-wide prune; report Git refusal without treating it as
   a successful removal.
6. Add Node-qualified query keys, explicit refresh, reconnect/event invalidation, and cancellation
   on route or Node changes. Render empty, stale, truncated, missing-checkout, and failure states.
7. Update roster/route/facade goldens only where the contribution changes their expected surface.
   Add the owning feature documentation when this slice ships.

## Acceptance

- Real repository tests cover main, branchless/detached, locked, missing, dirty, and clean worktrees;
  task ownership; two project aliases; unusual path characters; and ownership changing after read.
- A paired device can clean up an eligible worktree. Task credentials and arbitrary paths are
  refused. Cleanup cannot remove task-owned or main checkout data.
- Desktop and terminal demonstrate project switching, navigation, task opening, failure feedback,
  keyboard menus, and cleanup in a disposable fixture.
- Run the [verification gates](./README.md#verification-strategy) for the plugin, its three app
  consumers, public API changes, and architecture. Record dated results before phase 02.

## Verify before building

- Recheck source/pane registration shapes and the terminal UI facade against the chosen baseline.
- Confirm cleanup and archive semantics with core rather than importing its private worktree code.
- Confirm Node runtime and task setup readiness before running fixture-dependent tests.
