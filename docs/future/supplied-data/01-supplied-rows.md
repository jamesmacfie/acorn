# Phase 1: let a plan carry its own rows

Date: October 20, 2026. Status: built on branch `phase-1-supplied-rows`, not merged. Needs nothing.

## Completion note

Built October 20, 2026. A plan source can hold rows an agent supplied. `panel_show`, the run route,
an app's `Panel`, and a dashboard draw them with every view, under a line saying where they came
from. [Supplied rows](../../dashboards/supplied-rows.md) documents the result.

### What landed

- **Protocol.** `panelPlanSchema` takes a source reference of kind `supplied`, with `origin`,
  `schema`, `fields`, and `rows` (`SuppliedRows`, `SUPPLIED_ROW_LIMITS` in
  `packages/protocol/src/dashboards/panels.ts`). The schema checks each row against `schema` and
  reports up to 10 bad rows, each with a path such as `/sources/0/reference/rows/1/high`. It also
  checks the 1,000-row and 256 KiB caps, that every field is in the schema, and that each origin URL
  is `https`.
- **Runner.** `suppliedPlanSource` and `suppliedRead` in `packages/dashboards-core/src/supplied.ts`
  describe the source from its own schema and fields and read its rows, complete. `runDashboard`,
  `dashboardContentProblems` (what `panel_show` and publication run), and the studio AI's authoring
  route use them. `validatePanelPlan` refuses a supplied source that isn't the plan's only source.
- **Client.** `SuppliedOrigin` draws the line, with each URL as a link. `PublishedDashboardPanel`
  shows it and hides **Refresh**, so a card, an app's `Panel`, and a placed panel all get it.
  **Add to dashboard** publishes the snapshot as it is. The studio shows the line in place of the
  source picker and feeds the rows' fields to the column forms.
- **Guide.** `panel_guide` gains a chat-only `suppliedRows` section and a worked plan that charts
  commits by repository. The studio's `PANEL_AUTHORING_INSTRUCTIONS` doesn't change, because the
  studio AI can't gather rows. The app guide needed nothing: its `plans` field is the panel guide.
- **Tests.** `packages/node-core/src/server/dashboards/supplied.test.ts` runs a list, a table, a
  line, bars, a heatmap, and the guide's example through `runDashboard`, and checks the failure
  messages. `PublishedDashboardPanel.test.tsx` checks the line, the missing **Refresh**, and that
  HTML and a `javascript:` link draw as text.

### The two questions

1. **Where a card's plan runs.** On the Node. A card, an app's `Panel` (`PlanPanel`), and a placed
   panel all draw `PublishedDashboardPanel`, which posts the plan to `POST /v1/core/dashboards/run`
   (`runDashboard`). Past describing and reading, the run path assumes a registered source in one
   place: a filter on You asks the first source for the viewer's identity, and a supplied source
   can't answer, so such a plan fails with a problem. Outside the run, five callers assumed one:
   `describePanelSources` before publishing, the studio's source inspector, the studio AI's
   authoring route, `pluginInputUsage`, and the dataset drill-down route. Each handles the kind.
2. **What a description gives that `schema` and `fields` don't.** Nothing the validator or the
   views read. Field roles, display kinds such as `datetime`, units, choice lists, and query
   operators all live in `fields`. A description's other parts are `operations`, `revision`,
   `consistency`, parameters, coverage, `writable`, `actions`, `targets`, `relations`,
   `starterPlans`, `reach`, `projectScope`, and `dataset`. The supplied description fills the
   required ones with fixed values and leaves the rest out. So a supplied panel has no board writes,
   no row actions or targets, and no relations, and its outline reads its `consistency` sentence.

### Decisions and deviations

- **Not in `queryReferenceSchema`.** The doc said to add the kind there. That schema also types
  workflow steps, the saved-query library, and the plugin API's `queries.resolve`, none of which can
  take rows. The kind lives on the plan's source reference (`planSourceReferenceSchema`) instead.
- **Only source, not only primary.** Equivalence joins two primary sources without a declared
  relation, so "only primary" would still let an agent's rows merge with Acorn's records.
- **Defaults taken.** Decision 1: 1,000 rows and 256 KiB per source. Decision 2: **Add to
  dashboard** places the snapshot, line included.
- **Not done.** A plan's `refresh` interval isn't refused on a supplied plan. A rerun returns the
  same rows.

### Still open

- **Service size budget.** The Node's static graph is 1,914,527 bytes on this branch and 1,912,094
  on the base, `a06946dc2`. That's 2,433 bytes more and 427 over the 1,914,100 ceiling. The growth
  is the new schema in `panels.ts` and `supplied.ts`, which `routes/datasets.ts` reaches at boot
  through `plan.ts`. The ceiling is unchanged, for the coordinator to raise.
- **Real-agent check.** The acceptance check in `pnpm dev:agent` didn't run. The launcher fails on
  the size budget, and auto mode refused building the automation shell by hand. Once the ceiling is
  raised, run `pnpm dev:agent -- --session supplied`. Ask a Claude agent in a task to chart your
  commits across every repository under `~/Source` this month, and check for a bar panel with the
  origin line.
- **Older clients.** An older client's card can't parse the plan. It says the plan didn't pass its
  checks, shows the call's output, and keeps the call. An older client doesn't parse a published
  revision, so it draws a placed snapshot with no origin line and a **Refresh** that changes nothing.

### For later phases

- Phase 2 copies `schema`, `fields`, and `rows` into `datasetCreateSchema`. The fields already sit
  in the schema, which `createDataset` checks. An agent-fed dataset also needs `evidence`, `reason`,
  and a nullable `correction` in its schema, plus `identityFields` and a mode. Supplied rows carry
  none of those, so the promotion step adds them.
- The **Add to dashboard** menu is in `PanelToolCard.tsx` and calls `addNewPanel`. A supplied
  panel's records name the source `core:supplied`, with the row's index as the record ID.

## Goal

A plan source can hold rows the agent supplied, instead of naming a registered data source.
`panel_show` validates them, the panel card draws them with every existing view, and an app's
`Panel` draws them the same way. The card says where the rows came from and when the agent read
them. The panel guide teaches agents when supplied rows are the right answer, and when the answer
isn't data at all.

## Starting point

- `queryReferenceSchema` has two kinds, `inline` and `saved`, and both name a registered source
  (`packages/protocol/src/data/queries/dataQueries.ts`).
- `planProblems` in `packages/node-core/src/server/agentTools/panelShow.ts` checks a draft plan's
  shape, then runs `dashboardContentProblems`, which describes each source before it validates the
  plan against it.
- `runDashboard` in `packages/node-core/src/server/dashboards/run.ts` runs a plan: it reads each
  source, then applies the plan's stages.
- A dataset declares its rows with a JSON `schema` and a `fields` list (`dataFieldsSchema`), in
  `packages/protocol/src/data/datasets.ts`.

Before building, confirm two things and record the answers in the completion note:

1. Where a panel card's plan runs, on the Node or in the client, and whether the run path assumes a
   registered source anywhere past describing and reading it.
2. What a source description gives the validator and the views that a `schema` and `fields` pair
   doesn't, such as field roles, time fields, or choice lists.

## The design

### The reference

Add a third kind to `queryReferenceSchema`:

```ts
{
  kind: 'supplied',
  origin: { says: string, urls?: string[], readAt: number },
  schema: <the same JSON schema a dataset takes>,
  fields: <dataFieldsSchema>,
  rows: unknown[],
}
```

- `origin.says` is one line the agent writes, such as "Open-Meteo forecast for Wellington". `urls`
  lists where it read the data, `https` only. `readAt` is when it read it.
- `schema` and `fields` use the dataset shapes, so phase 2 can copy them into a dataset unchanged.
- `rows` are checked against `schema` and the shared value limits before anything draws. The
  default cap is 1,000 rows and 256 KiB per source (decision 1 in the [README](./README.md)).

Only a plan's primary source can be supplied. Lookups and children need relations to a registered
source, and joining an agent's rows to Acorn's records is out of scope.

### Validation and running

`describe` for a supplied source answers from its own `schema` and `fields`, so the validator and
the starter checks need no other change. Reading it returns its rows, already checked, with no
paging. It's always complete: the rows are all there is.

The runner, the stages, and the views stay as they are.

### The card

A panel over supplied rows shows a line under its title, such as "From the agent: Open-Meteo forecast
for Wellington, read 5:31 PM". The URLs are links. **Refresh** is hidden, because nothing can
refresh a snapshot. **Add to dashboard** follows decision 2 in the README until phase 2 lands. With
the default, it places the snapshot with the same line kept.

An app's `Panel` over a plan with supplied rows draws the same line under the panel.

### Teaching the agent

Add a section to `panelGuide.ts`:

- Use supplied rows when no source answers the question and the agent gathered the rows itself. Say
  where they came from in `origin`.
- Check `data_sources_list` first. A registered source beats supplied rows, because it refreshes.
- A recipe, a how-to, or a single fact isn't data. Answer it in words, or build an app card if it
  needs layout.

Add one worked example of a supplied-rows plan to the guide.

## Steps

1. Answer the two questions above.
2. Add the `supplied` kind to the protocol, with its caps and value checks, and its tests.
3. Teach `describe` and the read path to answer from the reference, with tests that every view kind
   draws over supplied rows.
4. Draw the origin line on the card and in an app's `Panel`, and hide **Refresh**.
5. Update the panel guide, and the app guide if it repeats the plan rules.
6. Document the kind in [dashboards](../../dashboards.md) and [agent-built apps](../../agent-built-apps.md).

## Acceptance

- `panel_show` with supplied rows draws a list, a table, bars, a line, and a heatmap in the
  conversation, with the origin line and working links.
- A plan whose rows break their schema, or pass the caps, fails `panel_show` with a message naming
  the row and field.
- A row holding HTML or a `javascript:` link draws as text.
- An app's `Panel` draws the same plan.
- In `pnpm dev:agent`, a real agent asked "chart my commits across every repo under `~/Source` this
  month" draws a bar panel, not text bars.
- A client from before this phase shows a plan with a supplied source as a panel it can't draw, and
  keeps it.
