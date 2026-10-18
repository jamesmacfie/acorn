# Workflows in the browser extension

This page covers workflows in the [browser extension](../browser-extension.md): starting one from a
[handoff](./handoffs.md) or from a task's **Runs** tab, the tab's runs and their steps, and the
operations behind them. The code is in `apps/extension/src/sidebar/Runs.tsx`,
`apps/extension/src/sidebar/WorkflowForm.tsx`, `apps/extension/src/sidebar/Handoff.tsx`,
`apps/extension/src/sidebar/Workspace.tsx`, and `apps/cli/src/browser/workflows.ts`. The sidebar draws statuses, icons, and durations from
`plugins/workflows/src/contract/statusDisplay.ts`, the module the desktop's run pane uses.

## Starting a workflow

A workflow starts in two places, and both draw the same picker and form from `WorkflowForm.tsx`:

- The handoff card's **Run workflow** picker lists the project's workflows, and the task chip's
  **Run workflow…** opens the [handoff card](./handoffs.md#the-handoff-card) with that picker open.
  A chosen workflow shows its inputs, filled from the item, with **Start run** and **Cancel**.
- A task's **Runs** tab has **Run workflow** in its header, with the task's project's workflows. See
  [starting a run in a task](#starting-a-run-in-a-task).

The picker groups the workflows under the project's name. Workflow definitions have no description,
so each row is a name.

The list is what a task in that project can run, by the desktop's rule for its own **Start
workflow…** box. The host reads the workflows plugin's merged list for the project's workspace and
keeps a definition only when:

- It has no known problems.
- It is a file, or a definition typed in the app that has been published.
- It belongs to no project, or to this one.

An input starts with the definition's default, then what the item fills in, through
`plugins/workflows/src/contract/itemInputs.ts`. The item's title and context fill `issue`, `item`,
and `context`, and its address fills `link` and `url` ([starting a run](../workflows/starting-runs.md#starting-a-run)). **Start
run** waits until every required input has a value and each typed value parses for its
schema.

**Start run** creates the item's linked task with `handoff.create`, then starts the run with
`workflow.start`. Both writes keep their keys, so pressing it again after one went unconfirmed makes
no second task or run. A start that the Node confirmed lets its key go, so the same workflow can run
again on purpose. A workflow from the repository's own config that Acorn doesn't trust yet is
refused, with a message to start it once in the desktop app, where the trust prompt is. Once the run
starts, the card closes, and the panel opens the new task on its **Runs** tab, with the run open.

## The Runs tab

A task shows **Runs** on its rail while the Node runs the workflows plugin, so a task with no run
yet still has one. A turning loader marks the tab while a run runs.

The tab is the kit's `Section`, headed **Runs** with the count and **Run workflow** at its right. Each
run is a kit `Row` with its status icon, turning while it runs, its name, when it started, and a
chevron. A click opens or closes it. The newest run starts open and the others closed, and more than
one can be open. Which runs the person opened or closed lasts while the panel is open, and isn't
stored.

An open run's steps follow it, each a kit `Row` with `nested`, which insets it behind a line down its
left. A step shows its status icon, a dashed circle for one not started, its name, and how long it
took. A step that ran an agent has a chevron and opens that conversation. The top bar names the step,
with the run above it, and **Back** returns to **Runs**. A step with no conversation, such as a gate or
one not started, has a dimmer name and does nothing.

A run's steps are read with `workflow.steps` when it opens and when its status changes. While an open
run is running, waiting on a person, or cancelling, the sidebar reads the runs, and the steps of each
open live run, every 3 seconds. A change hint for the task, or a reconnect, reads the runs again. A
Node without the workflows plugin answers the runs read with a failure, and no task shows the tab. A
task open on **Runs** then gives way to **Agents**.

A task with no run shows an empty state: a faint workflow icon, "No runs in this task", and **Run
workflow**.

### Starting a run in a task

**Run workflow** opens the kit's `Picker` on the workflows of the task's project, read with
`workflows.list` when the tab opens.

- A workflow whose every input has a default starts at once, with `workflow.start` and the task's ID.
- Any other shows the form under the header: the **Workflow** picker, a field per input with its
  default, **Start run**, and **Cancel**. No item fills the inputs here.

The new run shows at the top, open, and the others close. Each start uses a new key, kept while the
start is unconfirmed, so pressing it again after a lost reply starts no second run.

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
