# Workflows in the browser extension

This page covers workflows in the [browser extension](../browser-extension.md): starting one from a
[handoff](./handoffs.md), the **Workflows** tab that lists a task's runs and their steps, and the
operations behind them. The code is in `apps/extension/src/sidebar/Handoff.tsx`,
`apps/extension/src/sidebar/Workflows.tsx`, `apps/extension/src/sidebar/Workspace.tsx`, and
`apps/cli/src/browser/workflows.ts`. The sidebar draws statuses, icons, and durations from
`plugins/workflows/src/contract/statusDisplay.ts`, the module the desktop's run pane uses.

## Starting a workflow

The task chip's **Start workflow…** opens the [handoff card](./handoffs.md#the-handoff-card) with
the workflow form. The person picks the project, then one of its workflows, and answers its inputs.

The list is what a task in that project can run, by the desktop's rule for its own **Start
workflow…** box. The host reads the workflows plugin's merged list for the project's workspace and
keeps a definition only when:

- It has no known problems.
- It is a file, or a definition typed in the app that has been published.
- It belongs to no project, or to this one.

An input starts with the definition's default, then what the item fills in, through
`plugins/workflows/src/contract/itemInputs.ts`. The item's title and context fill `issue`, `item`,
and `context`, and its address fills `link` and `url` ([starting a run](../workflows/starting-runs.md#starting-a-run)). The
start button waits until every required input has a value and each typed value parses for its
schema.

**Start workflow** creates the item's linked task with `handoff.create`, then starts the run with
`workflow.start`. Both writes keep their keys, so pressing it again after one went unconfirmed makes
no second task or run. A workflow from the repository's own config that Acorn doesn't trust yet is
refused, with a message to start it once in the desktop app, where the trust prompt is. Once the run
starts, the card closes, the task becomes current, and the panel opens the Workflows tab on the run.

## The Workflows tab

The bottom bar shows **Workflows** while the task the Agents tab shows has at least one run. That
task is the page's own, or the current task on its project's site. The tab lists:

1. **Runs**, newest first, each with its status icon, its name, and when it started. A click chooses
   the run, and the newest is chosen until the person picks one.
2. **Steps** of the chosen run, each with its status icon, its name, and how long it took.

A step that ran an agent opens that conversation. The top bar names the step, with the run above it
and **Back** to the run's steps. A step with no conversation, such as a gate or one not started,
can't be opened.

While the chosen run is running, waiting on a person, or cancelling, the sidebar reads the runs and
its steps again every 3 seconds. A change hint for the task, or a reconnect, reads the runs again.
A Node without the workflows plugin answers the runs read with a failure, and the tab stays hidden.

## Native operations

| Operation | Fields | Result |
| --- | --- | --- |
| `workflows.list` | `nodeId`, `projectId` | `{ nodeId, projectId, workflows }`, each `{ id, name, inputs }` |
| `workflow.start` | `nodeId`, `taskId`, `defId`, `inputs`, `key` | `{ nodeId, taskId, runId }` |
| `workflow.runs` | `nodeId`, `taskId` | `{ nodeId, taskId, runs }`, newest first, each `{ id, name, status, createdAt, updatedAt }` |
| `workflow.steps` | `nodeId`, `taskId`, `runId` | `{ nodeId, runId, steps }`, each `{ id, name, status, createdAt, updatedAt, session }` |

`inputs` is optional, and its values are JSON. The Node checks them against the definition. A step's
`session` is the agents plugin session it ran, as `sessions.list` returns one, or null. The host finds
it among the sessions of the run's task, and of any task the runner gave a step of its own. It matches
the session the step's row names, or, for a running step whose row names none, the session the agents
plugin started for that step.

## Gaps

- The card, the tab, and the operations were checked in unit tests only, not in a browser against a
  Node running a workflow.
- The host looks for a step's conversation among each task's newest 100 sessions, so in a busy task
  an old step's conversation can be missing and its row can't be opened.
- A run's status and steps change without a change hint the bridge passes on, which is why a live run
  is read again on a timer.
