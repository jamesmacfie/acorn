# Triggers

A trigger starts a published database workflow with nobody present. This page covers what a trigger
stores, what approval freezes, how occurrences avoid overlap, and how a trigger asks the owner for
review. A trigger's **When** is **On a schedule** or **When records change**, and the core scheduler
times both.

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
| `records.ts` | The records kind: approval checks, the check, the preview, and match history. Loads on first use |
| `recordReader.ts` | Reads a record trigger's source in its project scope, as the owner. Loads on first use |
| `service.ts` | Composes the parts for save, prepare, approve, pause, run now, delete, views, and wakes |

## Approval and occurrences

Approval resolves a published definition in one project scope and freezes the complete graph, typed
inputs, limits, generation, and processing epoch. It also pins published saved-query revisions through
the resolved graph. A timer or manual request reserves one occurrence in
`workflow_trigger_occurrences`, with intended root task and run IDs. Recovery reuses those IDs across
`claimed`, `task-created`, and `run-started` transitions.

Occurrences that share a trigger and an overlap key never run at once. A clock trigger's overlap key is
the trigger itself, and its `record_key` is empty. A record trigger's is the record, so a slow run
never blocks another record. The occurrence owns overlap until the root and every
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
occurrence. A record trigger's run that stops on an agent step with checks off moves it there too, with
the reason `unguarded-agent`. A trigger whose reason is `connection-required`, `input-required`, or `missing` shows as
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

## Record triggers

A record trigger's **When** is `{ "kind": "records", "query", "change" }`. `query` is an inline or saved
query. `change` is `{ "on": "new" }`, `{ "on": "enters" }`, or `{ "on": "changes", "fields": [...] }`,
which the dialog calls **Is new**, **Starts matching**, and **Changes**. Pointers address the record
envelope `{ ref, data, display }`, as a For each loop's do, so a field of the data is `/data/<field>`.
Optional keys are `incremental`, `bindings` from input name to `{ "address": { "from": "item",
"pointer" } }`, `runsPerCheck` (10 at most, the default), and `runsPerDay` (50 at most, the default).
The cadence is a core `every` row, 5 minutes by default and never under a minute.

- **New** starts a run the first time a record matches, in this processing epoch.
- **Starts matching** starts a run when a record matches now and didn't after the last complete read.
- **Changes** starts a run when a matching record's watched fields differ from what the ledger kept.
  A record seen for the first time counts as changed.

The rules are `recordChangeDecision` in `packages/protocol/src/data/recordChanges.ts`, the same ones
a For each loop uses ([record history](./record-history.md)).

**Approval** describes the source, checks that `changes` names fields it describes, that only **New**
and **Changes** continue from a checkpoint, and only on a source that declares `incremental`, that
every binding names a declared input, and that every required input is bound, has a value, or is one
the item rule fills. It pins a saved query at its current revision in `approved_query_json`, with the
source it reads, and lists the trigger among that query's consumers. Changing the watched fields of an
approved trigger needs **Start fresh**, because the ledger keeps projections, not records.

**The check** reads the pinned query at the current time through every page, then decides each
record. In transactions of 500 records, with a turn for the Node's timers and sockets between them, it
updates `workflow_trigger_records`, keyed by trigger, epoch, and record, and reserves an occurrence of
kind `record` for each admitted record up to the caps. A last transaction marks records that stopped
matching and writes the checkpoint, only when no admitted record was left over. A record over a cap
stays undecided, so the next check sees it again. After the commits, each occurrence creates a root task titled
"Workflow · record title" with origin `workflows:trigger`, then starts its run. The check returns
"started N workflow runs", or nothing, which the run ring shows. A record whose run is still going
starts nothing. A check that finds nothing creates nothing.

How the read ends decides what the check may conclude. After a complete read, records not returned
are marked not matching, which lets **Starts matching** fire again. After a bounded or incomplete read,
or an incremental one, only returned records are decided, and the trigger shows "Last check read part
of the results" with the source's reason. A refused connection, an expired checkpoint, or a query that
changed since its checkpoint moves the trigger to **Needs review**. Any other failure is the
scheduler's backoff.

**Track from now** needs no baseline run. Approval runs the check in place, writing the ledger and
starting nothing, and the trigger becomes active when that commits.

**Guards.** A trigger never admits its own work read back as a record: a run in a tree it started,
through the Workflow runs source, or the task it made for a run, through core's Tasks source. At the
daily cap the trigger moves to **Needs review** with "Started 50 runs today. Review the trigger before
it starts more.", after starting what fit in that check. Re-approval starts a new day's count.

**Tasks an agent made.** An agent can create a task in its own project, and the Node stamps it with
`createdByTask`. A person's task has no such field. A trigger on core's Tasks source that doesn't hold
`createdByTask` to **is missing** could start a workflow on text an agent wrote, so the approval sheet
warns "Agents can create tasks this trigger would match" until the query excludes them.

**Agent steps.** A record's fields reach the workflow's agent steps as inputs, and the people who
write those records may not be you. Under an autonomous posture, the agents plugin refuses a step whose
session runs commands with no sandbox and no approval, such as Claude Code's `bypassPermissions` or
Codex's `:danger-full-access` (`unguardedSetting` in `plugins/agents/src/shared/unguardedCommands.ts`).
For a record trigger's run, the refusal fails the step with the reason `unguarded-agent`. The step's
name and the mode are in the message, and the trigger moves to **Needs review**. Approving it with
**Let agent steps run commands without asking** ticked (`allowUnguardedAgents` in the trigger's limits,
frozen with the rest of the approval) lets those runs go ahead. Clock triggers and **Run now** have no
outside records and are never refused. The approval sheet shows the box for a record trigger whose
workflow has an agent step, with a line saying where the records come from when the source can say.

Nothing in Acorn's own session defaults decides the mode of a step. A workflow session skips the
owner's saved and last-used values, so the mode is the one the step asks for in `config_options`, and
failing that the one the harness starts in: Claude Code's `permissions.defaultMode` in the account's
settings, or Codex's active permission profile. The check reads the mode after the step's
`config_options` are applied and before the first turn is queued. A child workflow's agent steps follow
the root run's trigger, but the run that records `unguarded-agent` is the child's, so the trigger moves
to **Needs review** only when the refused step is in the root workflow. The runs still fail either way.

**Inputs.** Each record's inputs are the item rule from **Start workflow…**
([starting runs](./starting-runs.md#starting-a-run)) for the names the workflow declares, then the
owner's values, then the trigger's bindings. Graph resolution at approval leaves the inputs a record
fills unchecked, and the check validates each record's values against the workflow's inputs. A record
that fails gets a blocked occurrence whose reason names the record and the input, and the other
records go on.

**Hearing changes.** On `data-source:changed`, the service calls `wake(key, { minGapMs: 15_000 })` for
each active record trigger whose pinned source matches ([say when records changed](../data-sources/changes.md)).
It reads the trigger rows on each event rather than keeping an index, so there is nothing to rebuild
when a trigger is approved, paused, or deleted. A paused trigger's wake does nothing.

## Add a trigger

**Add trigger…** appears only for a published database workflow. It opens one shared-kit dialog on both
hosts, which reads as "when, then what". **When** comes first. **On a schedule** shows the cadence,
the timezone, and the next three checks with their timezone offsets. **When records change** shows
**Records from**, the shared query editor, then **Start a run when a record**, its watched fields,
**Check every**, **Read**, **Most runs a check**, and **Preview matches**, which lists up to 20 records
and says which ones **Process current matches** would start. Each input then reads **From the record**,
with a field picker, or **Value**. A record trigger's dialog shows its last check and its last 50
matches, each opening its run. The kind can't change after the first save. Then
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
