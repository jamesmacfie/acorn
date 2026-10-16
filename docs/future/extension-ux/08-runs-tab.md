# Phase 8: a task's Runs tab

Date: October 16, 2026. Status: proposed. Depends on [phase 1](./01-navigation.md). Reuses the
workflow form from [phase 5](./05-this-page.md).

## Goal

A task's Runs tab lists its runs with each run's steps open under it, so it's clear which run a step
belongs to. A step with a conversation opens it. **Run workflow** starts a run in this task. Today a
workflow starts only from an issue page.

## In the prototype

- Scenario: **Runs**. Open and close a run, open the **implement** step, and go back. Then use **Run
  workflow**.
- Notes: `runs` at line 1314, including the box saying no new bridge operation is needed.
- Code: `runsView` at line 994 draws the tab. The `runwf` case of `pickerSpec` at line 1080 lists the
  workflows. The `runwf` branch of the `pick` action at line 1509 starts the run and opens it.
- Today: `references/extension-ux/today/08-workflows-dark.png`.

## Starting point

- `apps/extension/src/sidebar/Workflows.tsx` lists a task's runs, newest first, then the chosen run's
  steps in a second list below. A running run is read again every 3 seconds.
- Statuses, icons, and durations come from `plugins/workflows/src/contract/statusDisplay.ts`, the
  module the desktop's run pane uses.
- `workflows.list` and `workflow.start` already exist. `workflow.start` takes a `taskId`.
- The handoff card in `apps/extension/src/sidebar/Handoff.tsx` draws a workflow's inputs.

[Workflows](../../browser-extension/workflows.md) documents today's behavior.

## The design

### The list

A **Runs** section header with the count and, at its right, **Run workflow**: a small button with a
play icon and a chevron.

Each run is a row: its status icon, spinning while it runs, its name, and at the right the time since
it started and a chevron. A click opens or closes it. The newest run starts open, and the others
closed. More than one can be open.

An open run's steps follow it, indented, joined by a thread line down their left, as `.step` in the
prototype's CSS draws it. Each step has its status icon, a dashed circle for one not started, its
name, and how long it took. A step that ran an agent has a chevron and opens its conversation with
`openConversation(sessionId, 'runs')`. Back from there returns to Runs. A step with no conversation
is drawn dimmer and does nothing.

Read a run's steps when it opens, with `workflow.steps`. Keep reading an open, running run every 3
seconds, as today.

### Run workflow

**Run workflow** opens the kit's `Picker` with the placeholder "Filter workflows", its rows under a
group named for the task's project, each with the workflow's description.

- A workflow with no input that lacks a value starts at once: `workflow.start` with this task's ID.
  The new run opens at the top, and the others close.
- A workflow with inputs shows phase 5's form inline, under the header, with **Start run** and
  **Cancel**. Inputs start from their defaults. No item fills them here.

Use a fresh operation key for each start, and keep it while a start is unconfirmed, as the handoff
card does, so a second press after a lost reply starts no second run.

A Node without the workflows plugin has no Runs tab, as phase 1 says.

### Empty

A task with no run shows an empty state: a faint `workflow` icon, "No runs in this task", and **Run
workflow**.

## Changes

1. Redraw `Workflows.tsx` as the list above, with steps under their run. Rename it `Runs.tsx`.
2. Add **Run workflow** with its picker, and pull the workflow form out of `Handoff.tsx` into a
   component both use.
3. Open a step's conversation with `from: 'runs'`.
4. Add the empty state.
5. Test opening and closing runs, a step with and without a conversation, a start with and without
   inputs, and a repeated start after a lost reply.
6. Rewrite [Workflows](../../browser-extension/workflows.md) for the tab's new name and shape.

## Acceptance

- A task with two runs shows both, with the newest open and its steps under it.
- The running step of a running run spins and opens its conversation. Back returns to Runs.
- **Run workflow** › **Triage**, a workflow with no inputs, starts a run in this task. It shows at the
  top, open.
- **Run workflow** › **Fix an issue** shows the **Issue** field before starting.
