# Panels over data an agent found

Date: October 20, 2026. Status: proposed. Implementation not started.

This programme lets an agent draw a panel over rows it gathered itself, such as the weather this
week, commit counts across every repository on disk, or a table it read from a web page. It then
gives the person a way to keep such a panel up to date, and adds one live source for a question
agents get often: what's in the code.

## The problem

A panel plan must name a data source, and only Acorn's own code or a plugin can register one. So an
agent that answers "graph my commits across `~/Source` this month" runs `git log` itself, counts the
results, and draws bars out of text characters. It has the rows, and nowhere to put them.

The drawing side doesn't care where rows come from. Every view, from a list to a heatmap, draws
records with known fields. Only the plan format insists on a registered source.

## What the person gets

When every phase ships:

- An agent answers "show me the forecast for this week" or "chart my commits across every repo on
  disk" with a real panel in the conversation: a table, bars, a line, or a heatmap. The card says
  where the rows came from and when the agent read them.
- **Add to dashboard** on such a panel offers to keep it up to date. The person approves a dataset,
  and from then on an agent or a schedule writes fresh rows into it.
- "Count the TODOs in each folder" draws from a live code search source that refreshes on its own.
- An agent asked for a recipe answers in words, or builds an app card, instead of forcing a table.

## Starting point

Checked against `07e820036`:

- A plan's sources each carry a `reference`, defined by `queryReferenceSchema` in
  `packages/protocol/src/data/queries/dataQueries.ts`. Its two kinds, `inline` and `saved`, both
  name a registered source. `panelPlanSchema` is in `packages/protocol/src/dashboards/panels.ts`.
- `panel_show` stores nothing. The plan lives in the tool call, and the transcript's card runs it
  under the person's device (`packages/node-core/src/server/agentTools/panelShow.ts`). `planProblems`
  validates a draft by describing its sources.
- Datasets already store rows that aren't from a live source. `datasetCreateSchema` in
  `packages/protocol/src/data/datasets.ts` takes a JSON `schema`, a `fields` list, identity fields,
  a mode, and a feeder of `capture`, `workflow`, or `agent`. Only the person's device can create a
  dataset (`packages/node-core/src/server/routes/datasets.ts`). `dataset_write` adds agent rows, each
  with evidence and a reason, and a person's corrections survive later writes.
- An app draws charts only through `Panel(plan, inputs)`, so it has the same limit. An app program
  can hold literal values and can't reach the network ([agent-built apps](../../agent-built-apps.md)).
- The editor plugin searches files with ripgrep (`plugins/editor/src/server/search.ts`). The http
  plugin is a request pane with no data source.

## The phases

| Phase | What changes |
| --- | --- |
| [1](./01-supplied-rows.md) | A plan source can carry its own rows. `panel_show` and app `Panel`s draw them, with where they came from on the card. The panel guide learns when to use them, and when an answer isn't data at all. |
| [2](./02-keep-it-updated.md) | **Add to dashboard** on a panel over supplied rows offers to make it a dataset the agent keeps up to date, by hand or on a schedule. |
| [3](./03-code-search-source.md) | A live **Code matches** source over the editor's ripgrep, with the pattern as a setting. |

Phase 2 needs phase 1. Phase 3 needs neither, and can run in parallel with either.

## What holds across every phase

- **Where the data came from is always visible.** A row the agent supplied isn't a fact the way a
  row from Acorn's records is. Every panel over supplied rows names its origin and the time the
  agent read it, and never looks like live data.
- **Supplied rows are text and numbers.** They pass the same value checks as any source's records.
  Links are `https` only, through the shared sanitizer. No HTML and no images.
- **One way to stay current.** Only a dataset or a live source refreshes. A snapshot never does, and
  no phase adds a way for a panel to call the agent when it's opened.
- **The views don't change.** No phase adds a view, a chart component, or a special case in the
  runner for supplied rows past reading them.
- **Promotion is a copy, not a translation.** Supplied rows declare their fields with the same
  `schema` and `fields` shapes a dataset takes, so phase 2 copies them across.

## Decisions for the owner

Each phase names the default it assumes:

1. **Caps on supplied rows.** The default is 1,000 rows and 256 KiB of rows per source, the same
   byte cap app state has. The rows live in the transcript, so they count toward its size.
2. **A snapshot on a dashboard.** The default lets **Add to dashboard** place a snapshot as it is,
   labelled with its date, beside the option to keep it updated. The alternative is to refuse a
   snapshot on a dashboard and only offer the dataset.
3. **Who refreshes a kept panel.** The default is an agent, on request or from a schedule that runs
   a workflow step. No refresh happens without one of the two.
4. **Code search reach.** The default searches the project folders of the query's workspace, never
   arbitrary paths, and honours `.gitignore`.

## Later

- **JSON over HTTP.** A source in the http plugin that reads a URL the person approved, with a
  mapping from the JSON to fields. It's the general answer for public APIs such as weather. It needs
  network access from the Node, a list of allowed hosts the person approves, protection against
  requests to private addresses, and its own trust wording. Build it when a kept panel needs data an
  agent can't fetch on a schedule.
- **Supplied rows in the terminal client.** The terminal draws a panel as one line, as it does for
  every panel.
- **Other parameterized sources over things Acorn already does**, such as a source over a task
  script's JSON output. Each needs its own look at what it can run and reach.

## Why

Letting a plan carry rows is the smallest change with the widest reach. Every question whose answer
an agent can gather becomes a panel, and every existing view applies.

A dataset is the right home for data that should stay current. It already has evidence, corrections,
coverage, retention, and an approval step, so keeping a panel up to date adds no new storage.

A live source is still better wherever Acorn can read the data itself, because it never goes stale
and costs no tokens. Code search is the clearest case, because the editor already runs ripgrep.
