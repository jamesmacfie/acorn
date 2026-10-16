---
title: Workflows and plugin panels
description: Start a workflow from the browser panel, on an item or in a task, follow a task's runs and steps there, and read a plugin's panel about the task.
sources:
  - docs/browser-extension/workflows.md
  - docs/browser-extension/plugin-panels.md
  - apps/extension/src/sidebar/Handoff.tsx
  - apps/extension/src/sidebar/Runs.tsx
  - apps/extension/src/sidebar/WorkflowForm.tsx
  - apps/extension/src/sidebar/PluginPanel.tsx
checked: 97ab4d104
---

The browser panel can start a workflow on the item you're looking at, such as a pull request, or in a
task you have open, and follow the task's runs while they work. A plugin can also add a panel of its own about the task. This page
covers both.

## Start a workflow on an item

1. On the item's page, open the handoff card under **This page** on Home, or choose **Start
   workflow…** from the chip's **Start task** menu.
2. Pick the project if several track the item, then click **Run workflow** and pick the workflow. The
   list has the workflows a task in that project can run: files in the repository or yours, and
   workflows made in the app that are published. A workflow with problems isn't listed.
3. Check its inputs. Inputs named `issue`, `item`, or `context` start with the item's title and
   description, and `link` or `url` with its address. A required input is marked with a red asterisk.
4. Click **Start run**, or **Cancel** to go back to **Create task**.

   acorn makes a task linked to the item, starts the run on it, and opens the task's **Runs** tab with
   the run open.

A workflow file acorn hasn't been told to trust yet is refused here. Start it once in the desktop app,
where acorn asks you to trust it ([Workflows](/docs/automation/workflows/#where-workflows-come-from)).
Pressing the button again after a slow answer doesn't start a second run.

## Follow a task's runs

Each task in the panel has a **Runs** tab while your Node runs workflows. A spinner marks it while a run
is going. It lists the task's runs, newest first, each with its status and when it started.

Click a run to open or close it. The newest starts open, and you can open several. An open run shows
its steps under it, each with its status and how long it took.

Click a step that ran an agent to open its conversation. **Back** returns to **Runs**. A gate, or a step
that hasn't started, is dimmer and has nothing to open. To approve a gate or retry a step, open the run
in the desktop app.

While an open run is going or waiting on you, the panel reads it again every three seconds.

## Start a workflow in a task

1. Open the task's **Runs** tab and click **Run workflow**, beside the **Runs** heading. A task with no
   run has the button in the middle of the tab.
2. Pick the workflow. The list has the workflows a task in the task's project can run.
3. A workflow whose inputs all have defaults starts at once. Otherwise fill in its inputs and click
   **Start run**, or **Cancel**.

The new run shows at the top, open. Pressing **Start run** again after a slow answer doesn't start a
second run.

## Plugin panels

A plugin can show a read-only panel about the task, such as the state of the app it's running for it.
When the task has one, its name and icon join the task's tabs, after **Runs**.

A panel can show:

- A state line, with detail.
- Links, each with **Copy**, and **Open** for a web address.
- Rows, each with a state.
- Logs, with a choice of source.

**Refresh** reads it again, and **Open in Acorn** opens the task in the desktop app on the plugin's pane.
Anything that changes something happens there, not in the panel.

None of the plugins acorn ships has a browser panel. A plugin you install can add one.

## Limits

- The panel follows runs. Approving, cancelling, and retrying are in the desktop app.
- A step whose conversation is older than the task's newest 100 can't be opened from the panel.
- A plugin panel closes when the page moves to one no task holds, or to a task it has nothing for.
