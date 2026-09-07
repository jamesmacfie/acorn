# Runs and live state

Part of [docs/future/workflows/](./README.md). Status: design, 2026-09-08. Phase 0 builds the
engine half; phase 4 draws it.

## The parallel tick

`WorkflowRunner.tick(runId)` today loops: load the run, find the first `pending` top-level step, run
it to completion, repeat. It becomes:

1. Load the run. If it is not `running`, stop.
2. Load the top-level steps. If any is `failed` or `safety-rail`, finish the run with that status
   (unchanged; this is the restart-recovery path).
3. Compute the ready set: every `pending` step whose `after` names only `done` or `skipped` steps.
4. If the ready set is empty and no step is `running` or `waiting-gate`, finish the run `done`.
5. Start every ready step without awaiting it. Each start registers its abort controller under the
   run and step, runs `execute`, and on completion calls `tick(runId)` again.
6. Return.

The re-entrancy guard (`#activeRuns`) stays and means "a tick is computing"; it no longer means "a
step is executing". `execute` and `persistOutcome` keep their bodies. `applyBranch` changes only
in how it finds what to skip (the graph rule in [02-definition-model.md](./02-definition-model.md)
§ `decide` in a graph) and no longer uses `idx` ordering.

The headless semaphore is unchanged: parallel agent steps queue on the same four slots fan-out
children do.

`reconcile()` is unchanged. A `running` step swept to `pending` is ready again on the next tick if
its predecessors are done.

## `idx` after the change

`idx` stays as the declaration order and nothing but the row insert reads it. `decide` and `join`
stop comparing it. The run pane orders nodes by the longest path from a root, then by `idx`.

## Isolation

For a step with `isolation = "worktree"`, `execute` asks `deps.createChildTask(run.taskId, { title:
"<run name>: <step name>", branch: <slug of both> })` before dispatching, writes `{ childTaskId }`
into the step's `inputsJson` beside the rendered prompt, and passes the child's id as the task the
handler runs on. `cancelRun` already reads `childTaskId` out of `inputsJson`.

## Retry

`POST /v2/p/workflows/workflows/runs/:runId/retry { stepId, prompt? }`:

1. The run must be `failed` or `safety-rail`; the step must be `failed` or `safety-rail` and a
   top-level row.
2. The step goes back to `pending`, with `error` cleared and `iteration` kept. If `prompt` is
   given and the step's kind runs an agent, the run's frozen `defJson` is patched for that step only
   and the patch is recorded in `inputsJson.retryPrompt`, so the definition the run shows still says
   what was asked. The original prompt is kept in `inputsJson.originalPrompt` on the first retry.
3. Every step whose only path to a root passes through the retried step and that is `skipped`
   goes back to `pending`. Steps that are `done` stay done.
4. The run goes back to `running` and `tick` is called.

A step with a managed session reuses it: `sessionExecute` already accepts `managedSessionId`, and a
retry with an edited prompt is a new turn in the same session, which is what a person watching the
agent pane expects.

Ownership: the route sits under the existing `ownsRun` middleware. Retry is a device action; a
task-confined caller (an agent) may not retry its own run, because the agent could then loop a
failed step without a budget check. The budget rule stays: a retry's usage adds to the run's persisted
sum, and the same safety rail fires.

## What goes over the socket

Existing frames, unchanged shape: `workflow:step:event { runId, stepId, event }` per step event,
`plugin:workflows:run-changed { runId, status }` when a run begins or ends.

Changed frame: `workflow:notice`. Today `{ taskId, kind: 'gate' | 'run-done', title }`. It gains
`runId?`, `stepId?`, and a third kind:

```ts
type WorkflowNoticeFrame = {
  channel: 'workflow:notice'
  notice: {
    taskId: string
    kind: 'gate' | 'run-done' | 'run-failed' | 'repo-config-trust' | 'plugin-request'
    title: string
    action?: string
    runId?: string
    stepId?: string
  }
}
```

The two non-workflow kinds already ride this channel from core (`packages/node-core/src/server/notify.ts`)
and are untouched. `deliverNotice` in `deliver.ts` builds `target: { kind: 'workflow-run',
resourceId: runId, subresourceId: stepId }` when `runId` is present.

New frame: `workflow:step-changed { runId, stepId, status }`, sent from `setStep` when `status`
changes. The run pane updates a node's glyph from it without re-reading every step on every event.
The full re-read happens on `run-changed` and when a run is opened.

## Notices and attention rows

| Moment | Notice | Attention row | Target |
| --- | --- | --- | --- |
| A step parks at `gate-human` | yes, `gate` | yes, `warn`, id `workflow:gate:<stepId>`, kept until the gate resolves | run pane, node selected |
| A run ends `failed` or `safety-rail` | yes, `run-failed` | no | run pane, the failed node selected |
| A run ends `done` | yes, `run-done` | no | run pane, run selected |
| An agent inside a run asks a permission question | the agents plugin's own | the agents plugin's own, with `detail` naming the workflow and step | agent pane, unchanged |

The attention source is the workflows plugin's client half (`ctx.attentionSources.register`). Its
`fetch(nodeId)` reads `GET /v2/p/workflows/runs?status=gated` on that node and maps each gated run's
waiting step to a row. It must not read the active node, because the inbox fans out across the
fleet. The row's `at` is the step's `updatedAt`, not the fetch time.

The notice target handler `workflow-run` is registered by the same client half:
`openPane(taskId, 'workflows', { kind: 'workflows:show-run', runId, stepId })`. The pane intent
union in `clientEvents.ts` gains that member.

## The merged run list

Unchanged. `GET /v2/p/workflows/runs` keeps answering the merged list's shape. A `detail` of a
running run becomes "n of m nodes done, running: a, b" so the Settings list says something useful
about a parallel run.
