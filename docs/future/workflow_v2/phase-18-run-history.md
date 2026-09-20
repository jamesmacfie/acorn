# Slice 18: Record-first history and collapsed task navigation

Date: 2026-09-13. Status: implementation complete; acceptance gap recorded below.

Read [context and decisions](./context.md) first, then the owning
[contract or UX reference](./ux-running.md) and [verification](./verification.md).
The [programme index](./README.md) links every related contract and implementation slice.
Prerequisites: 08, 09, 13, 16. Do not start dependent work until those slices' acceptance checks pass.

## Outcome

A 500-record run remains navigable, with failed/skipped/gated rows and nested tasks accessible from the root.

## Work

1. Add paged run-record and attempt-history routes/projections, including query completeness/provenance and bounded named outputs.
2. Render progress and record table with stable selection, filters, and expandable detail rather than a card per descendant.
3. Add retry/reprocess distinctions and root/parent/record return navigation.
4. Collapse workflow children under their root in ordinary task navigation with aggregated attention; reveal only the ancestor path when a child is opened.
5. Retain ordinary individual archive actions and handle archived/missing task links without losing run history.

## Boundaries

Implement this slice within its owning runtime and public contribution/capability seams. Keep pure
rules separate from I/O and UI state. Preserve unrelated behavior and worktree edits. Do not widen
scope to exclusions in [refused alternatives](./refused.md). Update the owning reference docs when
this slice exposes shipped behavior, and keep the programme status accurate during gated rollout.

## Verification

Test zero matches vs all skipped, completed-with-failures, gated child with active siblings, explicit retry retaining identities, cancelled unstarted work, disconnected stale state, 500-row rendering, focus restoration, and manual task ordering.

Run `pnpm lint` and the relevant owning-package tests before handoff. Include architecture tests
when public exports, plugin contracts, or runtime boundaries change. Follow the real-window checks
for UI changes. Record actual evidence rather than copying expected results into a completion claim.

## Evidence

The processing read model now pages at most 100 rows and keeps record bodies and named outputs behind
the selected-record route. It reports source provenance, completeness, progress counts, and distinct
zero-match/all-skipped states. Attempt pages use opaque cursors and bounded result, error, and output
previews. The record table is virtual, retains its loaded window and selection across event refreshes,
and separates exact-attempt retry from reviewed reprocess. Reprocess creates an idempotent independent
root attempt from the server-retained snapshot; it does not query the source or restart successful
siblings.

Workflow-created tasks carry an explicit origin. Desktop and terminal rails collapse those descendants
under the ordinary root task, retain manual siblings and their persisted order, expose a disclosure
count, and reveal only the active descendant's ancestor path. The workflows plugin supplies aggregate
running/attention markers through the existing rail-marker seam. Tasks still use the ordinary
individual archive action; no group or automatic archive was added. Missing task links leave the
retained record and attempt history readable.

Verification commands:

- `rtk pnpm lint`: all 33 package tasks passed. Existing oxlint warnings and sandbox cache-write
  warnings remain nonfatal.
- `rtk pnpm --filter @acorn/plugin-workflows test src/server/workflowProcessingReadModel.test.ts src/server/workflowProcessingStore.test.ts src/server/workflowRunProjection.test.ts src/server/workflowDispatch.test.ts src/server/routes/workflow.test.ts src/client/runs/recordHistoryModel.test.ts src/client/runs/runStore.test.ts src/server/workflowMapLifecycle.test.ts src/server/workflowNestedDispatch.test.ts src/server/workflowChildLifecycle.test.ts`: 95 tests passed. The 500-row case covers bounded pages, lazy bodies, output bounds, provenance, no matches versus all skipped, mixed status counts, disconnected cache retention, retry identity, reprocess replay, gated siblings, mixed failure, and cancelled unstarted work.
- `rtk pnpm --filter @acorn/client-core test src/features/tasks/taskHierarchy.test.ts src/features/tabs/TabRail.test.tsx`: 15 tests passed, including ancestor-only reveal, manual ordering with hidden descendants, and collapse restoration.
- `rtk pnpm --filter @acorn/node-core test src/server/core/tasks.test.ts`: 10 tests passed, including workflow child-origin persistence and replay validation.
- `rtk pnpm --filter @acorn/tui test src/chrome/chrome.test.tsx`: 22 tests passed. A terminal-host fixture with 500 workflow descendants stays collapsed and bounded, expands on demand, and restores the manual sibling after collapse.
- `rtk pnpm --filter @acorn/tui capture notes`: the production terminal bundle built 838 modules and rendered a complete 80-column shell frame.
- `rtk pnpm --filter @acorn/plugin-api test`: 12 tests passed; workflow aggregates use the existing owner-bound `ctx.railMarkers` seam.
- `rtk pnpm --filter @acorn/arch-tests test`: 63 tests passed.

The real Tauri window used isolated session `workflow-v2-phase18` with 500 retained skipped rows, a
three-level workflow task group, and a manual sibling. The collapsed and expanded task rail and the
retained recent run were verified and captured as `phase18-task-tree-collapsed.png`,
`phase18-task-tree-expanded.png`, and `phase18-recent-run.png`. The session was stopped. Directly
seeding the stopped session's databases did not invalidate the renderer's task-to-run availability
cache, so its existing window would not offer the run pane; native computer-use also timed out. The
record table itself is therefore covered by the read-model, client-model, route, and host-kit tests,
but still needs a real-window pass from a run created through the live application. Disconnected stale
copy and the complete narrow record-table journey remain slice-20 acceptance checks.

## Verify before building

Read current task hierarchy and run projection/event code. Preserve unrelated task drag ordering and lifecycle changes; do not add automatic or group archive behavior.
