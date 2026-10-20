# Phase 2: one trigger model

Date: October 20, 2026. Status: built on branch `phase-2-one-trigger-model`, not merged. Needs phase 1.

## Completion note

Built October 21, 2026. Workflow schedules are triggers whose **When** is **On a schedule**. The
tables, the service, the routes, the shared types, the run start, and the dialog all use the trigger
shape, and every approved schedule keeps its ID, its core scheduler row, and its history.

### What landed

- **Storage.** Migration `0005_triggers` copies `workflow_schedules` into `workflow_triggers` and
  `workflow_schedule_occurrences` into `workflow_trigger_occurrences`, then drops the old tables.
  `when_json` is filled with `{ "kind": "clock", "timezone": <timezone> }`, and `timezone` goes.
  Occurrences gain a nullable `record_key`. The migration rewrites `started_by = 'schedule'` to
  `trigger`, fills `workflow_runs.trigger_id` from the ledger, and adds `workflow_runs.error_cause`
  and `workflow_triggers.error_reason`. `src/server/triggers/migration.test.ts` replays the chain to
  `0004`, seeds two schedules, occurrences in every state, loop settings, and processing scopes, and
  checks each one after `0005`.
- **Modules.** `server/triggers/` holds `approval.ts` (181 lines), `occurrences.ts` (250), `clock.ts`
  (295), `service.ts` (274), `readModel.ts` (92), `limits.ts` (65), and `activation.ts`. Imports run
  one way: the service composes the rest, approval reads the clock's loop settings, and the occurrence
  ledger reaches approval and the kind only through callbacks. The old `service.test.ts` cases moved,
  assertions intact, to `occurrences.test.ts`, `approval.test.ts`, `clockRuns.test.ts`, and
  `service.test.ts`, over a shared harness in `triggers/test/triggerHarness.ts`. `model.test.ts` is
  `clock.test.ts`.
- **Typed errors.** `WorkflowAuthorityError` lives in `server/runs/authority.ts`.
  `WorkflowStartService.prepareInvocation` and `startTriggered` throw it, and `asAuthorityError`
  turns a data-source `code` of `forbidden`, `connection-required`, or `input-required`, and the repo
  trust error, into it. The occurrence ledger checks the type. A **Find records** step that continues
  from a checkpoint and gets `invalid-request` fails with the cause `checkpoint-expired`, carried
  through `finishRun` to `workflow_runs.error_cause`, and `settleClockRun` reads it. No module under
  `server/triggers/` matches error text.
- **Routes and types.** `/workflows/triggers` with the same nine operations, `WORKFLOW_TRIGGERS_ROUTE`,
  and `shared/workflowTriggers.ts`. The scheduler target kind is still `workflow`, with target
  `{ triggerId }`. `parseWorkflowTriggerTarget` also reads `{ scheduleId }`, under a `shortcut:`
  comment.
- **Runs.** `startScheduled` is `startTriggered`, which records `startedBy: 'trigger'` and
  `triggerId`. The run projection carries `triggeredBy`, and the run pane footer says "Started by a
  trigger" with **Open trigger**, which opens the workflow's page.
- **Client.** `client/triggers/` holds `TriggerDialog`, `triggerModel`, and `triggerRequest`. The dialog
  opens with a **When** section, then **Then start <workflow>** with the project and inputs. The list
  section is **Triggers**, and each row's meta line is its **When**, such as "Daily at 09:00". The editor
  offers **Add trigger…**.
- **Settings → Schedules.** A scheduler target may declare `opens(target)`, and `ScheduleRow.opens`
  carries it. The settings row shows **Open** when it's set. A trigger's row opens its workflow's page.
  The row's name is the trigger's name, "<workflow> trigger" for new saves. **Open** sends a new
  `presentation:close-settings` client event, which the desktop shell answers by closing Settings, and
  then the existing `presentation:open-link`.
- **Docs.** `docs/workflows/triggers.md` replaces `scheduled-roots.md`. User schedules, workflow routes,
  refusals (new § Unattended starts), the workflows overview, authoring, execution, record history,
  definitions, routes and UI, and the site's start-and-schedule-runs, schedules, and settings pages.

### Checked in the app

On a `pnpm dev:agent` session, launched with `--prepared` because the service budget is red: **Add
trigger…** opens the dialog with **When** first; **Review activation**, **Activate**, and **Run now**
start a run recorded as `started_by = trigger` with its `trigger_id`; the **Triggers** section shows
"Nightly check · Daily at 09:00 · Active"; republishing moves it to **Needs review** with the old
wording, and **Approve changes** restores it; **Pause** shows **Paused**; Settings → Schedules lists
"Nightly check trigger" with **Open**, which closes Settings and shows the workflow page; the run pane's
**Open trigger** does the same; **Delete trigger** leaves a tombstone, the occurrence, and the run, and
removes core's row; `GET /workflows/schedules` answers with `timezone`.

Not checked live: a session seeded with a pre-migration database, a **Track from now** baseline that
spans the upgrade, and the terminal client. The migration test covers the seeded upgrade, including a
baseline occurrence in `run-started` that keeps its `baseline` kind and request key, and the dialog is
the shared kit one the terminal client already drew.

### Decisions and deviations

- **The old path stays for 90 days, not one release.** v0.0.2 shipped clients that call
  `/workflows/schedules`, and a standalone Node can be upgraded alone. The repo's rule is the 90-day
  mixed-build window ([versioning](../../api-reference/versioning.md#mixed-builds)), so the alias is
  marked `Mixed-version path until 2027-01-19.` It reads a draft's `timezone` as a clock `when` and
  adds `timezone` to each trigger it returns. After that date, delete `legacyWorkflowScheduleRoutes`,
  `legacyTimezone`, and their registration, and add removal lines to `routeRegistry.removals.txt`.
- **Copy, not rename.** The migration builds the new tables and copies rows, the SQLite way to rename
  a table, drop a column, and rename index names in one step. IDs don't change.
- **Two stored strings keep the old word.** Each occurrence's payload fingerprint was made with the key
  `scheduleId`, and each started run's invocation key starts `schedule:`. Renaming either would make a
  replay after the upgrade look like a different request and refuse it. The task seed's
  `workflows:schedule` origin and "· scheduled" title stay for the same reason, since core refuses to
  replay an intended task with a different seed.
- **The republish message is unchanged.** It still says "Review this schedule before it runs again",
  because the acceptance asks for the same wording.
- **Unavailable reads a stored reason.** The read model's regex for **Unavailable** went too. A
  trigger shows **Unavailable** when its scheduler row isn't registered or its `error_reason` is
  `connection-required`, `input-required`, or `missing`. A row moved to review before this phase has
  no reason, so it shows **Needs review** until it's next checked. The owner's Node has no schedules.
- **Unpublished workflows now ask for review.** A workflow that lost its published revision used to
  fail with "could not be resolved", which no regex caught, so the scheduler retried it forever.
  `prepareInvocation` now checks publication first and throws `not-published`.
- **A loop setting that no longer applies is `missing`.** "A configured record loop no longer exists"
  matched the old regex. The typed version keeps that behavior.
- **What counts as an expired checkpoint is new.** No source implements incremental reads yet, and
  the protocol has no code for it. A continued query refused with `invalid-request` is the rule, which
  `docs/workflows/triggers.md` states for source authors. Only the run whose step failed gets the
  cause, so a checkpoint that expires inside a child workflow doesn't reach the root trigger. The old
  regex only saw that case when the child's text reached the root's error.
- **The project trust error is wrapped.** Core's `assertProjectConfigTrusted` throws a plain error.
  `prepareInvocation` turns any rejection from it into `untrusted`, after checking the project exists.
  Its message now says "before this trigger can start a run".
- **The run pane opens the workflow, not the dialog.** The trigger dialog's host is mounted only in the
  Workflows list, so **Open trigger** and the settings row's **Open** both go to the workflow's page,
  where the **Triggers** section lists it.
- **The When field is a one-choice select.** It does nothing yet. Phase 4 adds **When records change**
  to its options.

### For later phases

- **Phase 4.** Add the records kind to `WorkflowTriggerWhen` and `clockWhen`'s neighbour in `clock.ts`.
  `TriggerOccurrences.reserve` already takes a `recordKey` and keeps overlap per trigger and record
  key. Two things need changing for many occurrences per tick: the unique index
  `workflow_trigger_occurrences_due_uq` on `(trigger_id, generation, due_at)` allows one occurrence per
  due instant, and a NULL `record_key` can't join that index, so add the record key and keep the clock's
  uniqueness some other way. The fingerprint passed to `reserve` doesn't include the record key yet.
- **Runs source.** Runs that said `schedule` now say `trigger`. A saved query or panel that filtered
  `/trigger` on `schedule` needs the new value. The source still has no `/triggerId` field.
- **The When line.** `whenSummary` uses `describeCadence`, so it reads "Daily at 09:00" rather than
  "Every day at 9:00 AM".
- **Service size.** The Node's static graph is 1,917,716 bytes on this branch, 216 bytes over the
  1,917,500 ceiling. Phase 1 measured the base at 1,914,542, so this phase adds about 3.2 KB: the
  split modules, the typed errors, the alias router, and the run projection's trigger lookup. The
  ceiling isn't raised here.

## Goal

Workflow schedules become triggers whose **When** is **On a schedule**. The storage, the service,
the routes, the shared types, and the dialog take the shape phase 4 needs, so a record trigger is a
second kind beside the clock and not a second system.

This is a refactor. Every approved schedule keeps firing with its run history, its occurrence
history, its loop settings, and its record history. What a person sees change is a section called
**Triggers** instead of **Schedules**, **Add trigger…** instead of **Schedule…**, and a **When** field
with one choice.

## Starting point

- `server/schedules/service.ts` is 611 lines and does four jobs: it saves drafts, it reviews and
  approves a published workflow for unattended starts, it runs the occurrence ledger with recovery,
  and it applies loop settings. `model.ts` holds limits and loop settings, `readModel.ts` the view,
  and `activation.ts` the scheduler target and the routes' bridge.
- Two decisions match error text with regular expressions: `admissionNeedsReview` in `service.ts`
  decides whether a failed start needs the owner's review, and `settleRun` decides whether a failed
  run means an expired incremental checkpoint.
- The tables are `workflow_schedules` and `workflow_schedule_occurrences`. The core scheduler row
  carries the cadence, the paused flag, and the run ring. Its target is `{ scheduleId }`.
- `server/publication/service.ts` moves every approved schedule to **Needs review** when a dependency
  or a saved query it uses is republished.
- `server/runs/activation.ts` calls back into the schedule service when a run settles.
  `WorkflowStartService.startScheduled` in `server/runs/admission.ts` starts the run with the start
  reason `schedule`.
- The routes are `/workflows/schedules` in `server/routes/schedules.ts`, documented in
  [workflow routes](../../api-reference/workflow-routes.md#triggers).
- The client has `client/schedules/ScheduleDialog.tsx` (592 lines), `scheduleModel.ts`, and
  `scheduleRequest.ts`. `WorkflowsBrowse.tsx` lists schedules, and `WorkflowEditor.tsx` offers
  **Schedule…** for a published workflow. The terminal client draws the same dialog.

## The design

### Storage

A plugin migration:

- Renames `workflow_schedules` to `workflow_triggers` and adds `when_json`, backfilled with
  `{ "kind": "clock", "timezone": <timezone> }`. The `timezone` column goes, since it lives in
  `when`. `loops_json` stays: it's the clock kind's setting for the **For each** loops in the
  workflow.
- Renames `workflow_schedule_occurrences` to `workflow_trigger_occurrences` and `schedule_id` to
  `trigger_id`, and adds a nullable `record_key` that phase 4 fills.
- Rewrites stored start reasons from `schedule` to `trigger`, and fills the `trigger_id` column that
  phase 1 added from the occurrence ledger's `run_id`.

IDs don't change, so core scheduler rows, processing scopes, and occurrence history all still point
at the right row.

### Modules

`server/schedules/` becomes `server/triggers/`, split by job:

| Module | Job |
| --- | --- |
| `approval.ts` | Resolve a published workflow for a project, freeze its graph, inputs, and limits, list changes since the last approval, and move a trigger to **Needs review** |
| `occurrences.ts` | Reserve an occurrence with its task and run IDs, resume it through `claimed`, `task-created`, and `run-started`, settle it, and reconcile after a restart |
| `clock.ts` | The clock kind: loop settings, the **Track from now** baseline run, and one active occurrence per trigger |
| `service.ts` | Composition: save, prepare, approve, pause, run now, delete, and views, each handing off to the kind |
| `readModel.ts` | The device view |
| `activation.ts` | The scheduler target and the route bridge |

`occurrences.ts` takes an overlap key from the kind. The clock passes the trigger ID, which keeps
today's rule that one occurrence at a time runs. Phase 4 passes the trigger ID and the record key.
`limits.ts` keeps `effectiveScheduleLimits` and `applyLimits`, renamed for triggers.

### Typed errors

`WorkflowStartService` throws `WorkflowAuthorityError` with a reason (`forbidden`,
`connection-required`, `not-published`, `missing`, `untrusted`, or `input-required`) where it throws
plain errors today. `approval.ts` and `occurrences.ts` check the type, not the text. A failed run
whose incremental checkpoint expired records a typed cause beside its error text, and `settleRun`
reads the cause. Both regular expressions go.

### Shared types and routes

`shared/workflowSchedules.ts` becomes `shared/workflowTriggers.ts`. `WorkflowTriggerView` gains
`when`, and `WorkflowTriggerDraftInput` takes `when` in place of `timezone`. The other fields keep
their meaning and lose the `Schedule` in their names.

The routes move to `/workflows/triggers` with the same operations: list, defaults, prepare, save,
get, approve, pause, run now, and delete. Before removing `/workflows/schedules`, check whether a
released desktop or terminal client could talk to a Node built from this phase. If one could, keep
the old path answering for one release and name the release that removes it.

The scheduler target kind stays `workflow`. Its target becomes `{ triggerId }`. `parse` also accepts
`{ scheduleId }`, because core's `user_schedules` rows keep their stored JSON. Note the alias in a
`shortcut:` comment that says it goes when no stored row uses the old key.

### Runs

`startScheduled` becomes `startTriggered`, takes the trigger ID, and starts the run with
`startedBy: 'trigger'` and `triggerId`. `WorkflowStartedBy` replaces `schedule` with `trigger`. The
run pane names the trigger that started a run and links to it.

### The client

`client/schedules/` becomes `client/triggers/`. `TriggerDialog` has a **When** section at the top,
with **On a schedule** as its only choice. The cadence, timezone, inputs, limits, loop settings, and
first check controls move under it unchanged. Phase 4 adds the second choice, so the dialog's layout
should already read as "when, then what".

`WorkflowsBrowse` calls the section **Triggers**, and each row shows its **When** in one line, such as
"Every day at 9:00 AM". `WorkflowEditor` offers **Add trigger…** where it offered **Schedule…**.

Settings → Schedules keeps listing the core scheduler row, because the scheduler still times the
trigger. Its row names the trigger and links to it.

## Steps

1. Write the migration, with a test over a database copied from a populated Node: schedules,
   occurrences in every state, loop settings, and processing scopes.
2. Move and split the service into the modules above. Move each test in `service.test.ts` beside the
   module it exercises, and keep every assertion.
3. Add the typed errors and remove both regular expressions.
4. Rename the shared types, the routes, and the run start, and update the publication service and
   the run activation callback.
5. Rename and reshape the client, with the **When** section.
6. Move scheduled roots to [triggers](../../workflows/triggers.md) (new), and
   update [user schedules](../../schedules/user-schedules.md),
   [workflow routes](../../api-reference/workflow-routes.md),
   [refusals](../../workflows/refusals.md), and [starting runs](../../workflows/starting-runs.md).
7. Build the Node, measure the service bundle, and raise the ceiling only by what this phase adds.

## Acceptance

- On a `pnpm dev:agent` session seeded with a pre-migration database, an approved schedule fires on
  time, shows its history under **Triggers**, and pauses, runs now, and deletes.
- A **Track from now** schedule mid-baseline at upgrade finishes its baseline after the migration.
- Republishing a workflow a trigger uses moves the trigger to **Needs review**, with the same wording
  as before.
- The same checks pass in `pnpm dev:tui:agent`.
- No module under `server/triggers/` is over 300 lines, and none matches an error message with a
  regular expression.
