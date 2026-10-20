# Phase 4: record triggers

Date: October 20, 2026. Status: proposed. Needs phases 2 and 3.

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
- The record-change rules are in `plugins/workflows/src/server/processing/rules.ts`:
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
