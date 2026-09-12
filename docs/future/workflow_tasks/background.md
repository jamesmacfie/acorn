# Background and code reference

Date: 2026-09-12. Status: implementation proposal, not started.
Baseline: `8cb7ce45`. Paths describe the surveyed code, not a promise that it has stayed unchanged.

## Product intent

A workflow can dispatch another saved workflow into a child task and wait for its result.
For a collection, it can create one child task and workflow run per item. Each child receives
validated declared inputs, such as a ticket number.

The motivating flow is: obtain tickets with a chosen status, select tickets updated within
24 hours, then run a saved workflow for each selected ticket. This programme implements the
dispatch and structured mapping, not the Linear query or filtering integration. Use fixture
structured output to develop and test that boundary.

## Surveyed implementation

| Area | Code and behavior |
| --- | --- |
| Contracts | `plugins/workflows/src/shared/workflowContracts.ts` defines inputs, graph steps, tool ceilings, and budgets. |
| Execution | `plugins/workflows/src/server/workflowRunner.ts` starts runs, schedules graph steps, handles gates, retries, and cancellation. Recovery requeues running steps; it is not general side-effect deduplication. |
| Fan-out | `plugins/workflows/src/server/workflowBuiltins.ts` creates child tasks and synthetic agent steps in the same run. It does not start independent saved workflows. Its fan-out limit is 12. |
| Storage | `plugins/workflows/src/node/schema.ts` owns runs, steps, and database definitions. Runs lack the proposed invocation and run-tree relationships. |
| Resolution | `plugins/workflows/src/node/index.ts` resolves scoped database and file definitions and checks repository configuration trust. |
| File composition | `plugins/workflows/src/server/workflowFiles.ts` treats the step's `workflow` field as static expansion. Preserve this syntax. |
| Validation | `plugins/workflows/src/server/workflowValidation.ts` resolves string inputs and renders prompt substitutions. Prompt rendering is not typed collection mapping. |
| Task creation | `packages/node-core/src/server/core/tasks.ts` has `createChild(parentTaskId, seed, intendedChildId?)`, including intended-ID checks and inherited project ownership. |
| Root creation | `packages/node-core/src/server/routes/projects/tasks.ts` implements root creation and external-link validation in the HTTP handler. Scheduling will need a reusable core operation. |
| Authoring | `plugins/workflows/src/shared/stepFields.ts` describes step forms. The editor, TOML writer, generator, grounding, and AI edit protection must agree on additions. |
| AI | `plugins/workflows/src/server/generateWorkflow.ts`, `editWorkflow.ts`, and `groundWorkflow.ts` separate generated content from protected execution settings. |
| UI | `plugins/workflows/src/client/runs/` projects run and synthetic-child state. Independent child runs require explicit navigation and status projection. |

## Ownership and data flow

The workflow plugin resolves and freezes definitions, owns dispatch records, and drives runs.
Core owns tasks, branches, and external links. The agents plugin owns managed sessions.
Call core through the plugin API and other plugins through capabilities. Do not join their databases.

A dispatch persists intent in the workflow database, creates its intended task through core,
then starts its intended workflow run in the workflow database. Those operations span databases.
They require replay-safe IDs and reconciliation, not a claimed cross-database transaction.

A child task inherits the parent's Node and project. A Git task gets a unique branch and a lazy
worktree through core. A separate task is not an operating-system sandbox. Non-Git projects can
still share a directory; do not describe their child tasks as isolated filesystems.

Read [workflows](../../workflows.md), [tasks](../../workspaces-and-tasks.md),
[security](../../security.md), and [architecture](../../architecture-overview.md) before building.

## Verify before building

- Re-read the named functions and their colocated tests against the baseline.
- Trace a start from route through resolver, runner, core task creation, events, cache, and run pane.
- Characterize recovery, retry usage accounting, and cancellation before changing them.
