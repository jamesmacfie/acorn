# Phase 1: let a plan carry its own rows

Date: October 20, 2026. Status: proposed. Needs nothing.

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
