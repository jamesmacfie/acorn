# Phase 2: keep a supplied panel up to date

Date: October 20, 2026. Status: built on branch `phase-2-keep-it-updated`, not merged. Needs
[phase 1](./01-supplied-rows.md).

## Completion note

Built October 20, 2026. **Add to dashboard** on a panel over supplied rows offers **Place as a
snapshot** or **Keep it up to date**. Keeping it makes an agent-fed dataset from the snapshot, places
a panel that reads it, and can schedule an agent to refresh it.
[Supplied rows](../../dashboards/supplied-rows.md#keeping-it-up-to-date) documents the result.

### What landed

- **Protocol.** `datasetCreateSchema` takes `rows`, an agent dataset's first write, and `refresh`:
  the project whose tasks may write it, the task to ask, the origin, and an optional cadence in
  seconds. `refresh` is only for a workspace agent dataset. `suppliedOriginSchema` is shared with the
  plan. A source description's `dataset` gains `refreshedAt`, and a run's source diagnostics carry
  `dataset`. `DatasetSummary` gains `refresh`.
- **Node.** `createDataset` writes the first rows in its own transaction, so a bad row leaves no
  dataset. Every agent write records a capture, which is the "refreshed at" time. A workspace dataset
  is writable by the project its `refresh` names (`assertDatasetWriteScope`), and by no other.
  `overdueRefresh` adds a coverage gap when a scheduled refresh is a quarter of its cadence late, at
  most an hour. It's computed when the dataset is described, not stored.
- **Client.** `keepUpdated.ts` holds the suggestions, the create body, `keptPlan`, and
  `refreshPrompt`. `KeepUpdatedSheet` is the sheet. `KeptOrigin` draws "Refreshed by an agent" and
  **Ask an agent to refresh** on any panel over an agent-fed dataset.
- **Plugins.** Core declares two client capabilities in `refreshCapabilities.ts`, exported through
  `@acorn/plugin-api/client`. The agents plugin provides `AGENT_ASK`: a new session in the task, sent
  the prompt. The workflows plugin provides `AGENT_PROMPT_SCHEDULES` (`scheduleAgentPrompt`): it
  publishes a one-step agent workflow and approves a schedule for it, and takes both back when a
  step fails.
- **Tests.** `keepUpdated.test.ts`, `KeepUpdatedSheet.test.tsx`, the new cases in
  `PanelToolCard.test.tsx`, `PublishedDashboardPanel.test.tsx`, and `store.test.ts`, and
  `agentPromptSchedule.test.ts`.

### Decisions and deviations

- **Workspace scope only.** A placed panel runs at workspace scope, and a workspace query can't read
  a project dataset, so a project-scoped dataset couldn't draw on Home. The sheet has no scope choice.
  The dataset is workspace-scoped and the task's project is its only writer, through `refresh`.
- **Two capabilities, not one route.** Client-core can't call a plugin's routes
  (`tools/arch/boundaries.test.ts`), so the manual refresh and the schedule go through capabilities
  that core declares and the plugins provide. With a plugin off, its button or choice is hidden.
- **The manual refresh is a new session, sent at once.** It isn't a workflow run, as the phase doc
  says. The scheduled refresh is a workflow with one agent step, as the doc says.
- **The schedule is approved in the sheet.** The person confirms the cadence in the host's confirm
  dialog, then the sheet approves the schedule. Only every day at 09:00 or every hour is offered, as
  **Keep history** offers. The schedule shows in Workflows like any other.
- **Overdue is measured against the sheet's cadence.** The dataset stores the cadence as
  `refresh.every`. A schedule edited later in Workflows doesn't update it. The code marks this as a
  shortcut.
- **A failed run has no record of its own.** A failed or missing refresh writes nothing, and the gap
  appears once the refresh is overdue. Nothing records the run's failure on the dataset directly.
- **No description column.** The origin goes in each first row's evidence and in `refresh.origin`,
  which the feeder config column holds, so there's no migration.
- **Latest state keeps old rows.** An agent write upserts by identity and doesn't mark rows missing
  from the refresh as removed, unlike a capture. A forecast keeps past days until retention removes
  them. Changing `dataset_write` to remove them would break agents that write a few rows at a time.
- **Daily snapshots draw every day's rows.** The kept plan's stages don't change, so a snapshots
  panel sums across days until someone groups it by **Observed** in the studio.
- **Entrypoint cap.** `@acorn/client-core` goes from 204 to 205 entrypoints for
  `refreshCapabilities.ts`.

### Still open

- **Service size budget.** The Node's static graph is 1,915,026 bytes on this branch and 1,914,527
  on the base, `39aa18d59`. That's 499 bytes more and 926 over the 1,914,100 ceiling. The growth is
  the create schema's `rows` and `refresh` in `datasets.ts`, which `routes/datasets.ts` reaches at
  boot. The store and the description code stay behind dynamic imports. The ceiling is unchanged,
  for the coordinator to raise.
- **Real-app checks.** `pnpm dev:agent` ran with `--prepared`, with a seeded `panel_show` card over a
  supplied forecast. **Add to dashboard** showed both choices and the sheet opened with **Latest
  state** and **Day** suggested. **Create** then failed: the card sends `workspaceId: ""` on every
  request in that session, which also fails **Place as a snapshot** and is phase 1's code, not this
  phase's. The cause isn't found. The project memory
  `panel-card-sends-empty-workspace-in-dev-agent` has what was ruled out. The same request with the
  workspace filled in, sent to the Node from the window, made a workspace dataset with three rows,
  the origin as each row's evidence, one capture, and `refreshedAt` in its description. Not checked
  in the real app: a kept panel on Home, **Ask an agent to refresh** with a real agent, a scheduled
  refresh and its overdue gap, and a correction surviving a refresh. Unit tests cover each.

### For later phases

- Phase 3 needs nothing from this phase. A code search panel is live, so it never shows **Keep it up
  to date**.
- An agent can find a kept dataset through `data_sources_list`, as `core:dataset:<id>`, and write it
  only from its `refresh` project.

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
