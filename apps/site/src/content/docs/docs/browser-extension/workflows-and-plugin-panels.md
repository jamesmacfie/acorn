---
title: Workflows and plugin panels
description: Start a workflow on an item from the browser panel, follow a task's runs and steps there, and read a plugin's panel about the task.
sources:
  - docs/browser-extension/workflows.md
  - docs/browser-extension/plugin-panels.md
  - apps/extension/src/sidebar/Handoff.tsx
  - apps/extension/src/sidebar/Workflows.tsx
  - apps/extension/src/sidebar/PluginPanel.tsx
checked: 07aa959a0
---

The browser panel can start a workflow on the item you're looking at, such as a pull request, and follow
the task's runs while they work. A plugin can also add a panel of its own about the task. This page
covers both.

## Start a workflow on an item

1. On the item's page, open the chip's **Start task** menu and choose **Start workflow…**.

   The panel opens on the handoff card, with the workflow form.

2. Pick the project, then the workflow. The list has the workflows a task in that project can run:
   files in the repository or yours, and workflows made in the app that are published. A workflow with
   problems isn't listed.
3. Fill in its inputs. Inputs named `issue`, `item`, or `context` start with the item's title and
   description, and `link` or `url` with its address.
4. Click **Start workflow**.

   acorn makes a task linked to the item, starts the run on it, and opens the **Workflows** tab on the
   run.

A workflow file acorn hasn't been told to trust yet is refused here. Start it once in the desktop app,
where acorn asks you to trust it ([Workflows](/docs/automation/workflows/#where-workflows-come-from)).
Pressing the button again after a slow answer doesn't start a second run.

## Follow a task's runs

The bar at the bottom of the panel shows **Workflows** while the page's task has a run. It lists:

1. **Runs**, newest first, each with its status and when it started. The newest is chosen until you
   pick another.
2. **Steps** of the chosen run, each with its status and how long it took.

Click a step that ran an agent to open its conversation, with **Back** to the steps. A gate, or a step
that hasn't started, has nothing to open. To approve a gate or retry a step, open the run in the
desktop app.

While a run is going or waiting on you, the panel reads it again every three seconds.

## Plugin panels

A plugin can show a read-only panel about the task, such as the state of the app it's running for it.
When the page's task has one, its name and icon join the bar at the bottom, after **Workflows**.

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
