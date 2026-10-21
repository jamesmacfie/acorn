---
title: Start and schedule runs
description: Start a workflow from the editor, the command palette, a pull request or issue, a commit, the command line, or an agent, and run one on a schedule or when records change.
sources:
  - docs/workflows/starting-runs.md
  - docs/workflows/triggers.md
  - docs/schedules/user-schedules.md
  - docs/cli/agents-and-workflows.md
  - plugins/workflows/src/client/triggers/TriggerDialog.tsx
  - plugins/workflows/src/client/triggers/triggerModel.ts
  - plugins/git/src/client/launchWorkflow.ts
checked: '2e987580a'
---

A run always belongs to a task. This page covers each way to start one, and how to run a workflow on a
schedule. Every run, however it starts, shows in its task's **Workflows** pane.

## Start a run in the app

- **From the editor.** **Run…** opens the start dialog, with a box for each input and a task picker
  when you're not in a task.
- **From the command palette.** **Run a workflow**, in a task, searches every workflow that task can
  run. A workflow with a required input opens the start dialog. **Find a run** searches this task's
  runs.
- **From a pull request, issue, or error.** **Start workflow…** in the menu on a GitHub pull request,
  a Linear issue, or a Rollbar error picks a workflow and fills in inputs named `issue`, `item`, or
  `context` with the item's title and text, and `link` or `url` with its address. A row that carries a
  typed record also fills `record` with the whole record, and `item` with its fields. Choose **New task**
  or **Attach to task**, then **Create & run** or **Attach & run**.
- **From a commit.** **Start workflow here** on a commit in the Git pane's history, or **Start workflow
  at … tip** on a branch, makes a task branched from that commit and starts the run on it.

A workflow made in the app runs its published version. A workflow file runs as it is on disk, once
you've trusted it, and acorn asks if you haven't.

## Start a run from the command line

```sh
acorn workflow list --task "$TASK_ID"
acorn workflow start --task "$TASK_ID" --definition repo:fix-and-review --inputs-file inputs.json
acorn workflow run wait "$RUN_ID" --until finished --check
```

- `workflow list` shows what the task can run. A file's ID starts `repo:` or `user:`, and a workflow
  made in the app has its own ID.
- `workflow start` takes the inputs as a JSON object, from a file or `-` for standard input, and
  returns the run once the Node has it. The run carries on after the command exits.
- `workflow run wait` waits for the run to finish, or with `--until attention`, to need you. `--check`
  exits 6 if the run failed. It never approves a gate.

`workflow run show` and `workflow run steps` read a run, and `workflow run list --task` lists a task's
runs. [The command line](/docs/automation/the-command-line/#agents-and-workflows) has more.

## Let agents start a workflow

An agent in a managed session can start a published workflow you've allowed it to:

1. Open the workflow in the editor, and choose **Agent invocation…** from **More actions**.
2. Choose which inputs an agent may set, the limits, and how many runs each session may start.

The agent's run starts after its current turn ends, and the run pane names the agent that started it.

## Run a workflow on a schedule

A workflow you made in the app, once published, can run on its own when a trigger starts it. Each
time, acorn makes a task and starts the run on it.

1. Open the workflow, and choose **Add trigger…** from **More actions**.
2. Under **When**, keep **On a schedule**, and pick the **Cadence**, such as **Every day at 09:00**,
   and the **Timezone**. Then pick the **Project** and the inputs.
3. For a workflow that runs once per record, choose what happens to records that already ran, under
   **Repeat handling**, and whether the first check runs on **Process current matches** or **Start
   tracking from now**.
4. Check **Next three checks**, which lists the next three times it will run, and the limits.
5. Click **Save draft** to keep it paused, or **Activate** to start it.

The **Workflows** list shows triggers in their own **Triggers** section. Each row says when it runs,
such as **Daily at 09:00**, and whether it's **Active**, **Paused**, **Needs review**, or
**Unavailable**. **Run now** starts a run straight away, even while paused. **Pause** stops future runs
without stopping one in progress, and **Delete trigger** keeps the runs it made. A run a trigger
started says so in its run pane, with **Open trigger**.

A triggered workflow runs the version you approved. If something it depends on changes, such as the
workflow being published again or a connection being removed, it stops and shows **Needs review**
rather than running something you didn't approve. **Approve changes** starts it again.

A trigger on a schedule won't start a run while the last one, or any child workflow it started, is
still going or waiting at a gate.

## Run a workflow when records change

A trigger can also start a run for each record that's new, starts matching, or changes, such as each
task whose title contains "triage". Each record gets its own task, named after the workflow and the
record, and a slow run never holds up the next record.

A new trigger opens on **Start from a suggestion**, which lists ideas from the sources your project
can read, such as **A pull request asks for your review**, **A new issue with a label** from Linear,
**An error seen more than once** from Rollbar, **A run fails**, and **A session needs you**. Picking
one fills steps 1 to 4 below, checking every 5 minutes, and you still edit any of it, such as the
label to look for. **Set it up yourself** starts from an empty form.

1. Open the workflow, choose **Add trigger…**, and under **When** pick **When records change**.
2. Under **Records from**, pick a source and add conditions, or pick a saved query.
3. Under **Start a run when a record**, pick **Is new**, **Starts matching**, or **Changes**. For
   **Changes**, pick the fields to watch.
4. Pick how often to **Check every**, from a minute to an hour. A source that says when its data
   changed makes the trigger check within seconds.
5. For each input, pick **From the record** and a field, or **Value**. Inputs named `issue`, `item`,
   `context`, `link`, `url`, or `record` fill the way **Start workflow…** fills them.
6. Click **Preview matches** to see what matches now and which records the first check would start.
   **Start tracking from now** starts none of them.

A trigger starts at most 10 runs a check, and the rest wait for the next one. After 50 runs in a day
it stops and shows **Needs review**. A trigger never starts a run for its own runs, or for the tasks it made for them.
Its dialog lists the last 50 records it started, and says when the last check read only part of the
results.

## In the terminal

The terminal client starts runs from the editor and the palette, and draws the trigger dialog.
**Start workflow…** on a pull request, issue, or error is desktop only.

## Limits

- Only a published workflow made in the app can have a trigger. A file can't.
- A trigger's **When** can't change kind after it's saved. Delete it and add another.
- Turning on a trigger needs a connection to the Node. acorn won't queue it to send later.
- Triggers run on the Node. The Node's scheduler times each one, so it's also listed in **Settings** >
  **Automation** > **Schedules** ([Schedules](/docs/automation/schedules/)), with **Open** to get back
  to it.
