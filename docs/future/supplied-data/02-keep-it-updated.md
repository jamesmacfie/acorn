# Phase 2: keep a supplied panel up to date

Date: October 20, 2026. Status: proposed. Needs [phase 1](./01-supplied-rows.md).

## Goal

**Add to dashboard** on a panel over supplied rows offers two choices: place the snapshot as it is,
or keep it up to date. Keeping it creates an agent-fed dataset from the snapshot's fields, moves its
rows in, and points the placed panel at the dataset. From then on, an agent refreshes it on request
or from a schedule.

## Starting point

- `datasetCreateSchema` in `packages/protocol/src/data/datasets.ts` takes a name, scope, mode,
  feeder, JSON `schema`, `fields`, and identity fields. Only the person's device can create one
  (`packages/node-core/src/server/routes/datasets.ts`).
- `dataset_write` adds rows to an agent-fed dataset, each with evidence and a reason. The Node takes
  the workspace and project from the task, and refuses another task's dataset, a stale schema
  version, and malformed rows ([agent tools](../../agent-tools.md)).
- A dataset appears in **Pick data** as a core source, with coverage labels, corrections, retention,
  and caps ([dashboards](../../dashboards.md#datasets-and-history)).
- Phase 1's supplied rows carry the same `schema` and `fields` shapes a dataset takes.

## The design

### Making the dataset

Choosing **Keep it up to date** opens a short sheet, filled in from the snapshot:

- The dataset's name, from the panel's title.
- Its scope: the task's project, or its workspace.
- Its mode. **Latest state** suits a table that's replaced each time, such as a forecast.
  **Daily snapshots** suits a number tracked over time, such as commits per repository per day.
  **Every event** suits rows that each happened once, such as releases. The sheet suggests one from
  the fields and the person can change it.
- Its identity fields, suggested from the fields and editable.
- The origin line and URLs from the snapshot, kept as the dataset's description.

On **Create**, the person's device creates the dataset with feeder `agent`, writes the snapshot's
rows as the first capture with the origin as their evidence, and places the panel with its source
switched to the dataset. The plan's stages and view don't change.

### Refreshing it

A kept panel shows **Ask an agent to refresh**. It opens a new agent turn in the task that made the
panel, with a prompt naming the dataset and the snapshot's origin. The agent gathers fresh rows and
writes them with `dataset_write`.

For a regular refresh, the sheet offers **Refresh on a schedule**. It creates a workflow with one
agent step that does the same, and a schedule that runs it. The person approves the schedule as any
other ([schedules](../../schedules.md)).

Both paths go through `dataset_write`, so every row has evidence, and a person's corrections survive.

### What a kept panel shows

The panel's origin line becomes the dataset's coverage label, such as "Refreshed by an agent, 6:02
AM". A refresh that fails or is overdue shows as a gap, as a dataset capture's failure does today.

## Steps

1. Add the two choices to **Add to dashboard** for a panel over supplied rows.
2. Add the sheet, with mode and identity suggestions and their tests.
3. Create the dataset, write the first capture, and switch the placed panel's source, in one device
   action that undoes itself on failure.
4. Add **Ask an agent to refresh**, and the schedule option through a workflow.
5. Document the flow in [dashboards](../../dashboards.md#datasets-and-history) and the agent's side
   in [agent tools](../../agent-tools.md).

## Acceptance

- In `pnpm dev:agent`, a supplied forecast panel kept from a card lands on Home, reading from a new
  dataset with the snapshot's rows and its origin as evidence.
- **Ask an agent to refresh** runs a turn that writes new rows, and the panel shows them.
- A scheduled refresh writes rows on its schedule, and a failed run shows as a gap.
- A correction a person makes to a kept row survives the next refresh.
- Choosing **Place as a snapshot** places the panel as phase 1 drew it, with its date.
