# Dashboards programme design

Status: proposed, 2026-10-02, revised the same day after a third review. Nothing here is built. Read
[README.md](./README.md) for the workstreams and milestones, and [examples.md](./examples.md) for the
evidence. This file holds the model every workstream builds toward. Paths are hints, and each phase
file ends with its own verify-before-building list. [Dashboards](../../dashboards.md) and
[typed data sources](../../data-sources.md) own shipped behaviour until a workstream changes them.

## The problem

The shipped system is sound underneath. The Node owns every source, checks every invocation against
the workspace, project, and account, and keeps provider credentials inside the owning plugin. A query
reads one source. A published panel references up to eight queries, and the client renders the
result through one of five views. Row presses go through the host's action dispatcher.

Thirty example requests, checked by independent reviews on 2026-10-02, show where it stops. None of
the 30 works in full and six work in part. The gaps repeat across examples, which is why this
programme fixes them once rather than per panel:

1. **Panel output is narrow.** A panel that combines sources can show five shared roles (title,
   status, assignee, updated, and URL) and nothing else. Lists and objects print as JSON. Numbers
   print raw. Future dates print as "now". Fixed values can't declare a colour.
2. **The combined result can't be shaped.** Sort and filter run inside each query, and only where
   the provider supports them, so rows from two queries are stacked rather than sorted. Only the board
   groups rows, and only by a fixed-value field.
3. **There is no analysis.** Stat and chart aggregate a single measure. There are no summary tables,
   conditional counts, distinct counts, percentiles, pivots, period comparisons, or calculations over
   a summary.
4. **Combining means appending.** Nothing relates one source's records to another's, recognizes two
   records as the same item, expands a record's child list into rows, or compares rows across sources.
5. **The context is missing.** Nothing knows who "me" is in each account. GitHub needs exactly one
   repository and Linear one project. A filter can't say "older than seven days" or "due within four
   hours". Date-only values have no meaning. No source states what time range it can vouch for.
6. **Source facts are missing.** CI state, approvals, requested reviewers, Linear assignee, priority,
   due date, and dependencies, agent usage records, worktree status, local branches, and activity
   events either aren't exposed or don't exist.
7. **Navigation is fixed.** Each record carries one action that the source chose. The panel author
   can't pick a destination, add buttons, or drill into a summary.
8. **The AI author is blind.** It can't learn which account to use, never sees the panel format, has
   no identity, clock, or time zone, and can return a valid panel that quietly drops half the request.
   Publication checks that queries resolve, not that the panel answers the question.

There are also correctness bugs that make today's results untrustworthy. Workstream 1 lists them.

## What stays

These boundaries hold through every workstream:

- The Node owns provider access and credentials. A source is reached only through the data-source
  runtime, under the caller's principal, confined to one account.
- Plugins own provider facts and provider meaning. The host owns composition and every pixel. A
  plugin never draws inside a panel ([refused.md](./refused.md)).
- Composition runs over results the person is allowed to read. No plugin reads another plugin's
  database.
- Dashboard definitions and their machinery stay host-side, out of reach of plugin frames.
- A panel runs against the active Node. Panels that span several Nodes are out of scope.
- Drafts and immutable published revisions stay the authoring model, with the 750 ms autosave and
  device recovery copy the editor already uses.

## Principles

### A closed set of operations, each carrying four parts

A panel is one plan. A plan binds sources into rows, transforms them through a bounded list of
stages, and presents the result. Stages come from a closed vocabulary: filter, compute, summarize,
expand, and overlap. Rows come from a row model with declared relations and equivalences. Every
operation ships with four parts at once:

- A form in the editor.
- A plain-language description that the host writes.
- A validator that names the exact path of every problem.
- Evaluation cases for the AI author.

Stages may repeat. A panel can filter, summarize, compute a rate from the summary, filter again, and
summarize a second time. That is what "the share of total spend per service" and "tests that both
passed and failed on one commit" need, and neither is unusual. The list is bounded, linear, and
type-checked between stages. The editor shows the common shape by default, and **Add stage** offers
only what the columns at that point allow.

The system grows by adding operations that carry all four parts. It does not grow through a formula
language or SQL inside panels. That is where AI plans stop being checkable and editors become text
boxes. Workflows and datasets stay the path for expensive preparation, artifact parsing, and model
judgement, not for ordinary multi-stage analysis.

The four parts come from one capability list in `dashboards-core`, so the editor's menus, the AI
prompt, and the validator can never disagree about what is possible.

### Adapters own provider meaning, the host owns cross-source work

Whether a pull request is ready to merge, when a support ticket breaches its response policy, and how
a recurring meeting expands into occurrences are provider facts. GitHub's merge answer depends on
branch rules, the head commit, and which check conclusions count. Zendesk's deadline depends on
business hours and paused clocks. The adapter computes those and exposes the result as a typed field,
keeping "unknown" when the provider can't say.

Anything that compares or combines records from more than one source belongs to the host, because no
adapter can see across the boundary. A Google Calendar adapter can't find overlaps with Outlook
meetings. It expands recurrences and provides normalized intervals, identities, and response states.
The host recognizes duplicate invitations through declared equivalence and finds overlaps with its
interval operation. Grouping, counting, percentiles, date arithmetic, and relations are the same for
every provider, live once in `dashboards-core`, and run on the Node.

### Honest answers

A panel never presents a partial answer as a complete one.

- Every source read reports `complete`, `bounded`, or `incomplete`, and every stage after it carries
  that forward. A filter, sort, or summary over an incomplete read says so.
- Unknown, empty, and zero are three different facts. A sum over rows with unknown values is marked
  partial, not quietly undercounted.
- Amounts in different currencies never enter one total, and durations convert to one unit before
  arithmetic.
- A source-level `take` followed by a panel filter or summary changes meaning. The validator warns
  and the description says "the first 50 by updated, then filtered".
- A claim of absence, such as "no failures this week" or "no reply", needs coverage of the whole
  window. Otherwise the panel says the window isn't covered.
- History never stores a measure taken from an incomplete read.

### Columns are the panel's own vocabulary

Source field paths appear in exactly one place: the binding from a source field to a panel column.
Every later operation refers to column IDs. That removes a whole class of bug, including the shipped
one where the editor writes a panel field ID into a slot that requires a source path.

### People choose accounts

The AI may propose which sources can answer a request. It never silently decides between accounts.
When a person has exactly one usable account for a source, the plan uses it and names it in the
description, as the visual editor does today. When there are several, the person chooses, either in
**Pick data** or in answer to a clarification that lists their real accounts.

### The host describes the plan

What the person reads about a panel is generated from the plan by the host: the stage list in the
editor, the summary of an AI proposal, and the diff between versions. The description always states
what a row is and how far the panel reaches: "one row per pull request you authored, in every
repository your Work account can see". The model's own summary is shown as the model's words, beside
the host's description, never instead of it.

### Requirements are evidence, not proof

The AI's requirements list is written by the same model that wrote the plan. The host checks that
each item points at real plan parts of the right shape, which catches a whole class of mistakes. It
can't catch a requirement the model never listed, or a correctly typed column bound to the wrong
meaning. So the plan keeps the person's original request, evaluation compares plans against
requirements annotated by people, and the checklist is presented as the model's account, which the
person confirms.

## The panel plan

Version 2 of `DashboardPanelContent` is the panel plan. It lives in
`packages/protocol/src/dashboards/panels.ts` beside the version 1 schema, and the pure model,
validator, and describer live in `packages/dashboards-core/src/plan.ts` (new).

The sketch names every part, including the ones later workstreams add.

```ts
type PanelPlan = {
  version: 2
  title: string
  request?: string                   // the person's original words, kept for authoring and evaluation
  time: PlanTime                     // the panel's time zone policy and week start
  sources: PlanSource[]              // 1 to 8 query references with stable ids, labels, and roles
  relations?: PlanRelation[]         // workstream 5: lookups, children, and equivalences
  columns: PlanColumn[]              // the panel's bound output fields
  stages: PlanStage[]                // bounded, ordered, from a closed vocabulary
  sort?: PlanSort[]
  group?: PlanGroup[]                // up to two levels
  limit?: number
  view: PlanView                     // the view kind plus options that name columns
  refresh?: number                   // seconds, 30 to 86,400
  actions?: PlanActions              // workstream 4
  requirements?: PlanRequirement[]   // the authoring record; execution ignores it
}

type PlanTime = {
  zone: string                       // IANA zone; defaults to the creator's device zone
  mode: 'fixed' | 'viewer'           // 'viewer' draws in the device zone; history always uses `zone`
  weekStart: 'monday' | 'sunday' | 'saturday'
}

type PlanSource = { id: string; label: string; role: 'primary' | 'lookup' | 'children'; reference: QueryReference }

type PlanStage =
  | { op: 'filter'; where: DataPredicate }
  | { op: 'compute'; columns: PlanComputed[] }
  | { op: 'summarize'; by: PlanGroupKey[]; measures: PlanMeasure[]; pivot?: PlanPivot }
  | { op: 'expand'; column: string }
  | { op: 'overlap'; start: string; end: string; partition?: string }

type PlanColumn = {
  id: string                         // minted, unique, safe inside a JSON Pointer
  label: string
  type?: 'text' | 'number' | 'boolean' | 'datetime' | 'enum' | 'person' | 'link'
  list?: boolean                     // a list of values of this type
  unit?: string | { column: string } // a fixed unit, or a per-row unit read from another column
  precision?: 'instant' | 'day'      // datetime: 'day' is a calendar date with no time of day
  choices?: { id: string; label: string; tone?: Tone; rank?: number }[]  // enum
  unmatched?: 'catch-all' | 'hidden' // enum: where values outside the choices go
  bind: Record<string, PlanBinding>  // source id to where this column's value comes from
}

type PlanBinding =
  | { field: string; values?: Record<string, string[]> }  // a source field, plus an enum value map
  | { value: DataValue }                                  // a constant, such as a source's own name
```

### What a row is

Every plan states what one row represents, and the describer says it out loud. That decides what a
count counts.

- **Primary sources supply rows.** One primary source gives one row per record. Several primary
  sources give one row per record from each, the way panels combine queries today.
- **Lookup sources attach columns.** A lookup relation is one-to-one or many-to-one. The primary row
  keeps its identity. A primary row with no match stays by default, with the lookup's columns unknown.
  The relation can drop unmatched rows instead.
- **Children sources attach lists.** A one-to-many relation attaches the matches as a list column. An
  expand stage can turn that list into rows.
- **Equivalences merge rows.** Two primary rows from different sources that an equivalence declares
  to be the same item become one row, with per-column precedence. Only an equivalence merges rows.
  A pull request that implements an issue is related to it, not the same item.

Keys may be composite, and a key always includes the scope that makes it unique: the provider, the
account, and where it matters, the container. A GitHub pull request number is unique only within its
repository.

Row identity follows the operations. A primary row is identified by its source and record. A merged
row carries every record it came from. An expanded row is its parent plus the element's identity, or
its position where elements have none. A summary row is its group key values, and it keeps the set of
rows it stands for, which is what drill-down opens. An overlap row is the ordered pair of the rows
that overlap.

### Columns

A column has one binding per source that feeds it. A combined panel binds the same column to each
source's equivalent field, so "Priority" can read Linear's priority and a constant for GitHub. Enum
value maps live on the column: the board categories of version 1 become `choices`, and `values` maps
each source's exact value IDs onto them, as `mapping.values` does today.

`type` may be omitted only for a column bound to one source field. The run then takes the type,
unit, and choices from that field's declaration. The editor always writes explicit types, and the
version 1 upgrade omits them, which lets it run without describing any source.

Tones and ranks on choices let a source say that a failed check is bad and that "urgent" outranks
"low". Sources gain the same optional `tone` and `rank` on their declared choices, and a column
inherits them unless the author overrides them.

`list` columns hold lists of primitives or people, such as requested reviewers, labels, or blocker
identifiers. They render as chips or monograms, never as JSON.

### Units and currency

`unit` composes the existing number type rather than adding field types. An ISO 4217 code formats as
currency, `percent` as a percentage, `ms` and `s` as a duration, and `bytes` as a size. Formatting
uses `Intl.NumberFormat` in the device locale.

A per-row unit, such as an invoice's currency, binds `unit` to another column. Arithmetic and
aggregation over a column with a per-row unit are valid only when every row in the operation shares
one unit, which in practice means the panel groups or filters by the unit column first. The validator
refuses a total across currencies, and the run refuses it again if the data turns out mixed. Durations
convert to milliseconds before arithmetic. Currency conversion is out of scope.

### Time

The plan stores its time policy, because the history sampler has no device. `zone` defaults to the
creator's device zone when the panel is made. In `fixed` mode, every viewer and the sampler use
`zone`, so the screen and the stored history agree. In `viewer` mode, the screen uses the device zone
and says so, and history still uses `zone`. `weekStart` decides week buckets and "start of week".

`precision: 'day'` marks a calendar date. Date-only values travel as `YYYY-MM-DD` strings, compare
correctly as strings, and are never shifted by a time zone. Instants stay epoch milliseconds.

### Filter, sort, group, and limit

Each row is an object keyed by column ID. A filter stage is therefore an ordinary `DataPredicate`
whose item pointers are `/<columnId>`. That reuses `parseDataPredicate` and the nested all-of and
any-of groups sources already accept, so the app keeps one filter language. One rule differs from the
source boundary: an ordered comparison against an unknown value never matches, where
`compareDataValues` throws. The panel evaluator wraps it.

Sort, group, and limit present the output of the last stage. Sort is a list of `{ column, direction,
empty }`, with empty values last in both directions unless the author says otherwise, which is the
shipped shaping rule. Enum columns sort by rank, then declared order.

Group is up to two levels of `{ column, bucket, order }`. Text, enum, person, and boolean columns
group by value. Datetime columns group by `day`, `week`, or `month` under the plan's time policy, or
by relative buckets: overdue, today, the next seven days, later, and no date. Group order is declared
order, label, count, or an explicit list such as production, staging, then development. Tables and
lists draw group headers with counts. The board groups by one enum column and draws its choices as
columns.

### Views

Every view option names columns instead of source fields. The existing options keep their meaning:
`aggregate`, `field`, `shape`, `x`, `series`, `trend`, `compare`, and `good`. The editor gets controls
for all of them back, because the workflow v2 editor can only set the view kind. Once summaries exist,
stat and chart become views over a summary stage, so a chart's buckets and a summary table's buckets
are one computation.

### Requirements and the original request

`request` keeps the words the person typed when the panel was authored or last re-authored.
`requirements` records the model's account of what that request asked for and which plan parts cover
it. Execution, the history signature, and placement metadata ignore both. See
[authoring](#authoring).

### Version 1 panels

A pure upgrade in `dashboards-core` reads version 1 content as a plan. Queries become primary
sources. Each mapped role becomes a column bound per query. An unmapped single-source panel gets one
column per visible field, with its type left to the run. `groupBy` becomes a one-level group. The time
policy defaults to UTC in fixed mode, which matches how version 1 bucketed. Stored revisions are never
rewritten, so their digests keep meaning, and new saves write version 2.

The shipped persistence rule resets unversioned preferences rather than carrying compatibility code.
Published panels are a person's work, so this programme recommends the upgrade. That is an open
decision.

## When sources change

Connectors change fields, enums gain values, and feeders change their output. A published plan never
silently drops a column or reinterprets one.

- Every run validates the plan's bindings against the current description. A binding to a field that
  no longer exists, or whose type changed, makes that column unavailable for the run. The diagnostics
  name the column and the change, and the editor offers to rebind it.
- New values in a fixed-value field land in the column's `unmatched` destination, and the panel shows
  a notice listing them so the author can map them. Values the plan maps that the source no longer
  declares show a warning, as the editor does today.
- A changed source revision invalidates cached descriptions and runs.
- Dataset schemas are versioned, and a feeder whose output no longer matches fails visibly instead of
  writing rows the panels can't read. See [datasets](#datasets).

## Running a plan on the Node

Today the client and the history sampler each contain their own loop that resolves every query,
describes every source, and reads it: `PublishedDashboardPanel.tsx` and `sampler.ts`. Relations, one
evaluation instant, read budgets, and coverage all need the whole plan to run in one place.

Workstream 2 adds a `run` operation to `/v1/core/dashboards/:operation`:

- **Request.** The scope, a target that is either a published panel (with an optional pinned
  revision) or draft content, a mode (`preview` or `execution`), the device's time zone for plans in
  viewer mode, and an optional evaluation instant that defaults to the Node clock.
- **Work.** Resolve the publication, resolve each query with its context values, plan the reads, read
  each source through the data-source runtime, build the rows, then apply the stages and presentation.
- **Response.** The resolved columns, the rows, the groups, and diagnostics. The diagnostics hold
  each source's completeness, coverage, and read time, each stage's input and output row counts,
  path-addressed warnings, the evaluation instant, and the plugins and accounts the run touched.

Each row carries its provenance: every record reference it came from, including account and scope,
plus task IDs and the records' declared actions.

Preview mode reads at most 25 records per source and never writes. The editor's live preview, the AI's
sample check, and the placed panel all call this one operation. The history sampler calls the same
function in process and skips any panel whose run isn't complete.

The client caches a run by Node, scope, panel, revision, and time zone. It refreshes when the Node
announces a change to a plugin or account the run touched, when the panel's `refresh` interval
elapses, and when the window regains focus.

### Planning the reads

Refusing honestly isn't enough. Common reporting volumes need a practical route to complete answers.

- **Filter pushdown.** A filter stage that comes before any compute or summary, on a column bound to
  one source field, merges into that source's query when the source declares the operator and the
  semantics match exactly. A field that can be unknown pushes down only for `missing`, `present`, or
  equality tests, because providers treat unknown values differently in ordered comparisons.
- **Sort and limit pushdown.** A final sort and limit become a source `take` only when no stage after
  the read changes which rows survive or their order.
- **Projection.** Sources may accept a list of the fields a plan reads, and send less. The host still
  projects, so a source that ignores the list stays correct.
- **Shared reads.** Identical authorized reads, with the same principal, source, scope, account,
  resolved query digest, and evaluation window, share one in-flight read and its result for a short
  interval. A Home tab with six panels over the same query reads once.
- **Provider scheduling.** Source reads go through per-provider and per-account concurrency limits,
  as resource reads already do through `ProviderRequestScheduler`. Rate-limit answers back off and
  surface as a named diagnostic.
- **Aggregation at the data.** A summary over a dataset runs as a query in the Node's database, so
  200,000 stored CI runs aggregate without moving every row. Sources may later declare aggregate
  support of their own, for providers whose APIs answer counts directly.
- **Budgets.** Per-source budgets stay as they are: 5,000 records, 16 MiB, and 60 seconds. A run adds
  total records, total time, output bytes, intermediate rows per stage, and output caps for relations,
  expansion, and overlap. Hitting any budget fails visibly with the budget's name.

## Identity, scope, and time

Workstream 3 makes these contracts. They are part of the data-source format, so workflows gain them
too.

### Who "me" is

A source may declare an `identity` operation. Given an account, it returns that account's user:
`{ id, login, name, email, teamIds, teams }`, with every member optional. The host calls it once per
account, caches the answer, and clears it when the account changes. Identity answers never reach a
plugin frame.

A field may declare `viewerMatch`, a pointer into the identity answer. GitHub's `/author` declares
`/login`, and a Linear assignee field declares `/id`. The editor then offers **You** as a value, and
the binding is `{ from: 'context', name: 'viewer', pointer: '/login' }`. The host turns it into a
literal before the provider sees the query, which keeps the existing rule that operands at the
provider boundary are literals.

Some relationships only the provider can compute. "Review requested from me, directly or through a
team" is one GitHub search qualifier and a long chain of joins anywhere else. Sources expose these as
ordinary fields scoped to the account's user, such as `/viewer/reviewRequested`, with declared
operators.

### Reach

A scope parameter may be a list with dynamic choices, and the editor offers a multi-select. The source
reads the list itself: GitHub search accepts several `repo:` qualifiers in one call, and Linear filters
`project.id` with `in`. Where a provider can search more widely, the parameter becomes optional. The
host never runs one query per repository.

That gives every list scope three possible reaches, and they mean different things:

- **Everything the account can see.** The parameter is absent. "My pull requests across my
  repositories" is this reach, with author bound to **You**.
- **The workspace's links.** The context value `workspaceLinks` resolves to the external IDs linked
  to the panel's workspace, and project when it has one, for the query's account. It reads
  `workspace_external_projects`, and for GitHub, the repository on each project. A panel on this reach
  follows the workspace as projects are added.
- **An explicit list.** The person picked the repositories or projects.

The describer always states the reach. When a request could mean more than one, authoring asks.

### Time

Context values give relative and calendar instants under the plan's time policy:

- `{ from: 'context', name: 'now', offset: '-P7D' }` is seven days before the evaluation instant.
- `{ from: 'context', name: 'calendar', boundary: 'startOfWeek', offset: '-P1W' }` is the start of
  last week, using the plan's zone and week start.

Both resolve once per run, at one instant, through the same code path as query time windows in
`packages/protocol/src/data/queries/dataQueryTime.ts`. Compared against a date-only field, a context
instant becomes the local calendar date in the plan's zone.

### Coverage and freshness

A source description may declare coverage: `snapshot` for current state only, or `events` with a
retention period, the earliest time it holds, and whether it is complete inside that range. A read may
report the range it actually covered. Mirrored sources report when they last observed the provider.

The run uses coverage in three places. It labels any part of a window that falls outside coverage. It
marks a summary over an uncovered window as partial. And it refuses to present an absence as a fact
when coverage can't support it.

## Composition and analysis

Workstream 5 adds relations and the remaining stages.

| Operation | What it does |
| --- | --- |
| Relation | Attaches lookup columns, attaches child lists, or merges equivalent rows, as described in [what a row is](#what-a-row-is). |
| Filter | Keeps rows that match. |
| Compute | Adds columns from a closed set of expressions. |
| Summarize | Groups rows and computes measures, optionally spread across an enum's choices. |
| Expand | Turns one list column into one row per element. |
| Overlap | Pairs rows whose time intervals intersect. |

A plan holds at most eight stages, of which at most three summarize and at most one overlaps. Stages
form one linear list. There is no branching and no merging of two pipelines, because relations already
cover combining sources and a branch is where plans stop being describable.

**Compute** offers column references, literals, and context values. It combines them with the four
arithmetic operations, the difference between two instants in a unit, coalesce, a choice from an enum
or boolean to a value, and the smaller or larger of two values. A compute after a summary works on
measures, which is how "completed points divided by total points" works. Division by zero gives
unknown. There are no user functions and no string parsing.

**Summarize** groups by up to three columns, with datetime buckets of day, week, or month, and computes
named measures: count, count where, sum, average, minimum, maximum, median, percentile, distinct count,
distinct list, earliest, and latest. Each measure can carry its own filter, which is how overlapping
counts work. A numeric measure can also be expressed as a share of its total across all groups. A
time-bucketed summary can add the change from the previous bucket. A pivot spreads one measure across
an enum column's declared choices, which bounds the number of columns.

**Relations** are declared, never guessed. A source may declare them in its description, from one of
its fields to another source's field, with a kind, a label, and a cardinality. A plan may declare one
between two sources, stating the cardinality itself. Kinds describe the link, such as implements,
blocks, or belongs to. One kind, equivalence, means the two records are the same item, and only it can
merge rows. Every run checks cardinality. If a relation declared many-to-one finds several matches, it
fails with a warning naming the relation and the key, and never multiplies rows.

**Overlap** takes a start and an end column and an optional partition column, such as the person or
the room, and returns one row per pair of rows whose intervals intersect within a partition, with both
sides' columns and the overlap duration. It is bounded by input size and by output pairs. It serves
calendar conflicts, bookings, maintenance windows, reservations, and scheduled work.

Flaky tests show repeated stages at work. Starting from one record per test run:

1. Summarize by test and commit: runs, passes, and failures.
2. Compute `flaky` as "passes above zero and failures above zero".
3. Summarize by test: total runs, total failures, and the count of commits where `flaky` is true.
4. Compute the failure rate as total failures divided by total runs.
5. Filter to tests where the flaky commit count is above zero.

Producing the test-run records is the dataset's job. Analysing them is the panel's.

## Navigation and row actions

Workstream 4 makes row behaviour the author's choice, through seams that already exist.

The content-link registry in `packages/client-core/src/host/registries/panes/contentLinks.ts` already
turns a recognized URL into an in-app target with up to three destinations: a full page, a side
panel, or a task pane, falling back to the browser. Workstream 4 extends it rather than building a
second one.

- **Basic presses first.** The author picks what a row press opens, the record's own item, its task,
  or a link column, and in which presentation. That arrives with the first milestone.
- **References.** Every run row carries its record references, task IDs, and link columns, with the
  full record reference including account and scope.
- **Named actions.** A record may offer several labelled actions with risk tiers, such as **Re-run
  job** or **Approve**, beside its default action. `navigate` and `createTask` become allowed record
  verbs.
- **Actions run on the Node.** The client sends an action ID and the full record reference. The Node
  asks the source for the record's current actions, checks the account and the action's eligibility
  again, and dispatches. The client never posts a plugin route copied from a row that may be stale.
  Risky actions confirm before dispatch. Cancelling before dispatch sends nothing, and once dispatched
  the outcome is reported, carrying an idempotency key per press.
- **Targets.** A plugin declares the kinds of item it can open and the presentations each supports. A
  target can be named by kind and item ID, without a URL, so agent sessions, workflow runs, and local
  branches become reachable.
- **Panel actions.** The plan stores what a row press does and up to three trailing buttons.
  **Start a task from this row** is always available.
- **Drill-down.** Pressing a summary row or a measure cell opens the rows it stands for in a side
  panel. The host builds the drill-down plan from the stages before that summary, adds filters for the
  group's key values and for the measure's own filter, and keeps the original evaluation instant and
  context values. Pressing "failing CI: 7" opens exactly those seven pull requests.
- **Keyboard and terminal.** Buttons are also a row menu, reachable from the keyboard, and the
  terminal client draws the same menu.

## Datasets

Workstream 6 adds datasets. A dataset is a Node table with a declared schema and declared coverage,
served to panels as a source. Each dataset has one storage mode, chosen when it is created, because
the modes answer different questions:

| Mode | Answers | Behaviour |
| --- | --- | --- |
| Current mirror | What is true now. | Upserts by record identity. After a complete capture, records the source no longer returns are marked removed, with the time. |
| Event archive | What happened: runs, deployments, messages, usage. | Keeps every event by its stable identity and event time. Accepts late arrivals and records when each arrived. |
| Snapshot history | How values changed. | Keeps one observation per record per capture, keyed by record and observation time. |

Coverage has two kinds, and datasets track both. Capture coverage records when captures ran and
whether they succeeded. Event coverage records the windows in which the dataset can vouch that it holds
every event, which successful captures alone don't prove. Event archives declare a backfill boundary,
use the source's incremental continuation where it declares one, and mark gaps explicitly.

Three feeders fill a dataset: a schedule that captures a source query, a workflow step, and an agent
tool that writes rows with evidence and a correction field. A summary over a dataset runs as a query
in the Node's database. Dataset schemas are versioned, and a feeder whose output no longer matches the
schema fails visibly.

The hourly measure history behind stat trends is the one-number case of snapshot history. Workstream 6
decides whether to fold the existing table in. Datasets hold provider data at rest, so they are scoped
to a workspace, capped, retained for a declared period, and deleted with the workspace.

## The editor

Workstream 2 rebuilds the editor around the plan. It has two entrances, and both produce the same
editable plan.

**Pick data** starts from the source. One picker lists each source paired with each account, plus
saved queries, such as "Linear issues · Acme" and "Linear issues · Personal". Account names come from
the connection's name in Settings. If the source can't run without a scope, the same step asks for it.
The source's starter plans are then offered as cards beside the AI box.

**Describe it** starts from the request: "Show my overdue work across our trackers." The AI lists the
sources and accounts the person can use, explains which could answer the request, asks only where an
account or a reach is genuinely ambiguous, and proposes a plan. The person sees the proposed sources
and accounts before anything is read beyond metadata.

After either entrance:

1. **Stages.** The plan shows as a short list in the host's words: "Pull requests you authored, in
   every repository your Work account can see", "Columns: title, repository, CI, approval, updated",
   "Sorted by updated, newest first", "Grouped by repository". Each opens into its form. **Add stage**
   offers only operations the columns at that point allow, and says why an unavailable one is
   unavailable.
2. **Preview.** The real panel, drawn by the same view components, from a preview run. Each stage
   shows its row count, and warnings sit beside the stage that caused them.
3. **Place.** The destination tab, defaulting to the tab the person started from.

There is one AI conversation per panel. The per-query AI box inside the shared source editor is hidden
in the dashboard editor and stays in workflow step editing.

## Authoring

### What the model receives

Each turn sends a bounded, structured context, not prose:

- The person's original request and the conversation so far.
- The chosen sources and accounts, each account's identity answer, and each source's description.
  On the request-first path, the list of sources and the person's accounts instead.
- The relations, starter plans, and navigation targets declared for those sources.
- The evaluation instant, the plan's time policy, and the workspace's projects with their linked
  repositories and external projects.
- The plan so far, including its requirements list.
- The capability list: operations, their schemas, one worked example each, view requirements, and
  measure and bucket names.

The system prompt is generated from the capability list in `dashboards-core`. A test parses every
worked example against the plan schema, so the prompt can't drift from the format.

### What the model returns

A reply is one of four things:

- **A proposal**, with the candidate plan and the requirements list.
- **A clarification**, with real choices. For an ambiguous account, the choices are the person's
  accounts. For an ambiguous reach, the choices are the reaches the source supports.
- **Unavailable**, when no source or capability can answer the request, with the reason.
- **Metadata**, a request for one allowlisted read, as today.

The requirements list names each requirement the model found in the request and marks it covered,
partial, needs a choice, or unavailable, with a reason for the last three. A covered or partial
requirement points at the plan parts that cover it, such as `/columns/ci` or `/stages/2`. The host
checks that every pointer resolves and that the part has the claimed shape. A requirement covered in
the previous plan can't disappear from the next one unless the person's instruction removes it.

Because the list is the model's own account, two more checks sit beside it. An independent pass asks a
model, without the plan, to list the requirements in the request, and any it finds that the authored
list doesn't match are shown as "not addressed". Whether that pass runs by default depends on what it
catches in evaluation. And the person sees the checklist as something to confirm, next to the host's
description of the plan.

### Evaluation

The evaluation suite measures plans against requirements and expected results that people annotated,
never against the model's own list. It starts from the 30 examples in [examples.md](./examples.md),
plus variants: different wording, two accounts for one provider, an ambiguous reach, a missing source,
and a request no source can answer. Each case states the expected sources and reach, the required
columns, filters, sorts, and stages, and the expected rows over fixture data. The suite runs against
fixture sources and fake accounts, including the fake GitHub server the GitHub plugin's tests already
use. A case fails when a required part is missing, an account is guessed, or a partial result has no
partial or unavailable requirement. It runs on demand against real models, and its results are
recorded per model.

## Acceptance

Passing the known examples shows that capabilities work. It doesn't define the product. Each milestone
is also accepted against requests it has never seen, collected from people who use dashboards, and
judged on:

- Whether the output answers the request, checked by a person against the source system.
- Whether refining the panel by editing or by asking again works without starting over.
- How much effort creation takes, in steps and time.
- How long a refresh takes on real accounts.
- Whether failures and partial answers are understandable without reading code.

Unseen requests that fail become new evaluation cases and, where a capability is missing, roadmap
items.

## What a good source provides

New integrations follow this checklist. Most items are optional, and each one unlocks a family of
panels rather than one:

- A structural schema whose fixed-value fields declare their choices, tones, and ranks.
- Declared query operators and sort support on the fields people filter and sort by.
- Provider-computed fields for provider meaning, such as merge readiness or a response deadline,
  with "unknown" kept as a value.
- Normalized facts the host can compare across sources, such as intervals with start, end, and time
  zone.
- An `identity` operation, and `viewerMatch` on person fields.
- List scope parameters, optional scopes where the provider can search widely, and keys that include
  their scope.
- Projection support, and incremental continuation for event sources.
- Coverage and observation time.
- Declared relations, including equivalences to other systems' records.
- Starter plans.
- Navigation targets, and named record actions with risk tiers.

## The terminal client

The terminal client draws no dashboards. A `pane.aside` placement prints one muted line, and
`apps/tui/src/plugins/ExtendedPane.tsx` points here for the design.

The programme keeps panels host-neutral. The run returns rows, columns, groups, and diagnostics, and
stage descriptions are text, so a terminal panel is a table with group headers and a keyboard row menu.
That becomes possible after the first milestone and should follow the row menu, so actions reach both
hosts in the same form. Charts, the drag grid, and the sparkline stay desktop-only, and the terminal
shows their summary rows instead.

## Open decisions

Each phase file repeats the decisions that block it. Collected here:

1. Upgrade version 1 panels or reset them. This programme recommends the upgrade.
2. Whether `request` and `requirements` belong on published revisions or on drafts only.
3. Whether identity belongs to the source or the connection provider.
4. Run budget values: total records, output bytes, intermediate rows, and relation, expansion, and
   overlap caps.
5. The shared-read interval, and whether shared reads cross panels in different workspaces.
6. Where agent pricing lives once usage records become a source, given that the `agent-cost` plugin is
   client-only.
7. Whether the independent requirements pass runs by default.
8. Whether saved SQL queries become a source early or wait for demand.
9. Dataset retention defaults, and whether measure history folds into datasets.
10. Whether write-back ships as drag, as named actions, or both.
