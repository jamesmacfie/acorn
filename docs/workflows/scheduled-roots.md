# Scheduled roots

A published database workflow can run on a Node schedule. This page covers how the workflows plugin
binds to the core scheduler, what approval freezes, and how occurrences avoid overlap.

## Scheduled roots

The workflows plugin registers the `workflow` target with the node's scheduler. Core stores the
cadence, pause state, run ring, and timer policy. The plugin stores the approved workflow binding and
the occurrence ledger. No workflow-owned queue or timer runs beside the core scheduler.

Approval resolves a published definition in one project scope and freezes the complete graph, typed
inputs, limits, IANA timezone, generation, and processing epoch. It also pins published saved-query
revisions through the resolved graph. A timer or manual request reserves one occurrence with intended
root task and run IDs. Recovery reuses those IDs across `claimed`, `task-created`, and `run-started`
transitions.

The occurrence owns overlap until the root and every descendant are terminal. A gated descendant
therefore blocks a later timer or **Run now** request. Pausing the core schedule prevents timer
admission without cancelling the tree. Deleting it tombstones the workflow binding and retains all
task, run, occurrence, and record history.

Dispatch rechecks the published graph, repository trust, source metadata, connection authority, and
destination scope before it creates the task. A changed dependency or revoked authority moves the
schedule to `needs-review`. Temporary source failures retain the claimed occurrence for infrastructure
retry. A failed child is a workflow outcome and receives no automatic infrastructure retry.

For **Process current matches**, the first active occurrence applies ordinary repeat policy. For
**Track from now**, approval starts an inactive baseline occurrence. The persisted baseline flag makes
the processing transaction record identities, projections, and source continuation without reserving
child workflows. The schedule becomes active only after that root tree settles successfully. Zero
matches and all-skipped matches can still commit a continuation. An expired token or a changed query
returns the schedule to review for an explicit baseline or fresh epoch.

## Schedule a published workflow

**Schedule…** appears only for a published database workflow. It opens one shared-kit editor on both
hosts; cadence, timezone, project, and typed input values are schedule setup, not fields on a normal
workflow draft. The first review shows three concrete future checks with their timezone offsets,
effective execution limits, and whether the first check processes current matches or establishes a
baseline from now.

Record repeat handling appears only for `workflow-map` loops. **Run again when these fields change**
uses the same typed field picker as authoring. **Since the last completed check** appears only when
the source declares incremental continuation and the query feeds one unambiguous loop. Saving stores
a disabled Node draft; activation is a separate device-only action and is never queued while offline.

The workflows list gives schedules their own section and labels Active, Paused, Needs review, or
Unavailable. A changed published dependency retains the prior approved snapshot and processing
history, pauses admission, and links back to both activation review and the published workflow.
**Start fresh** is folded under advanced review and names the consequence that matching records may
run again. Pause stops future checks, **Run now** still works while paused, an active run opens its run
surface for cancellation, and deletion retains run and processing history.
