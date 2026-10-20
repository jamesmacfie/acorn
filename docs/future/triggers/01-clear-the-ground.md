# Phase 1: clear the ground

Date: October 20, 2026. Status: built on branch `phase-1-clear-the-ground`, not merged. Needs nothing.

## Completion note

Built October 21, 2026. The workflows plugin has no trigger extension point, no `trigger` key on a
definition, and calls a run's start reason `startedBy`. "Trigger" is left in two places on purpose:
the nullable `workflow_runs.trigger_id` column, and the Workflow runs source's public `/trigger`
field.

### The two counts

Taken October 21, 2026, on the owner's Node, whose data root is `apps/node/.acorn/` in the main
checkout. The packaged app's data root has no workflows database.

- **Definitions that set `trigger`: none.** That's 0 of 5 `workflow_defs` rows and 0 of 10
  `workflow_revisions`, including every published one. No workflow file in the repository or in
  `~/.acorn/workflows` sets it. There are no workflow schedules, so no approved schedule moves to
  **Needs review**.
- **Runs with an unknown start reason: none.** The 62 runs are 43 `manual` and 19 `agent-map`. The
  new migration, replayed on a copy of this database, leaves both counts as they were.

### What landed

- **The extension point is gone.** `WORKFLOW_TRIGGER`, `WorkflowTriggerContribution` and its match
  type, `WorkflowRunner.pollTriggers`, and `registerWorkflowTriggers` with its `workflows:triggers`
  schedule and `checks-changed` subscriptions are deleted, with their unit test and testkit export.
  The integration case in `apps/node/test/integration/plugins/workflowRunner.test.ts` still covers
  contributed step kinds and policies, and starts its run directly.
- **The definition key is gone.** `WorkflowDef` has no `trigger`, and the writer doesn't write it. The
  loader ignores the key, and `WORKFLOW_FILE_LOADER_ONLY` lists it. `storedWorkflowDef` in
  `server/publication/store.ts` drops it whenever a draft or revision row is parsed. AI authoring,
  grounding, the agent tool projection, and the teaching text no longer name it.
- **The start reason is `startedBy`.** Migration `0004_run_started_by` renames the column to
  `started_by`, adds a nullable `trigger_id`, and rewrites any value outside `WorkflowStartedBy` to
  `manual`. The union types the column itself, through Drizzle's `$type`, as well as
  `WorkflowStartOptions.startedBy` and `WorkflowInternalStart.startedBy`. The runner falls back to
  `options.startedBy ?? 'manual'`.
- **The runs source keeps its field.** `/trigger`, labeled **Started by**, reads `started_by`, so saved
  queries and panels that filter on it keep working. That's decision 5's default.
- **Docs.** The five pages the starting point names, plus definitions, the workflows overview,
  child runs, execution, starting runs, AI authoring, workflow tools, workflow routes, features, and
  first-party plugins. `workflows.md` § Triggers is now
  [unattended starts](../../workflows.md#unattended-starts). On the public site, the Workflows plugin
  page and the code host reference no longer promise early trigger checks.
- **Tests.** `toml.test.ts` loads a file that sets `trigger = "nightly"` and writes it back without the
  key. `resolution.test.ts` reads a draft and a revision whose stored JSON still holds the key. Every
  test that branched on `run.trigger` passes against `run.startedBy`.

### Decisions and deviations

- **The migration rewrites unknown start reasons.** The phase says such a value reads as `manual`.
  One `UPDATE` makes that true for every reader at once: the typed column, the runs source's filters
  and options, the task run list, and the read models. It loses a contributed trigger's ID, and the
  count says no run had one.
- **Drafts drop the key on read, as revisions do.** Otherwise the editor would load the key and save
  it back.
- **An agent can still write a `trigger` key into a draft.** The tool's `definition` input is an open
  record, so any unknown root key is stored, and the draft diff lists it under `settings`. This one is
  then dropped on every read.
- **The run span's attribute is renamed.** `workflow.run` carries `startedBy` where it carried
  `trigger`. A saved telemetry query on the old name needs the new one.
- **Site marks.** `built-in-plugins/workflows.mdx` is marked checked in a follow-up commit.
  `reference/contributions/code-host.mdx` isn't, because its sources have two earlier commits
  nobody has reviewed for it, `7c706aa2d` and `37526bb02`. The other 18 pages that
  `stale --touching` lists cite the changed files for other facts, and none mention triggers, the
  sweep, or the start reason.

### For later phases

- **Phase 2.** When `WorkflowStartedBy` swaps `schedule` for `trigger`, the compiler finds every
  comparison, because the column is typed with the union. The same change needs its migration to
  rewrite stored `schedule` values, or the type no longer matches the data. `startScheduled` in
  `server/runs/admission.ts` is where `startedBy: 'schedule'` is set. Nothing writes `trigger_id` yet,
  and the runs source has no `/triggerId` field.
- **Scheduler state.** The core scheduler keeps the `workflows:triggers` state row, unread.
- **Service size.** The Node's static graph is 1,914,542 bytes on this branch, under the 1,917,500
  ceiling.

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
- Docs that describe the sweep: [workflows](../../workflows.md#unattended-starts),
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
