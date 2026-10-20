# Triggers

A trigger starts a published database workflow with nobody present. This page covers what a trigger
stores, what approval freezes, how occurrences avoid overlap, and how a trigger asks the owner for
review. Today a trigger's **When** has one kind, **On a schedule**, which the core scheduler times.

## The trigger

A trigger names one published workflow in one project, its typed inputs, its limits, its first check,
and its **When**. The workflows plugin stores triggers in `workflow_triggers`, with **When** as
`when_json`. A clock trigger's **When** is `{ "kind": "clock", "timezone": <IANA zone> }`. Its cadence,
pause state, and run ring live on the core scheduler row, whose target is `{ triggerId }`. Rows that
core stored before triggers keep `{ scheduleId }`, and the target still reads them. No workflow-owned
queue or timer runs beside the core scheduler.

Settings → Schedules lists that core row under the trigger's name, with **Open**, which opens the
workflow's page and its **Triggers** list.

The plugin's code splits by job, under `plugins/workflows/src/server/triggers/`:

| Module | Job |
| --- | --- |
| `approval.ts` | Resolves the published workflow, freezes what the owner approved, lists changes since then, and moves a trigger to **Needs review** |
| `occurrences.ts` | Reserves, resumes, settles, and reconciles occurrences |
| `clock.ts` | The clock kind: loop settings, the **Track from now** baseline, and one active occurrence per trigger |
| `service.ts` | Composes the parts for save, prepare, approve, pause, run now, delete, and views |

## Approval and occurrences

Approval resolves a published definition in one project scope and freezes the complete graph, typed
inputs, limits, generation, and processing epoch. It also pins published saved-query revisions through
the resolved graph. A timer or manual request reserves one occurrence in
`workflow_trigger_occurrences`, with intended root task and run IDs. Recovery reuses those IDs across
`claimed`, `task-created`, and `run-started` transitions.

Occurrences that share a trigger and an overlap key never run at once. A clock trigger's overlap key is
the trigger itself, and its `record_key` is empty. The occurrence owns overlap until the root and every
descendant are terminal, so a gated descendant blocks a later timer or **Run now** request. Pausing the
core schedule prevents timer admission without cancelling the tree. Deleting a trigger tombstones it
and keeps all task, run, occurrence, and record history.

A run a trigger started records `started_by = 'trigger'` and the trigger's ID in `trigger_id`. The run
pane names the trigger.

## Review and refusals

Dispatch rechecks the published graph, repository trust, source metadata, connection authority, and
destination scope before it creates the task, and again before it starts the run. A refusal only the
owner can fix arrives as a `WorkflowAuthorityError` with a reason (see
[refusals](./refusals.md#unattended-starts)). That moves the trigger to **Needs review** and blocks the
occurrence. A trigger whose reason is `connection-required`, `input-required`, or `missing` shows as
**Unavailable**, with a way to reconnect. Any other failure keeps the claimed occurrence for the
scheduler to retry. A failed child is a workflow outcome and gets no automatic retry.

Publishing a workflow or saved query that a trigger's frozen graph uses moves the trigger to **Needs
review**. Its approved snapshot and processing history stay.

For **Process current matches**, the first active occurrence applies ordinary repeat policy. For
**Track from now**, approval starts an inactive baseline occurrence. The persisted baseline flag makes
the processing transaction record identities, projections, and source continuation without reserving
child workflows. The trigger becomes active only after that root tree settles successfully. Zero
matches and all-skipped matches can still commit a continuation.

A source says it can't continue from a stored checkpoint by refusing the continued query with the data
source error `invalid-request`. The **Find records** step then fails with the cause
`checkpoint-expired`, stored in `workflow_runs.error_cause`, and the trigger returns to review for an
explicit baseline or fresh epoch.

## Add a trigger

**Add trigger…** appears only for a published database workflow. It opens one shared-kit dialog on both
hosts, which reads as "when, then what". **When** comes first, with **On a schedule** as its only
choice, then the cadence, the timezone, and the next three checks with their timezone offsets. Then
come the project and typed input values, which are trigger setup, not fields on a workflow draft. The
first review adds effective execution limits and whether the first check processes current matches or
establishes a baseline from now.

Record repeat handling appears only for `workflow-map` loops. **Run again when these fields change**
uses the same typed field picker as authoring. **Since the last completed check** appears only when
the source declares incremental continuation and the query feeds one unambiguous loop. Saving stores
a disabled Node draft. Activation is a separate device-only action and is never queued while offline.

The workflows list gives triggers their own **Triggers** section. Each row shows its **When** in one
line, such as "Daily at 09:00", and a state: Active, Paused, Needs review, or Unavailable. A changed
published dependency links back to both activation review and the published workflow. **Start fresh**
is folded under advanced review and names the consequence that matching records may run again. Pause
stops future checks, **Run now** still works while paused, an active run opens its run surface for
cancellation, and deletion keeps run and processing history.
