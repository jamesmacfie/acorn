# Phase 3: serve the facts as data sources

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
