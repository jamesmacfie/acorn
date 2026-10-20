# Phase 2: one trigger model

Date: October 20, 2026. Status: proposed. Needs phase 1.

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
  [workflow routes](../../api-reference/workflow-routes.md#schedule-bindings).
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
6. Move [scheduled roots](../../workflows/scheduled-roots.md) to `docs/workflows/triggers.md` (new), and
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
