# Background and code reference

> Superseded on 2026-09-13 by [workflow v2](../workflow_v2/README.md).
> Do not implement this historical plan. Its original text is retained for background; the new
> [scheduling contract](../workflow_v2/scheduling.md) and implementation slices are authoritative.

Date: 2026-09-12. Status: implementation proposal, not started.
Baseline: `8cb7ce45`. Paths describe the surveyed code, not a promise that it has stayed unchanged.

## Goal and prerequisite

A user selects a workflow, supplies its required inputs, chooses a cadence, and approves the schedule.
Each occurrence creates a fresh root task and starts that workflow. The Node runs the schedule
without an open desktop. Complete [workflow tasks](../workflow_tasks/README.md) first.

Scheduling owns when to dispatch, not how to run steps. Reuse the scheduler, ordinary workflow
runner, durable invocation contract, shared budgets, and run history. No GitHub Action triggers
or other external event triggers belong to this programme.

## Surveyed implementation

| Area | Code and gap |
| --- | --- |
| Scheduler | `packages/node-core/src/server/schedules/scheduler.ts` supports cadence, backoff, pause, run-now, and bounded dispatch. A handler defaults to 60 seconds and is capped at 300 seconds. Do not wait for an entire workflow inside it. |
| Target registration | `packages/node-core/src/server/schedules/index.ts` and `nodeAction.ts` register node-action targets. Workflow dispatch needs a typed adapter, not a prompt disguised as a node action. |
| Storage | `packages/node-core/src/server/db/schema.ts` owns user schedules, state, and recent schedule runs. The 20-entry history ring is not a durable invocation ledger. |
| Routes | `packages/node-core/src/server/routes/schedules.ts` requires device authority. Target discovery projects node actions; editing does not provide the full proposed target-revision lifecycle. |
| Protocol | `packages/protocol/src/schedules.ts` defines interval, daily, and weekly cadence. Reuse these forms rather than adding cron. |
| UI | `packages/client-core/src/features/settings/SchedulesSettings.tsx` provides Node-scoped schedule controls and history. Workflow input configuration is missing. |
| Root task creation | `packages/node-core/src/server/routes/projects/tasks.ts` owns route-local creation and external-link checks. Extract the reusable operation into core rather than calling HTTP internally. |
| Composition | `apps/node/src/composition/runtime.ts` integrates the scheduler and plugins. Register the workflow adapter through public contracts after dependencies are ready. |

## Boundary and flow

Host-owned schedule form → device-authenticated Node route → approved schedule target →
durable occurrence claim → core root task → ordinary workflow start → workflow run tree.
The scheduler returns after durable dispatch acknowledgement. Workflow lifecycle remains in the
workflow plugin. Events update the Node-scoped client cache, but persisted state supports reconnect.

Core must not import workflow plugin implementation or read its database. Add a narrow public
capability contract and connect it in the application composition root. Extend generic scheduler
target hooks only as needed for async preparation, dispatch identity, and lifecycle lookup.
Loaded plugins do not gain schedule administration authority.

Read [schedules](../../schedules.md), [workflows](../../workflows.md),
[security](../../security.md), and [architecture](../../architecture-overview.md).

## Verify before building

- Confirm workflow_tasks completion and its internal idempotent invocation contract.
- Re-read scheduler timeout, startup, catch-up, and target registration behavior.
- Trace Node selection through the settings route and server ownership checks.
