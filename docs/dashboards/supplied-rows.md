# Supplied rows

A plan's source can hold rows an agent gathered itself, in place of a registered source. Examples are
a forecast the agent read from a web page, or commit counts from `git log` across every repository on
disk. This page covers the reference, how the Node checks and runs it, and how its panel says where
the rows came from. For the plan format itself, see [dashboards](../dashboards.md#published-panels).

## The reference

The reference is `{ kind: 'supplied', origin, schema, fields, rows }`, defined beside `panelPlanSchema`
in `packages/protocol/src/dashboards/panels.ts`. It has these parts:

- `origin` is one line saying where the rows came from, the `https` pages they were read from, and
  `readAt`, when the agent read them.
- `schema` and `fields` take the shapes a dataset takes: an object schema for one row, and the field
  list. Every field must be in the schema.
- `rows` must each fit the schema and pass the same value checks as any source's records. A source
  holds at most 1,000 rows and 256 KiB of them (`SUPPLIED_ROW_LIMITS`). A row that doesn't fit fails
  the plan with a path to the row and field, such as `/sources/0/reference/rows/3/high`.

Only a plan takes this kind. Saved queries, workflow steps, and the plugin API's `queries.resolve`
keep `queryReferenceSchema`, which has no rows.

A supplied source must be the plan's only source, with the primary role, so an agent's rows never
join Acorn's records. `validatePanelPlan` refuses anything else.

## Running

The runner describes a supplied source from its own schema and fields, and reads its rows, complete
and with no paging (`suppliedPlanSource` and `suppliedRead` in `packages/dashboards-core`). Its
records name the source `core:supplied`, which no plugin registers. `panel_show` and publication run
the same description, so the validator needs no other change.

The stages and views don't know where rows came from, so every view draws supplied rows. A value is
only ever text. A link cell is a link only when it's `https`, the check every source's links pass.

## The panel

A panel over supplied rows says where they came from under its title, such as "From the agent:
Open-Meteo forecast for Wellington, read Oct 20, 2026, 5:31 PM", with each URL as a link
(`SuppliedOrigin` in `packages/client-core/src/features/dashboards/`). It has no **Refresh**,
because nothing can refresh a snapshot. That holds in a conversation card, in an app's `Panel`, and
on a dashboard.

**Add to dashboard** places the snapshot as it is, keeping the line. The studio shows the line in
place of the source picker, so a person can still change the columns, stages, and view.

A client from before supplied rows can't parse such a plan, so its card says the plan didn't pass its
checks and shows the call. The transcript keeps the call either way.

## Teaching the agent

The `suppliedRows` section of `panel_guide` tells a chat agent to check `data_sources_list` first,
because a registered source refreshes and supplied rows never do. It says to supply rows only when no
source answers and the agent gathered them itself, and to answer a recipe, a how-to, or a single fact
in words or with an app. It ends with a worked plan that charts commits by repository. The panel
studio's AI doesn't get this section, because it can't gather rows.
