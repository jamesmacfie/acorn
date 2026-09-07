# Phase 0: the engine

Status: not started. Waits on nothing.

## Goal

The runner executes a graph instead of a list. A definition can declare inputs and a run can be
started with values for them. An agent step can ask for its own worktree, can have every upstream
output appended to its prompt, and can name the model and reasoning level the harness should use. A
failed node can be retried. Every notice names the run and step it is about. All of it from a
hand-written TOML file, with no UI, so the owner's first workflow runs at the end of this phase.

## Why this phase, and why now

Everything after this reads the definition this phase settles. Building the editor first would mean
building it twice. And the first workflow the owner wants is expressible today in every respect but
one: two investigators cannot run at the same time on one task. That is the smallest change with the
largest effect, and it is worth proving from a file before a form exists.

## Scope

In:

- `after`, `inputs` (the definition's declared inputs), `isolation`, `inputs` (the agent node's
  mode), and `configOptions` on the definition types, the TOML parser, and the validator, as
  [02-definition-model.md](./02-definition-model.md) specifies.
- The parallel tick, the graph rule for `decide`, and `idx` demoted to declaration order, as
  [04-runs-and-live-state.md](./04-runs-and-live-state.md) specifies.
- `${inputs.<name>}` rendering in prompts, child prompts, and `with` string values.
- The `append` mode's block per incoming edge.
- Worktree isolation through `createChildTask`.
- `configOptions` on `AgentSessionExecuteRequest`, applied with `patchSession` after the provider
  reports its options and before the turn is enqueued.
- Retry: the route, the reset rule, the edited prompt.
- Notice frames carrying `runId` and `stepId`, the `run-failed` kind, and the
  `workflow:step-changed` frame.
- The start body: `inputs`, refused when a required one is missing or an undeclared one is present.

Out: any client change beyond the wire types, any new step kind, the database table, the catalog.

## Design detail

**Types.** `WorkflowInput` and the four new step fields land in
`plugins/workflows/src/shared/workflowContracts.ts`; the renderer-facing copies in
`packages/protocol/src/workflow.ts` gain `WorkflowInput`, `after`, `isolation`, and `inputs` on
`WorkflowDefSummary`'s step shape, because the palette and, later, the editor read them.

**Parser.** `parseStep` in `workflowFiles.ts` reads `after` (an array of non-empty strings, or
absent), `isolation`, `inputs` (the mode), and `config_options` (a table of strings). `parseWorkflowToml`
reads `[[inputs]]`. The sub-workflow expansion prefixes `after` entries the way it prefixes `joins`
and `branches`. A step in an expanded sub-workflow with no `after` waits on the previous step of the
sub-workflow, and the first one waits on the step before the reference, which is what a linear
expansion always meant.

**Validation.** `validateWorkflow` gains the rules in the model file's § Validation rules. The
cycle check is a depth-first walk over `after`; the error names the cycle as `a → b → a`. The
transitive-predecessor check for a template reference reuses the same walk. Input references are
collected with a second regex beside `TEMPLATE_RE`, and `invalidTemplateExpressions` learns the
second form.

**Rendering.** `renderWorkflowPrompt(prompt, rows)` gains an `inputs` argument and substitutes
both forms. A new `renderWith(with, rows, inputs)` walks one level of string values. The runner
renders `with` before calling a contributed handler and passes the rendered table on `ctx.def.with`,
so `http:request` and every later kind never see a template.

**Append mode.** `runAgent` in `workflowBuiltins.ts`, after rendering, appends one `## Output of
<name>` block per `after` entry whose row is `done`, using the same value `renderWorkflowPrompt`
would substitute. `template` and `none` append nothing.

**The tick.** As [04-runs-and-live-state.md](./04-runs-and-live-state.md) § The parallel tick.
`execute` is unchanged in body; the loop that awaited it becomes a start-and-forget with a
completion callback that calls `tick` again. `applyBranch` computes skipped rows from the graph:
every other branch target, and every pending row whose every path to a root passes through a skipped
row. `runJoin` and `join`'s validator stop reading `idx`.

**Isolation.** In `execute`, before dispatch: when `def.isolation === 'worktree'` and the kind runs
an agent, call `deps.createChildTask(run.taskId, seed)` and write `{ childTaskId }` into
`inputsJson` beside the prompt. `runHeadless` receives the child id as `taskId`. The seed's branch is
`slugifyBranch(`${run.name}-${def.name}`)`, deduplicated by `createChild` as fan-out already does.

**Config options.** `AgentSessionExecuteRequest` gains `configOptions?: Record<string, string>`.
In `createSessionExecute`, after `sessionFor` returns a session whose `config.configOptions` is
populated (wait on the readiness the runtime already exposes for `createSession`), call
`runtime.patchSession(session.id, { config: { ...session.config, configOptions: applied } }, {
remember: false })` where `applied` folds the requested values onto the advertised list, refusing a
value the provider does not list and recording a diagnostic. Codex keeps reading
`effectivePolicy.model`/`effort`; pass `model` and `reasoning` from `configOptions` into
`effectivePolicy` too so both drivers see the same request.

**Retry.** `WorkflowRunner.retryStep(runId, stepId, prompt?)` implements § Retry. The route
`POST /workflows/runs/:runId/retry` sits under `ownsRun` and refuses a task-confined caller with 403.
The bridge gains `retry(runId, stepId, prompt?)`.

**Notices.** `deps.notify(taskId, kind, title, ref)` gains `ref: { runId, stepId? }`; the node
entry writes `runId` and `stepId` onto the frame. `finishRun` sends `run-failed` for `failed` and
`safety-rail`. `setStep` sends `workflow:step-changed` when `status` differs from the row it read.
`packages/node-core/src/server/notify.ts` `broadcastWorkflowNotice` keeps its signature and gains an
optional trailing `ref`.

## Code touched

- `plugins/workflows/src/shared/workflowContracts.ts`: `WorkflowInput`, the four step fields,
  `notify`'s `ref`.
- `plugins/workflows/src/server/workflowFiles.ts`: the parser and the expansion prefixing.
- `plugins/workflows/src/server/workflowValidation.ts`: the graph rules, input references,
  `renderWith`.
- `plugins/workflows/src/server/workflowRunner.ts`: the tick, isolation, retry, `step-changed`.
- `plugins/workflows/src/server/workflowBuiltins.ts`: append mode, `join` and `decide` off `idx`.
- `plugins/workflows/src/server/routes/workflow.ts`: `inputs` on the start body, the retry route,
  the bridge member.
- `plugins/workflows/src/node/index.ts`: the frames with ids, `retry` on the route capability.
- `plugins/workflows/src/contract/notices.ts`: `notice` gains the ref.
- `plugins/agents/src/contract/sessionExecute.ts` and
  `plugins/agents/src/server/sessions/sessionExecute.ts`: `configOptions`.
- `packages/protocol/src/workflow.ts`: `WorkflowInput`, the summary shape.
- `packages/node-core/src/server/notify.ts` and `packages/client-core/src/infra/node/wsClient.ts`:
  the frame's new fields and the `step-changed` channel.
- `plugins/workflows/src/shared/stepEvents.ts` (new): the event vocabulary from
  [03-step-kinds.md](./03-step-kinds.md), so phase 1 has a type to emit and phase 4 a type to draw.

## Tests

- `apps/node/test/integration/plugins/workflowRunner.test.ts`: two roots start before either
  finishes (assert on the fake `runStep`'s call order and overlap); a step with two `after` entries
  starts only after both are done; a `decide` skips the untaken branch's exclusive subtree and not a
  shared successor; `${inputs.x}` renders and a missing required input refuses the start; `append`
  produces one block per done predecessor; a `worktree` step creates a child task and cancel
  reaches it; retry resets the step and its skipped descendants and the run finishes `done`; a
  restart mid-parallel-run re-queues both running steps.
- `plugins/workflows/src/server/workflowFiles.test.ts` (new): every field parses; a file with no
  new keys produces the same definition as before (snapshot the existing fixture); sub-workflow
  expansion prefixes `after`.
- `plugins/workflows/src/server/workflowValidation.test.ts` (new): the cycle error names the
  cycle; a forward template reference to a non-predecessor is refused; a reference to a parallel
  sibling is refused; `isolation` on a `gate-human` is refused.
- `plugins/agents/src/server/sessions/sessionExecute.test.ts` (new or extended): `configOptions`
  reaches `patchSession` with the advertised values and an unknown value is dropped with a
  diagnostic.
- `plugins/workflows/src/server/routes/workflow.test.ts`: the start body's `inputs` validation; retry
  refused for a confined caller.

## Docs owed

Per [docs-migration.md](./docs-migration.md), phase 0 rows: `docs/workflows.md` § Execution
model (the graph, inputs, isolation, append mode, retry), `docs/api-reference.md` (retry, the start
body), `docs/managed-agents.md` (a workflow turn may carry config options),
`docs/future/orchestration.md` (the reversed refusals point here; step 9 marked as this folder's
phase 2).

## Doors left open

- `after` is the only edge form. If a conditional edge ever earns its place, it goes on the
  predecessor as a `decide`, not on the edge.
- Fan-out children stay child rows. Making each a graph node is possible later because they already
  carry `parentStepId`.
- A retry from an arbitrary done node needs the engine to unwind handoffs; the reset rule here is
  written so that extension is additive.

## Done when

- The owner's first workflow, as the TOML in [02-definition-model.md](./02-definition-model.md),
  runs from `.acorn/workflows/` in a task: the two investigators' sessions appear in the agent
  pane at the same time, the synthesiser's prompt carries both outputs, the gate rings the bell, and
  approving it finishes the run.
- A workflow file from before this phase produces byte-identical `defJson` and the same step order.
- `pnpm lint`, the workflows plugin's tests, the agents plugin's tests, and the node integration
  suite pass.

## Verify before building

- `plugins/workflows/src/server/workflowRunner.ts` `tick()` still picks one pending step by `idx`
  and awaits `execute` before looping.
- `WorkflowStepDef` in `plugins/workflows/src/shared/workflowContracts.ts` still has no `after`.
- `AgentSessionExecuteRequest` still has `model` and no `configOptions`;
  `plugins/agents/src/server/drivers/acpDriver.ts` `sendTurn` still ignores
  `effectivePolicy.model`; `runtime.patchSession` still accepts `config.configOptions`.
- `deps.notify` in `RunnerDeps` still takes `(taskId, kind, title)`.
- `apps/node/test/integration/plugins/workflowRunner.test.ts` still exists and drives the runner with
  a fake `runStep`.
- `core.tasks.createChild` still takes `(parentTaskId, { title, branch, prompt? })`.
- `@acorn/plugin-workflows/contract/*` is not in `packages/plugin-types/src/public.ts`, so the
  additive fields need no `PLUGIN_API_MAJOR` bump. If that has changed, they are optional fields and
  still need none, but say so in the change.
