# Phase 1: step kinds that describe themselves, and four new ones

Status: not started. Waits on phase 0.

## Goal

Every step kind, built-in or contributed, tells the host what its form looks like. One route lists
them. The terminal plugin contributes `terminal:command` and `terminal:run-target`; the database
plugin contributes `database:query` and `database:generate`. The owner's first workflow can now
include a shell command and a query, still from a file.

## Why this phase, and why now

The editor cannot draw a node it cannot describe, and two of the node kinds the owner named do not
exist. Both are node-side work with no UI, so they can land while phase 2 builds the table.

## Scope

In: everything in [03-step-kinds.md](./03-step-kinds.md).

Out: the editor that renders the fields (phase 3); any change to how a kind is dispatched.

## Design detail

**`describe`.** `StepKindDescription` and `StepField` go in `workflowContracts.ts` and are
re-exported from `contract/extensions.ts`, so a contributor imports one module as `http` does today.
`buildBuiltinWorkflowContributions` attaches a description to each of the seven built-ins from a
table in `workflowBuiltins.ts`. A lookup `FIELD_HOME: Record<kind, Record<fieldId, 'step' | 'with'>>`
in `shared/` says where each built-in field lands, so the editor writes `prompt` onto the step and a
plugin's `command` into `with` without knowing the difference.

**Host-applied checks.** Before calling a kind's `validate`, `validateWorkflow` applies `required`,
`min`, `max`, and the `select` membership for static `options`. A field with `optionsRoute` is not
checked at load time, because the node may be validating a file for a project it cannot reach; the
kind's own validator decides.

**The catalog route.** `GET /catalog` on the workflows router, answering
`WorkflowCatalog`. `projectId` is accepted and unused in this phase; phase 3 reads it. The bridge gains
`catalog()`.

**`terminal:command` and `terminal:run-target`.** `plugins/terminal/src/server/workflowSteps.ts` (new)
exports `commandStep(core)` and `runTargetStep(runtime)` as `StepKindContribution`s;
`plugins/terminal/src/node/index.ts` files both with `ctx.extensionPoints.handle(WORKFLOW_STEP_KIND,
…)`. The command handler is `runScript`'s shape with a streaming `onChunk` the process runner does
not have; add an optional `onStdout`/`onStderr` pair to `ProcSpec` in
`packages/node-core/src/server/core/proc.ts`, off by default, that forwards chunks while still
collecting the capped result. The environment is `buildSessionEnv` plus the step's `env` lines, and
the runner's allowlist still applies.

**`database.query`.** `plugins/database/src/contract/query.ts` (new) exports the capability id
`database.query` and its type. `plugins/database/src/node/index.ts` provides it from the bridge
with the row cap and the read-only classification applied. `plugins/database/src/server/workflowSteps.ts` (new)
exports the two kinds; the node entry files them on the point spelled as a string. The
`optionsRoute` for saved queries is a new `GET /projects/:projectId/saved-queries` on the database
router answering `{ options }`; the model-connections route exists and gains the `{ options }`
projection beside its current answer.

**`http:request`.** `plugins/http/src/server/workflowStep.ts` gains `describeHttpStep`, and the
registration in `plugins/http/src/node/index.ts` passes it.

**Events.** Each handler emits through `ctx.emit` with the vocabulary in
`plugins/workflows/src/shared/stepEvents.ts` (new in phase 0).

## Code touched

- `plugins/workflows/src/shared/workflowContracts.ts`, `contract/extensions.ts`: the description types.
- `plugins/workflows/src/server/workflowBuiltins.ts`: built-in descriptions, `FIELD_HOME`.
- `plugins/workflows/src/server/workflowValidation.ts`: host-applied field checks.
- `plugins/workflows/src/server/routes/workflow.ts`, `node/index.ts`: the catalog route and bridge member.
- `plugins/terminal/src/server/workflowSteps.ts` (new), `plugins/terminal/src/node/index.ts`.
- `packages/node-core/src/server/core/proc.ts`: optional chunk callbacks.
- `plugins/database/src/contract/query.ts` (new), `plugins/database/src/server/workflowSteps.ts` (new),
  `plugins/database/src/node/index.ts`, `plugins/database/src/server/routes/database.ts`,
  `plugins/database/acorn-plugin.config.mjs` (the manifest declares the capability and the extension).
- `plugins/http/src/server/workflowStep.ts`, `plugins/http/src/node/index.ts`.
- `apps/node/test/integration/routeRegistry.snapshot.json` and
  `apps/node/test/integration/pluginSystem/pluginDisable.snapshot.json`: regenerated; the diff shows
  the catalog route, the saved-queries route, and the capability.

## Tests

- `plugins/terminal/src/server/workflowSteps.test.ts` (new): the validator refuses a missing
  command and a timeout out of range; the handler returns `exitCode`, `stdout`, `stderr`; a non-zero
  exit fails unless `allowFailure`; chunks arrive through `emit` in order; a timeout fails; an
  abort cancels.
- `plugins/database/src/server/workflowSteps.test.ts` (new): exactly one of `savedQueryId` and
  `sql`; the row cap; the 256 KB refusal; a write statement refused; `generate` runs the generated
  SQL and carries it in the output.
- `plugins/workflows/src/server/workflowExtensions.test.ts`: a kind with a `describe` appears in
  the catalog with its fields; a kind without one appears with `describe: null`; host-applied
  `required` fires before the kind's validator.
- `plugins/http/src/server/workflowStep.test.ts` (new or extended): the description's field ids match
  the keys the handler reads.

## Docs owed

`docs/workflows.md` § Contributed step kinds (`describe`, the catalog); `docs/plugins.md` § Node-side
extension points (a point's value may carry a description the host draws); `docs/terminal.md`,
`docs/database.md`, `docs/http-client.md` each gain § Workflow steps; `docs/api-reference.md` (the
catalog and saved-queries routes); `docs/first-party-plugins.md` rows.

## Doors left open

- `database:write` with an execute-tier ceiling and an audit row. The read-only refusal is the seam.
- A `file` field type for the editor, once a kind needs one.
- Streaming from a run target's PTY into the run pane. The session id is in the output; the tee is
  not built.

## Done when

- The catalog lists eleven kinds with descriptions and one policy.
- A TOML file with a `terminal:command` node and a `database:query` node runs, the command's stdout
  reaches the next agent's prompt, and the query's rows do too.
- The golden lists are regenerated in their own commit hunk with the reason.

## Verify before building

- `StepKindContribution` is still `{ handler, validate? }`.
- `plugins/http/src/server/workflowStep.ts` still reads `step.with` unrendered (phase 0 changes
  this; confirm it landed).
- `ProcSpec` in `packages/node-core/src/server/core/proc.ts` has no chunk callback.
- `plugins/database/src/` has no `contract/` folder and its node entry provides no capability.
- `ctx.extensionPoints.handle` is available to a loaded plugin's node half
  (`packages/plugin-types/src/public.ts` `PluginExtensionPointRegistry`).
- `plugins/terminal/src/server/runChannel.ts` `runScript` is still the `/bin/sh -c` pattern.
