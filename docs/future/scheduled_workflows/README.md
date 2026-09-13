# Scheduled workflows

> Superseded on 2026-09-13 by [workflow v2](../workflow_v2/README.md).
> Do not implement this historical plan. Its original text is retained for background; the new
> [scheduling contract](../workflow_v2/scheduling.md) and implementation slices are authoritative.

Date: 2026-09-12. Status: implementation proposal, not started.
Baseline: `8cb7ce45`. Paths describe the surveyed code, not a promise that it has stayed unchanged.

Implement after all phases of [workflow tasks](../workflow_tasks/README.md). This programme adds
user-approved schedules that create a fresh task and run an ordinary workflow with supplied inputs.

## Read first

- [Background and code reference](./background.md)
- [Scheduling contract](./reference.md)
- [Scope and refused alternatives](./refused.md)

## Phases

Execute in order. Keep workflow scheduling unavailable until the final integration gate passes.

| Phase | Deliverable | Status |
| --- | --- | --- |
| [01](./phase-01-target-and-approval.md) | Add the workflow target and approval lifecycle | Not started |
| [02](./phase-02-durable-occurrences.md) | Persist schedule occurrences before dispatch | Not started |
| [03](./phase-03-task-dispatch-and-overlap.md) | Create root tasks and enforce workflow overlap | Not started |
| [04](./phase-04-scheduling-ui.md) | Build the user scheduling flow | Not started |
| [05](./phase-05-history-and-release.md) | Complete history, recovery, and release acceptance | Not started |

## Completion

A user can schedule a saved, AI-generated or manually authored workflow, supply its inputs, and
observe separate root tasks and their child workflows across Node restarts. Invalid bindings do
not create tasks. Pausing stops future dispatch, overlap skips are visible, and definition changes
require review. No desktop needs to remain open.

Run `pnpm lint`, `pnpm test`, `pnpm db:check`, and `pnpm --filter @acorn/arch-tests test`.
Record evidence and manual UI checks in the phase documents. Move implemented contracts into
their owning docs when the programme ships.

## Verify before building

Confirm the preceding programme's contract and test evidence. Re-read scheduler and authentication
code against the baseline. These documents authorize no broader MCP, plugin, or fleet permissions.
