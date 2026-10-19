# Phase 3: serve the facts as data sources

## Completion note

Built on October 20, 2026, on branch `phase-3-agent-sources`.

What landed:

- `sourceQuery.ts` in `plugins/agents/src/server/data`. `scopeTasks` turns a workspace or project
  into task IDs through `projects.byWorkspace` or `projects.byId` and `tasks.inProject`.
  `sqlFilters` returns the time comparisons and the `eq` comparisons SQL can answer, apart, so a
  source can put an aggregate time field in `having`. `withinBudget` and `sourcePage` handle the
  newest-first read, the budget report, sorting, and paging. `sourceHandler` holds the principal
  check, `describe`, and the response envelope. All three handlers use it.
- `agentUsageCost` in `shared/pricing.ts` is the pricing rule. `usageRecords` calls it, and its
  tests pass unchanged.
- `usage-records` reads newest first within the window. Its records, starter, and revision are
  unchanged.
- **Agent turns** (`turns`) and **Agent session totals** (`session-totals`), with descriptions and
  starters in `shared/turnSource.ts` and `shared/sessionTotalsSource.ts`, handlers in
  `server/data`, and registrations in `shared/sourceRegistrations.ts`, which replaces
  `usageRegistration.ts`. `sourceShape` builds a description's schema and fields from one list.
- Tests: `sourceQuery.test.ts`, `agentSources.test.ts` (6,000 usage events, workspace and project
  scope, pricing, options, archived sessions, removed history), and `sourceStarters.test.ts`, which
  validates every starter of the three sources and replaces `usageSource.test.ts`.
- The plugin route golden in `apps/node/test/integration/pluginSystem/pluginDisable.snapshot.json`
  lists the two new routes.
- Docs: [turn facts](../../managed-agents/turn-facts.md#data-sources), [managed
  agents](../../managed-agents.md#usage-records), [data sources](../../data-sources.md), and the site's
  data sources page.

Decisions and deviations:

- SQL only narrows. Every handler runs the whole query in memory over what it read, so a pushed
  comparison can't disagree with the in-memory one.
- `usage-records` pushes only the window and the fields a whole session shares: `sessionId`, `taskId`,
  and `provider`. `model` and `turnId` change within a session, and a delta needs the session's
  earlier reports, so those stay in memory. For the same reason, the handler also reads each session's
  usage events before the first one it kept, and computes deltas over both. Without that read, a
  Codex session that started last month would count its whole running total in this month's first
  record. A test checks the windowed records equal an unbounded read's.
- A record's order with no sort is the newest-first read order. `usage-records` used to break ties
  by record ID.
- A covered range is returned only when the budget cut the read. A complete read covers the whole
  window, and an earlier start would raise a coverage warning on every windowed panel.
- Coverage for both new sources is complete when `turnFactsPending` finds no finished turn waiting for
  its facts. It shares its rule with the backfill.
- A turn whose facts hold no tokens isn't estimated. The facts store 0 for unreported tokens, so
  without this a Claude Code turn with no reported cost would show an estimate of 0 USD.
- `provider` and `model` on **Agent turns** have dynamic choices and an `options` operation listing
  the values in the rows. Harnesses can come from plugins, so a static list would go stale.
- **Agent session totals** sums `filesRewritten` and keeps the per-turn maximum as `maxFilesRewritten`,
  because the plan asks for both under one name. `repeatedCalls` there is the per-turn maximum, as
  the plan lists it with the maximums. Its `costUsd` sums the turns with a known cost, and is null
  when none has one.
- Session totals read change requests once per task on the page, after paging. Turn titles and
  project names come from the scope's tasks, or for a whole-Node read, from the projects the rows
  name.
- Both new sources' records carry the `agents.session` target and open the Agent pane, as the
  sessions source does.

Acceptance, measured on October 20, 2026, on an Apple M2 Pro:

- On a clone of phase 2's copy of the owner's 3.4 GB `agents.sqlite`, "Spend by day, last 30 days"
  read 3,294 turns over 33 pages and came back complete, with coverage complete. The read and the
  plan's stages took 0.71 s, warm, the median of four runs. The run used the real handler and the
  real plan stages from a scratch test, with the window pushed as the Node's `plannedQuery` pushes
  it. It had no core database, so task titles and project names were null. Recorded in turn facts.
- On the same copy, `usage-records` answered this month's window in 0.36 s. It reports `incomplete`,
  because the copy holds 192,108 usage events and the newest 5,000 span about 11 hours.
- `agentSources.test.ts` shows two projects in one workspace, the second workspace with only its own,
  a session in an archived task, and a session whose history was removed.
- Every starter validates against its description in `sourceStarters.test.ts`. In `pnpm dev:agent`,
  **Add panel** listed both sources and offered every starter. Each of the five published to Home
  from the launcher with no edits, and the studio reported no problems for any of them.
- The Node service's boot graph is 1,902,556 bytes, under its 1,903,000-byte ceiling.

For later phases:

- Phase 4 adds the heatmap and stacked starters to `turnSourceDescription.starterPlans`. Stacking by
  model needs a plan column with declared choices, because `model` has dynamic ones.
- Phase 8 can bind `agents:turns` and `agents:session-totals` in its region and derived sources.
  The worst-run fields hold the turn's `ordinal` and the run's first `seq`, which phase 7's links need.
- The sessions source still reads unarchived sessions and filters in memory. It's outside this phase.
- The plugin SDK's field lists (`packages/plugin-sdk/src/testing/sourceFields.json`) don't include the
  new sources. Adding them changes what `create-acorn-plugin` offers, and its test pins scaffolded
  plugins to the SDK release that has the lists, so it needs an SDK release. Phase 8 needs them if
  its derived sources' tests build fixtures for `agents:turns` or `agents:session-totals`. Add both
  to `fieldLists()` in `tools/arch/sourceFields.test.ts` and to `KNOWN_SOURCES` in
  `packages/create-acorn-plugin/index.mjs`, and bump the SDK version.

Date: October 19, 2026. Status: proposed. Needs [phase 2](./02-turn-facts.md).

## Goal

The agents plugin serves two data sources over the facts table: **Agent turns**, one row per finished
turn, and **Agent session totals**, one row per session. Both answer a year's window on a large
history without hitting the 5,000-record budget. `usage-records` gets the same time-window fix. Each
source ships starter panels, so a workspace has useful charts before any plugin is installed.

## Starting point

- `usageSourceHandler.ts` in `plugins/agents/src/server/data` selects usage events oldest first with
  `LIMIT 5001`, then applies the query's predicates in memory. On a history over 5,000 usage events, a
  panel for this month reads the oldest 5,000, keeps none, and reports `incomplete` with
  `host-budget`.
- `sessionSourceHandler.ts` in the same folder reads unarchived sessions only, and filters and sorts
  in memory.
- Both scope by workspace with `core.tasks.idsForWorkspace`. The usage source also narrows by project
  through one `tasks.load` per task.
- `core.tasks.inProject` returns each task's id, title, and status, and `core.tasks.changeRequests`
  returns a task's change requests with the session that attached each one
  (`packages/plugin-types/src/contracts/coreTasks.ts`).
- A source description can carry up to 10 starter plans, each validated against the description by a
  test ([data sources](../../data-sources.md)).

## The design

### Push the window into SQL

`sourceQuery.ts` in `plugins/agents/src/server/data` turns the parts of a query that SQL can answer
into a `where` clause:

- Comparisons on the source's time field, such as `completedAt` or `at`, with `gt`, `gte`, `lt`, and
  `lte`.
- `eq` on `taskId`, `sessionId`, `projectId`, `provider`, and `model`.
- The scope's workspace and project, as a task id list. A scope with neither reads the whole Node, as
  `usage-records` does. Only device and service principals can call these sources, so a whole-Node
  read is the person's own view of their own Node.

Everything else still runs in memory after the read, as it does today. The read orders newest first,
so a budget cut drops the oldest rows, and the source reports `incomplete` with `host-budget` only when
rows past the window's start remain. All three handlers use this one helper, so each source's
handler holds only its columns and its row shape.

### Agent turns

Source id `turns`, labelled **Agent turns**, one record per facts row. Its fields are the facts columns
from [phase 2](./02-turn-facts.md#the-table) in camel case, plus:

- `costUsd` and `costSource`, priced at read time with the same rule and preferences
  `usage-records` uses. Move that rule from `usageRecords.ts` into `shared/pricing.ts` beside
  `agentModelPrice`, so both sources call one function.
- `contextPeak`, `peakContextUsed / contextSize` as a percentage, or null.
- `taskTitle` and `projectName`, read once per query for the task and project ids in the page.

`source`, `status`, `provider`, and `model` are choice fields, so a board or a bar can group by them.
`completedAt` is the time field and carries the `updated` role. Coverage is `events`, retained until
the task is deleted, and complete once the backfill has finished.

### Agent session totals

Source id `session-totals`, labelled **Agent session totals**. One `GROUP BY session_id` over the facts
rows in scope makes one record per session. Sessions with no finished turn are left out. Each record
holds:

- The sums of time, waiting, calls, failures, changed files, rewrites, subagents, tokens, and cost.
- The maximums of `longestFailureRun`, `repeatedCalls`, `filesRewritten`, and `contextPeak`, so a
  consumer can tell "one bad turn" from "a long session".
- Where the worst runs happened: `longestFailureRunTurn` and `longestFailureRunSeq` from the turn
  holding the longest failure run, and `repeatedCallsTurn` and `repeatedCallsSeq` from the turn holding
  the most repeats. A consumer can say "in turn 12" and link to the call with
  [phase 7](./07-message-links.md).
- `turns`, `failedTurns` (status `failed` or `interrupted`), `firstStartedAt`, and `lastCompletedAt`.
- The session's `title`, `provider`, `kind`, and `archived` mark, from its row. Archived sessions are
  included, because this source is about history. A session whose history the retention pass removed
  still has its facts and its row, and appears.
- `taskId`, `taskTitle`, `taskStatus` (`active`, `archived`, or `cancelled`), `projectId`, and
  `projectName`, from `tasks.inProject` once per project in scope.
- `changeRequests`, the number of change requests this session attached, from `tasks.changeRequests`
  once per task in the page.

`lastCompletedAt` is the time field, so "sessions this week" is a window on it.

### Fix usage-records

`usage-records` adopts `sourceQuery.ts`. Its time field is `at`, and its rows stay one per usage event.
Its records, starter plan, and revision don't change. Only which rows a budget cut keeps changes.

### Starter plans

Each source ships starters, validated against its description by a test, as the usage starters are:

| Source | Starter | View |
| --- | --- | --- |
| Agent turns | Spend by day, last 30 days | Line over `completedAt` by day, sum of `costUsd` |
| Agent turns | Spend this month by project | Bar by `projectName`, sum of `costUsd` |
| Agent turns | Time agents waited on you, last 30 days | Line by day, sum of `approvalWaitMs` |
| Agent turns | Failed turns this week | List of turns with status `failed` or `interrupted`, newest first |
| Agent session totals | Most expensive sessions this month | Table sorted by `costUsd` |

[Phase 4](./04-heatmaps-and-stacked-bars.md) adds the heatmap and stacked starters once those views
exist.

## Steps

1. Write `sourceQuery.ts` and its tests: the SQL it emits for each operator, the in-memory remainder,
   newest-first order, and the budget report.
2. Move the pricing rule into `shared/pricing.ts` and point `usage-records` at it. Its tests
   must pass unchanged.
3. Move `usage-records` onto `sourceQuery.ts`. Add a test with 6,000 usage events where this month's
   panel returns this month's rows complete.
4. Add **Agent turns** and **Agent session totals**, with descriptions, starters, and tests for
   workspace scope, project scope, archived sessions, and removed history.
5. Document both sources in [data sources](../../data-sources.md) and in the managed agents page from
   phase 2.

## Acceptance

- On a copy of a large `agents.sqlite`, "Spend by day, last 30 days" returns complete. Record its run
  time and the date in the managed agents page.
- A workspace with two projects shows both in "Spend this month by project", and a second workspace
  shows only its own.
- A session in an archived task appears in **Agent session totals**, and so does one whose history was
  removed.
- Every starter publishes from the panel launcher without edits.
