---
title: Automation
description: Every setting in the Automation group, for schedules, datasets, run history, and workflows.
sources:
  - docs/frontend/settings-groups.md
  - docs/schedules.md
  - packages/client-core/src/features/settings/corePages.ts
  - packages/client-core/src/features/settings/SchedulesSettings.tsx
  - packages/client-core/src/features/settings/DatasetsSettings.tsx
  - packages/client-core/src/features/settings/RunsSettings.tsx
  - plugins/workflows/src/client/index.ts
covers:
  - schedules
  - datasets
  - runs
  - workflows
checked: 52225e24f
---

This page lists every setting in **Settings** > **Automation**. Every page here is stored on the Node,
because a schedule and a run happen on one machine. With more than one Node, the page's header picks
which Node.

## Schedules

Every schedule on the Node: acorn's own upkeep, the ones plugins register, and ones you add. Each row
names its owner, says when it runs next and last ran, and has **History** and **Run now**.

| Setting | What it changes | Stored on | Default |
| --- | --- | --- | --- |
| **Pause every schedule on this node** | Stops every schedule until you turn it off. Each keeps its settings. | Node | Off |
| **Run … on its schedule**, on each row | Pauses or resumes one schedule. | Node | As its owner registered it |

**New schedule** adds one, from the actions plugins offer to run on a timer:

| Field | What it sets |
| --- | --- |
| **Action** | What runs. The page says what the action does and its risk, and asks you to accept that risk once. |
| **Name** | What the schedule is called. |
| **When** | How often it runs, such as every hour or every day. |

When no plugin offers an action, the section says nothing on this Node can be scheduled.

## Datasets

Copies of provider and workflow data the Node keeps, such as for a dashboard's history. Each dataset
shows its mode, what feeds it, its row count and size, how many days it keeps rows, and which periods
it covers. What feeds a dataset on a timer is set in **Schedules**.

| Setting | What it changes | Stored on | Default |
| --- | --- | --- | --- |
| **Delete** | Deletes the dataset and its stored rows. | Node | |

## Run history

**Recent runs** lists workflow runs and agent sessions that ran on the Node, with their cost where
known. **Refresh** reads it again. Nothing to set.

## Workflows

The Workflows plugin's page. **Loaded workflows** lists the workflows the open task can run, and any
that failed to load. **Rescan** reads the task's `.acorn/workflows/` folder again. Nothing to set.

## In the terminal

**Workflows** draws in the terminal client. **Schedules**, **Datasets**, and **Run history** open in the
desktop app.
