# Phase 4: record triggers

Date: October 20, 2026. Status: built on branch `phase-4-record-triggers`, not merged. Needs phases 2
and 3.

## Completion note

Built October 21, 2026. A trigger's **When** can be **When records change**. Each record that's new,
starts matching, or changes gets its own task and run, a check that finds nothing creates nothing, and
a slow run never blocks another record. [Triggers](../../workflows/triggers.md#record-triggers) is the
reference.

### What landed

- **Shared rules.** `packages/protocol/src/data/recordChanges.ts` holds `recordIdentity`,
  `recordChangeFields`, `recordProjection`, and `recordChangeDecision`, exported as
  `@acorn/protocol/recordChanges.ts`. The workflows plugin's own rules module is gone, and the processing store,
  loop validation, and binding validation import the shared module. The decision adds `enters`, and
  `previous` gains optional `matching` and an optional `snapshot`. `WorkflowRepeatPolicy` narrows the
  policy to a loop's three modes. The old rules test moved to `recordChanges.test.ts` with `enters`
  cases. The processing tests pass unchanged.
- **Storage.** Migration `0006_record_triggers` adds `workflow_trigger_records`, keyed by trigger,
  epoch, and record, and four trigger columns: `approved_query_json`, `boundary_json`,
  `query_fingerprint`, and `last_check_json`.
- **The kind.** `WorkflowTriggerWhen` is a union of the clock and `WorkflowRecordsWhen`, which holds
  `query`, `change`, and optional `incremental`, `bindings`, `runsPerCheck`, and `runsPerDay`. The
  route accepts it, with the caps limited to their defaults, 10 and 50.
- **Modules.** `server/triggers/records.ts` holds the approval checks, the check, the Track from now
  baseline, the preview, and match history. `recordReader.ts` reads the source in the project's scope.
  Both load on first use. `service.ts` routes a record trigger's dispatch, approval, preview, detail,
  and delete to them, and `heard` wakes triggers on `data-source:changed`.
- **Occurrences.** `TriggerOccurrences.reserveIn` reserves inside the check's transaction. A request
  can carry its own inputs, its record, and a blocked reason. A record occurrence's task is titled
  "Workflow · record title" with origin `workflows:trigger`.
- **Inputs.** `prefillFromItem` in `contract/itemInputs.ts` is the one rule. With a record it fills
  `record`, `item`, `issue`, `context`, `link`, and `url`. **Start workflow…** uses it, and
  `prefillFromRecord` is gone. A record's inputs are that rule, then the owner's values, then the
  trigger's bindings.
- **Approval.** Graph resolution takes `deferredInputs`, the inputs a record fills, so a required one
  isn't refused at approval. The approved graph keeps its real `required` flags, so the check and the
  run start both enforce them. A record trigger stores only the owner's values in `inputs_json`,
  because a frozen default would hide what the record fills.
- **Client.** **When records change** in the dialog, with the shared query editor, the change rule,
  watched fields, **Check every**, **Read**, **Most runs a check**, **Preview matches**, per-input
  **From the record** or **Value**, the last check, and the last 50 matches. `RecordsWhen.tsx` holds
  the records parts. The **Triggers** list says "Every 5 minutes, when a record is new".
- **Docs.** Triggers, starting runs, record history, refusals, workflow routes, say when records
  changed, and the future index. On the site, **Start and schedule runs** gains **Run a workflow
  when records change**, and the Workflows plugin page names record triggers.
- **Tests.** `records.test.ts` covers new, starts matching, changes, stopping and starting again, a
  partial read, the per-check cap over three checks, a crash between the commit and the task, Track
  from now, overlap for one record, the loop guard for runs and for tasks, the daily cap, a republished saved query, an input
  that fails its type, and the wake. `RecordsWhen.test.tsx` draws the preview and the history.

### Decisions and deviations

- **No change index.** `heard` reads the trigger rows on each `data-source:changed` event instead of
  keeping an index rebuilt on approve, pause, and delete. Core sends at most one event a second per
  source, the table is small, and a read can't go stale. A paused trigger's wake does nothing, because
  the scheduler ignores a wake for a disabled job.
- **A pinned query, in its own column.** Each check resolves the pinned reference at the check's time,
  so a relative time window moves with the clock. A saved query is pinned at the revision it resolved
  to at approval. `approved_query_json` also keeps the source it reads, which the wakes match on,
  because a saved reference doesn't name its source.
- **No stable-ID check.** Every record already needs a `recordId`, and no source declares whether its
  IDs are stable. Approval checks the other three things the phase names.
- **Changing watched fields needs Start fresh.** The ledger keeps projections, not records, so it
  can't reproject a newly watched field. Approval says so.
- **Record occurrences leave `due_at` empty.** That keeps them clear of the per-instant unique index,
  which still holds a clock trigger to one occurrence per due instant. No index change.
- **Overlap reads the occurrence ledger.** A record is active when any occurrence for its key is
  still running, whatever epoch started it, so Start fresh doesn't run a record twice at once.
- **Caps.** The daily count is the last 24 hours of this generation's started occurrences, so
  re-approval starts a new count. The review happens after the check starts what fit, because review
  blocks an occurrence that hasn't started.
- **The loop guard covers tasks too.** A trigger's own run reaches it two ways: as a run through the
  Workflow runs source, and as the task it made for the run through core's Tasks source. That task is
  titled after its record, so it usually matches the same filter. The check and the preview skip both.
  A loop between two triggers is still the daily cap's job, as the phase says.
- **A record trigger can be approved while its runs work.** Only a clock trigger waits for its active
  run. A claimed occurrence from the old approval is blocked at resume, as before.
- **Consumer kind `schedule`.** The saved-query consumer kinds are `panel`, `workflow`, and
  `schedule`, and nothing used `schedule`. A trigger registers as one, linking to its workflow's page,
  which avoids a wire change.
- **Kind is fixed after the first save.** The dialog disables **When** for a saved trigger.
- **The legacy `/workflows/schedules` alias** mounts `/preview` too, and adds an empty `timezone` to
  a record trigger it returns. A client built before triggers has no way to make one.

### Checked in the app

On a `pnpm dev:agent` session, launched with `--prepared` because the service size check is red, and
driven through the Node's routes from the window: a published workflow with a typed `issue` input, a
**New** trigger on core **Tasks** whose title contains "triage", **Preview matches**, and approval. A
task titled "triage the login bug" was created at 21:30:27 UTC, and the trigger started one run at
21:30:28 in its own task, "Triage follow-up · triage the login bug", with origin `workflows:trigger`,
`started_by = trigger`, and the task's title in `issue`. Over the next minutes it started nothing
else. The **Triggers** list read "Every 5 minutes, when a record is new", and the dialog drew **When
records change**, the inputs as **From the record**, "Last checked … Read every match.", the match,
and the preview's "Process current matches would start …" line.

That check found a loop the unit tests missed, fixed below: on a first session, renaming a task under
a **Changes** trigger beside the **New** one started 12 runs in under a minute, because each run's task
title also contains "triage".

Not checked live: the Workflow runs case, which needs a failed run, the five-task cap, which needs five
task branches in this repository, and the terminal client. `records.test.ts` covers the first two, and
the dialog is the shared kit one the terminal client draws.

### For later phases

- **Phase 5.** The test kit can call `recordChangeDecision` from `@acorn/protocol/recordChanges.ts`.
  A suggested trigger is a `WorkflowRecordsWhen` without bindings. `TriggerRecordReader` is the seam
  a test helper would fake, as `triggers/test/triggerHarness.ts` does.
- **Phase 6.** Only GitHub, Workflows, Agents, and core call `changed`, so other sources' record
  triggers fire on their cadence alone.
- **Service size.** The Node's static graph is 1,923,592 bytes on this branch, against 1,918,423 on
  the base, 5,169 more and 3,892 over the 1,919,700 ceiling. The ceiling isn't raised here. Most of it
  is the service's record paths, the shared rules module, the route's schema for the records kind, and
  the ledger table. The check, the reader, the preview, the item-input rule, and match history load on
  first use.

## Goal

A trigger can start a workflow **When records change**. The owner picks a source and a filter, says
whether a record that's new, starts matching, or changes should start a run, and binds the record to
the workflow's inputs. Each match gets its own task and run. A check that finds nothing creates
nothing, and a slow run never blocks the next match.

## Starting point

- After phase 2, `server/triggers/` has `approval.ts`, `occurrences.ts`, `clock.ts`, and a
  composition `service.ts`. `when` is a union with one member, `clock`. Occurrences take an overlap key
  and have a nullable `record_key`.
- After phase 3, `data-source:changed` exists and the scheduler has `wake`.
- The record-change rules were in the workflows plugin's `server/processing/rules.ts`:
  `workflowRecordIdentity`, `processingProjection`, and `processingDecision`, over the repeat modes
  `every-match`, `unseen`, and `changed`.
- **Find records** freezes a resolved query with its evaluation time before it reads, and refuses a
  read that's neither `complete` nor `bounded` (`server/steps/data.ts`). Incremental continuation and
  its checkpoint rules are in `server/processing/incremental.ts`.
- A saved query reports republishing to the consumers registered with
  `ctx.dataSources.setQueryConsumer`, and the publication service moves affected triggers to
  **Needs review**.
- Filling a workflow's inputs from a record is split between `contract/itemInputs.ts`
  (`prefillFromItem`) and `client/startFromItem.ts` (`prefillFromRecord`). When a row carries a
  record, `item` is the record's data and overrides the title-and-body string.
- `SourceQueryEditor` and `TypedBindingPicker` from `@acorn/plugin-api/ui/data-sources` edit a query
  and a typed binding on both hosts. The loop settings in the trigger dialog already pick tracked
  fields.

## The design

### Shared change rules

Move identity, projection, and the decision into `packages/protocol/src/data/recordChanges.ts` (new), so the
Node, the editor's preview, and the plugin test kit in phase 5 use one implementation. The processing
store imports them, and **For each** behaves exactly as before.

The decision gains the trigger's three rules. `new` is today's `unseen`, and `changes` is today's
`changed`. `enters` is added: a record that matches now and wasn't matching after the last complete
read. Loops keep their own three modes, and the type says which modes each consumer accepts.

### The kind

```ts
type RecordsWhen = {
  kind: 'records'
  query: QueryReference // inline, or a saved query
  change: { on: 'new' } | { on: 'enters' } | { on: 'changes'; fields: string[] }
}
```

The cadence stays on the core scheduler row, as for a clock trigger. The default is every 5 minutes
and the floor is 1 minute (decision 3 in the [README](./README.md)).

Approval resolves the query in the trigger's project scope, freezes it with the source's revision,
and registers the trigger as a consumer of a saved query. It checks that the source has stable record
IDs, that `changes` names fields the source describes, and that every required workflow input is
bound.

`enters` needs to know what stopped matching, so it needs a complete read every check. The editor
says so, and offers incremental reads only for `new` and `changes`, and only when the source declares
`incremental`.

### The record ledger

A new table, `workflow_trigger_records`:

| Column | Holds |
| --- | --- |
| `trigger_id`, `epoch`, `record_key` | Which trigger, which processing epoch, and which record |
| `projection` | The tracked fields as the decision last kept them |
| `matching` | Whether the record matched after the last read that could tell |
| `first_seen_at`, `last_seen_at` | When the trigger first and last saw it |
| `last_occurrence_id` | The occurrence it last started, if any |

The trigger row gains `boundary_json` and `query_fingerprint` for an incremental source's checkpoint.
**Start fresh** in the review starts a new epoch, as it does for loops today.

### The check

The scheduler target runs one check:

1. Read the frozen query in execution mode at the current time, through every page.
2. Decide each returned record with the shared rules. A record whose last occurrence is still
   running is `active` and starts nothing.
3. In one transaction, update the ledger, reserve an occurrence for each admitted record up to the
   per-check cap, and commit the incremental boundary only if every admitted record got an
   occurrence. A record over the cap stays undecided, so the next check sees it again.
4. After the commit, resume each occurrence through `occurrences.ts`: create a root task titled
   "Workflow name · record title" with the origin `workflows:trigger`, then start the run.
5. Return "started N" or nothing, which the scheduler shows in the run ring.

How a read ends decides what the check may conclude:

- **Complete.** Records not returned are marked not matching. That's what lets `enters` fire again
  later.
- **Bounded or incomplete.** Only returned records are decided, and nothing is marked as having
  stopped matching. The trigger shows "Last check read part of the results" with the source's own
  reason, such as GitHub's 250-match search limit.
- **Failed.** The scheduler's backoff applies. An expired checkpoint or a refused connection moves
  the trigger to **Needs review**, through the typed errors from phase 2.

The first check after approval follows `firstCheck`. **Process current matches** decides as usual.
**Track from now** writes the ledger and starts nothing. It needs no baseline run, unlike a clock
trigger, so approval runs it in place and the trigger becomes active when it commits.

### Guards

- **Per check and per day.** At most 10 runs a check and 50 a day by default (decision 2). At the
  daily cap, the trigger moves to **Needs review** with "Started 50 runs today. Review the trigger
  before it starts more."
- **Its own runs.** A trigger over the Workflow runs source never admits a run that it started. The
  daily cap covers longer loops through other sources, such as a workflow that files a Linear issue
  that starts the same workflow.

### Inputs from the record

One function in `contract/itemInputs.ts`, used by **Start workflow…** and by the check:

- `record` gets the record envelope: `ref`, `data`, and `display`.
- `item` gets the record's data.
- `issue` and `context` get the display title. `link` and `url` get the display link.
- `prefillFromItem` keeps the title-and-body rule for a row that has no record.

A trigger's own bindings come first. Each input is a literal or `{ from: 'item', pointer }`, the
binding **For each** already uses. The check validates each bound value against the input's schema.
A value that fails blocks that occurrence with a reason that names the input and the record, and the
other records go on.

### Hearing changes

The trigger service keeps an index from `pluginId:sourceId` to the scheduler keys of active record
triggers that read it, rebuilt when a trigger is approved, paused, or deleted. On
`data-source:changed`, it calls `wake(key, { minGapMs: 15_000 })` for each.

### What the person sees

In the trigger dialog, **When** gains **When records change**:

- **Records from** picks a source and builds the filter with `SourceQueryEditor`, or picks a saved
  query.
- **Start a run when a record** is new, starts matching, or changes, with a field picker for
  changes.
- **Check every** sets the cadence.
- **Inputs** shows each workflow input with **From the record** (a field picker) or **Value**.
- **Matches now** previews up to 20 records the filter returns, with what the first check would do
  under **Process current matches** and under **Track from now**.

The trigger's page lists its last 50 matches with the record title, why it started (new, started
matching, or changed), and the run's status, each linking to its run. It also shows the last check's
time and whether it read everything.

### The Node service budget

The check, the ledger code, and the preview route load on first use. The only code at boot is the
target registration and the change index.

## Steps

1. Move the change rules to `@acorn/protocol`, add `enters`, and keep the processing tests passing
   unchanged.
2. Add the ledger table, the trigger columns, and the `records` kind to `when`.
3. Write the check in `server/triggers/records.ts`, with the guards and the read outcomes.
4. Merge the inputs rule into `contract/itemInputs.ts`, and move **Start workflow…** onto it.
5. Add the change index and the wakes.
6. Add the dialog section, the preview route, and the trigger's match history on both hosts.
7. Document triggers in `docs/workflows/triggers.md` (new from phase 2), and update
   [starting runs](../../workflows/starting-runs.md), [record history](../../workflows/record-history.md),
   and [refusals](../../workflows/refusals.md).

## Acceptance

Tests cover each rule: new, starts matching, changes, a record that stops and starts matching again,
a bounded read, the cap with a later check picking up the rest, a crash between the commit and the
task, **Track from now**, overlap for one record, the loop guard, the daily cap, a republished saved
query, and an input that fails its schema.

In `pnpm dev:agent`, with sources that need no account:

- A trigger on core **Tasks** whose title contains "triage", set to **New**, starts a workflow within
  seconds of creating such a task, in its own task, with the task's title in the `issue` input.
- A trigger on **Workflow runs** with status `failed`, set to **Starts matching**, starts a follow-up
  workflow when a run fails, and doesn't start one for its own runs.
- Five tasks created at once with a per-check cap of 2 start five runs over three checks.
- The same trigger edits, previews, and approves in `pnpm dev:tui:agent`.
