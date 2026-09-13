# Running, scheduling, and history UX

Date: 2026-09-13. Status: accepted design, implementation not started.
Context: [decisions](./context.md). Runtime rules are in [workflows](./workflow-contract.md) and
[scheduling](./scheduling.md).

## Run summary

Run opens one compact summary with published version, project/task, typed inputs, query behavior,
and effective execution limits. Library starts default to a new root task in the selected project.
Task-launched starts default to that task. Offer an existing-task choice without requiring users to
create a task in another screen. Never switch task context silently.

Show the last preview count only as a labeled estimate. State **Records are checked again when the
run starts**. Preview neither pins a live batch nor executes workflow actions. Missing input/source
setup has an inline repair link. A record input can be selected through its compatible source picker;
advanced typed JSON entry remains available for non-source inputs. There is one **Start run** action.

If unpublished edits exist, label the summary as the published version and link back to publication.
Do not execute the draft through an alternate route. Validate again on the Node before creating the
root task. A normal zero-match query can produce a completed root run but creates no child tasks.

After start, open the run. Preserve the definition/editor as a navigable location. A failed start
keeps the summary inputs intact and says whether any root task was reserved or created. Retrying a
transport-ambiguous start reuses its request identity.

## Schedule setup

Offer **Schedule** from a published workflow. The first view contains the project, workflow inputs,
and cadence. Repeat handling appears only for record loops. The default repeat choice is **Every
match**; choosing another policy reveals only its additional controls. Selected-field changes show
the compatible field picker with source suggestions, requiring at least one field.

Use the phrases **Previously unseen records**, **Run again when these fields change**, and **Since
the last completed check**. The last option appears only for capable sources. Explain unavailable
incremental support beside time-window choices, not as a generic error. An absolute or calendar
window shows its timezone; allow changing it. Show the next three execution times including UTC
offsets so daylight-saving effects are visible.

At activation, show the effective scope and first-check choice. Default to processing current matches
within the configured window. Starting tracking from now explains that an initial baseline check
does not run child workflows. Keep the schedule inactive until baseline/approval succeeds. Failure
offers retry and preserves all settings.

Execution limits are collapsed with a readable summary and expand when invalid. Do not require a
user to name internal processing epochs, idempotency keys, or provider tokens. Activation is distinct
from saving the schedule draft. No client must remain open after activation.

## Schedule status and review

Show Active, Paused, Needs review, or Unavailable as distinct states, alongside next occurrence and
the latest run link. An overlapping occurrence shows **Skipped: previous run still active**, with a
link to the active run and any approval it needs. Do not label this as provider failure.

Changing a published dependency exposes a compact review of what changed and its affected fields,
queries, or workflows. Retain processing history by default. Offer **Start fresh** only in an
advanced review section with the consequence that matching records may run again. Keep old attempts
available. Changes that prevent baseline comparison require a specific baseline/reprocess choice.

Pause explains that active work continues. Cancel run is a different action. Run now uses the
schedule's approval and record history, even while paused. Deleting a schedule leaves its tasks and
runs intact. An unavailable connection offers Reconnect without discarding approval history or drafts.

## Batch history

Start with a compact progress summary and record table. Columns are record title/source, status,
reason where relevant, child task, and a short result. Fetch/page rows rather than rendering hundreds
of expanded cards. Retain sort/filter state and selected row across refreshes.

Visible filters include All, Running, Needs approval, Failed, and Skipped. Distinguish **No matches**
from **All matches already processed**. A row skipped by repeat policy explains the prior attempt or
unchanged fields and links to history. Source query failure is a run/step error, not hundreds of
invented failed record rows.

Expand a row to see the frozen input, detail read times, declared child outputs, and nested workflow
summary. Open task/run links retain a route back to the root and selected record. Large content
loads on demand. Show the version used for the run, not the definition being edited elsewhere.

Successful independent records continue when another fails. A settled mixed batch reads **Completed
with failures**, with counts and a failed-row filter. A gate reads **Needs approval**, linking to the
existing gate UI. A safety rail explains the reached limit and retained work. Do not offer a retry
that can exceed the configured hard ceiling or repeat an unknown external effect without recovery.

Retry is explicit on failed work and uses its original task/run snapshot. Reprocess is a separately
named action that creates another attempt. Neither button reruns successful siblings. A source record
that changed after selection does not silently change the failed attempt's inputs.

## Task navigation

Use core parent/child identity. Workflow descendants start collapsed under the root with running
and attention counts. Do not auto-expand the whole tree on every event. Opening a child from run
history reveals the required ancestor path and selects that child. Preserve a user's subsequent
collapse preference. Aggregate attention must remain visible while children are collapsed.

No automatic task archival and no new batch archive action. Retain tasks/worktrees using ordinary
task lifecycle rules. Existing per-task archive actions still perform their normal teardown checks.
Missing or archived task links explain availability without losing the run record.

## Recovery copy and placement

| Condition | Placement and next action |
| --- | --- |
| Source unavailable | Query/run step message with Reconnect or Retry; retain configuration. |
| Incomplete query | Explain limit/failure at Find records; Edit query or retry the complete selection. |
| Invalid used field | Link directly to its binding/filter; retain the invalid selection for repair. |
| Expired incremental token | Schedule Needs review; choose a new baseline/window explicitly. |
| Interrupted publication | Publication review lists completed writes and remaining conflicts; Resume/reconcile. |
| Root cancellation | Show cancelling until descendants settle, then retained cancelled/unstarted rows. |
| Node disconnected | Retain last known status with an offline label; do not invent completion. |

## Verify before building

Inspect the existing start dialog, run projections, gate actions, task hierarchy, and navigation
handlers. Verify event-driven refresh plus reconnect rereads. Test 500-row history at narrow width
and in the terminal, not only a two-record happy path.
