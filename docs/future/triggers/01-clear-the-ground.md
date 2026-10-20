# Phase 1: clear the ground

Date: October 20, 2026. Status: proposed. Needs nothing.

## Goal

Three things in the workflows plugin are called a trigger, and none of them is the feature this
programme builds. Delete the two that do nothing useful, and give the third its real name. After
this phase, "trigger" is free to mean one thing.

Nothing a person relies on changes. The one visible change is that a workflow file's `trigger` key
is ignored, and the next save drops it.

## Starting point

- `WORKFLOW_TRIGGER`, the `workflows:trigger` extension point, is declared in
  `plugins/workflows/src/contract/extensions.ts` with `WorkflowTriggerContribution` from
  `shared/workflowContracts.ts`. `WorkflowRunner.pollTriggers` in `server/runs/runner.ts` asks each
  contribution for `{ taskId, workflow }` pairs and starts them. `registerWorkflowTriggers` in
  `server/schedules/activation.ts` runs the sweep from the plugin schedule `workflows:triggers`
  every 300 seconds, and early on each code host's `checks-changed`.
- No plugin contributes to it. The only contribution is a test in
  `apps/node/test/integration/plugins/workflowRunner.test.ts`. A contribution could start any
  definition on any task without the approval a schedule needs.
- A definition's `trigger` key is parsed in `server/definitions/files.ts`, written back by
  `server/definitions/toml.ts`, hidden from AI editing (`authoring/edit.ts`, `authoring/ground.ts`,
  `authoring/generate/forbiddenKeys.ts`, `agentTools/projection.ts`), and taught in
  `authoring/generate/teaching.ts`. It's used in one place: as the fallback start reason when a run
  starts without one (`runs/start.ts` and `runs/runner.ts`), so a manual run of a definition that sets
  `trigger = "nightly"` records `nightly`.
- `workflow_runs.trigger` holds the start reason: `manual`, `schedule`, `agent-tool`, `agent-map`,
  `reprocess`, or a contributed trigger's ID. Code branches on it in `runs/runner.ts`,
  `runs/read/projection.ts`, `runs/read/readModel.ts`, `steps/builtins.ts`, `steps/execution.ts`,
  `processing/reprocess.ts`, and `dispatch/dispatcher.ts`. The Workflow runs source serves it as
  `/trigger` (`server/data/runSourceHandler.ts`).
- Docs that describe the sweep: [workflows](../../workflows.md#triggers),
  [step kinds](../../workflows/step-kinds.md), [polling gates](../../workflows/polling-gates.md),
  [code hosts](../../plugins/code-hosts.md), and
  [node-side extension points](../../plugins/node-side-extension-points.md). Comments in the GitHub,
  GitLab, and Bitbucket node entries say workflows hears `checks-changed`.

Before building, count on the owner's Node how many stored definitions and published revisions set
`trigger`, and how many runs carry a start reason outside the known set. Record both in the
completion note.

## The design

### Delete the extension point and its sweep

Remove `WORKFLOW_TRIGGER`, `WorkflowTriggerContribution`, its match type, `pollTriggers`,
`registerWorkflowTriggers`, the testkit export, and the integration test case. The workflows plugin
no longer subscribes to `checks-changed`. Nothing else in the repository listens to it, but code
hosts keep emitting it, because it's a declared event in [events](../../plugins/events.md) that
another plugin may hear. Update the comments in the three code host plugins that name workflows as a
listener.

The scheduler keeps the `workflows:triggers` state row unread, as it does for any declaration that
disappears ([schedules](../../schedules.md#the-three-declarers-one-registry)). No migration is needed.

The workflows plugin then declares two extension points, step kinds and policies. The step-kinds page
says plugins add to triggers through data sources, and links to this programme until phase 5 ships
the authoring guide.

### Remove the definition key

- `WorkflowDef` loses `trigger`. The writer stops writing it.
- The file loader still accepts the key and ignores it, so an existing file keeps loading. List it in
  `WORKFLOW_FILE_LOADER_ONLY` with the description "Ignored. A workflow starts on its own through a
  trigger in the Workflows list."
- Database revisions are immutable JSON. Resolution drops the key when it parses one.
- The AI authoring and agent tool lists drop `trigger`, and the teaching text loses its line.

Dropping the key changes the content fingerprint of a definition that set it. An approved schedule
over such a definition moves to **Needs review** once. The count from the starting point says
whether that affects anyone.

### Name the start reason

Rename the column `workflow_runs.trigger` to `started_by` in a plugin migration, and add a nullable
`trigger_id`. Every TypeScript name follows: `WorkflowStartOptions.startedBy`,
`WorkflowInternalStart.startedBy`, `run.startedBy`. The start reasons become a closed union in
`shared/workflowContracts.ts`:

```ts
type WorkflowStartedBy = 'manual' | 'schedule' | 'agent-tool' | 'agent-map' | 'reprocess'
```

Phase 2 replaces `schedule` with `trigger`. A stored value outside the union, which only a
contributed trigger could have written, reads as `manual`.

The runner's fallback becomes `options.startedBy ?? 'manual'`.

The Workflow runs source keeps its public `/trigger` field, labeled **Started by**, so saved queries
and panels keep working. That's decision 5 in the [README](./README.md). With the alternative, the
field becomes `/startedBy` and this phase also rewrites saved queries and panel plans that name it.

## Steps

1. Take the two counts from the starting point.
2. Delete the extension point, its sweep, its schedule, the test case, and the code host comments.
3. Remove the definition key from the type, the writer, resolution, and authoring. Keep the loader's
   tolerance, with a test that an old file with `trigger` loads and saves without it.
4. Add the migration and rename the start reason through the plugin. Keep the source's public field.
5. Update the five docs listed in the starting point, and
   [definitions](../../workflows/definitions.md) for the key.
6. Run `pnpm lint`, the workflows and Node suites, and `pnpm --filter @acorn/arch-tests test`.

## Acceptance

- `rg "WORKFLOW_TRIGGER|pollTriggers|workflows:trigger"` finds nothing outside `docs/future/`.
- A workflow file with `trigger = "nightly"` loads, runs, and saves without the key.
- A run's start reason reads the same as before in the run pane, in the Workflow runs source, and on
  a panel that filters on it.
- An approved schedule from before the migration keeps firing, and its runs record `schedule`.
- Every workflows test that branched on `run.trigger` passes against `run.startedBy`.
