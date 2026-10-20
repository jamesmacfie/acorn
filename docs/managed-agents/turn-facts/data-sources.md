# Agents data sources

The agents plugin serves its turn facts, tool call rows, and requests as data sources that dashboards
and workflows read. This page covers each source's records and starters, how a read is scoped and cut,
and why tool calls have rows of their own. The rows themselves are in [turn facts](../turn-facts.md).

## The sources

Three sources serve the facts, and a fourth reads the session's requests. Each ships starter panels.

**Agent turns** (`turns`) has one record per row, with the columns in camel case and without
`version`. Each record adds four things:

- `costUsd` and `costSource`, priced when the source is read by `agentUsageCost` in
  `plugins/agents/src/shared/pricing.ts`, the rule `usage-records` uses. A turn with no tokens isn't
  estimated, so a Claude Code turn costs what it reported, or is unknown.
- `contextPeak`, the peak context as a percentage of the window, or null.
- `taskTitle` and `projectName`, read from core once per query.

`provider` and `model` answer `options` with the values the rows hold. `completedAt` is the time
field. Its starters are spend by day, spend this month by project, time agents waited on you, and
failed turns this week.

**Agent session totals** (`session-totals`) groups the rows in scope by session, and leaves out a
session with no finished turn. A record sums the time, waiting, calls, failures, changed and rewritten
files, subagents, tokens, and the cost of the turns that have one. It keeps the most failures in a
row, the most repeated calls, the most files rewritten, and the peak context of any one turn, with the
turn number and sequence where the worst failure run and repeat run started. It also carries the
session's title, provider, kind, and archived mark, its task's title and status, its project, and how
many change requests the session attached. Archived sessions are included, and so are sessions whose
history the retention pass removed. `lastCompletedAt` is the time field. Its starter lists the most
expensive sessions this month.

**Agent tool calls** (`tool-calls`) has one record per call row, with `taskTitle` and `projectName`
added. `startedAt` is the time field. `tool` and `provider` answer `options` with the values the rows
hold. Its starters are the tools that fail most this week, a heatmap of when calls failed over the
last two weeks, and today's calls by hour and tool.

**Agent approvals** (`approvals`) has one record per row of `agent_requests`, pending ones included,
with the session's task and provider. `createdAt` is the time field, and `waitMs` runs from creation
to resolution or expiry. `outcome` is worked out in SQLite from the stored resolution, so no title,
detail, payload, or answer reaches JavaScript. A policy's block is `blocked`, answers are `answered`,
a cancel is `cancelled`, and an expired row is `expired`. A chosen option is `allowed` or `denied` by
its kind in the request's own options, and any other choice is `other`. The retention pass removes a
session's requests with its history, so this source covers only sessions whose history remains. Its
starters are approvals by kind and outcome, how long they waited by day, and a heatmap of when agents
ask.

These sources and **Agent usage records** read through the plugin API's `sqlDataFilters` and
`pageDataRecords` ([serve a query](../../data-sources/serve-a-query.md)), with the scope's tasks from
`scopeTasks.ts` in `plugins/agents/src/server/data`:

1. The scope's workspace and project become the task IDs from `tasks.inProject`, archived and
   cancelled tasks included. A scope with neither reads the whole Node.
2. Comparisons on the time field, and `eq` on a source's ID and choice fields, go into SQL. That
   includes `eq` on a boolean, such as a tool call's `failed`. The whole query then runs in memory
   over what SQL returned, so SQL only narrows the read.
3. The read is newest first and stops at the 5,000-record budget. When rows of the window remain, the
   source pages through the records it kept and reports `incomplete` with `host-budget` on the last
   page, covered from the oldest record it kept. The host stops at the first page that isn't `more`,
   so an earlier `incomplete` would cut the panel to one page.
4. Each page runs the read again, because the source keeps nothing between pages.

Coverage is `events`. For the sources that read facts, it's complete once no finished turn waits for
its facts (`turnFactsPending`).

## Tool call volume

A busy database records thousands of calls a day, so tool calls get rows of their own rather than a
fold of the ledger at read time. In the ledger, a call is two JSON rows, and its output can run to
megabytes. Finding the tool rows means parsing every event, and a call's status and exit code sit in
its latest row while its start sits in its first. A call row is about 300 bytes of numbers and IDs.
The `(task_id, started_at)` index answers a scoped window with a range search, and `failed` and `tool`
narrow it further in SQL.

A busy day can still pass the 5,000-record budget, so a week of every call comes back `incomplete`.
The failure starters filter on `failed`, which SQL answers, so they read only the failures and stay
complete. The usage starter covers today.

## Measurements

On October 20, 2026, on an Apple M2 Pro, in the plugin's test tier:

- On a copy of a 3.4 GB `agents.sqlite` with 3,327 turns, the "Spend by day, last 30 days" starter
  read 3,294 turns over 33 pages and came back complete. Reading every page and running the plan's
  stages took 0.71 s, warm, the median of four runs.
- On a copy of a 3.5 GB `agents.sqlite` with 878,721 events, finding the ledger's tool rows took
  1.4 s, and listing their distinct tool names took 4.7 s. That's the read-time fold the call rows
  replace.

On the same copy, after the backfill wrote 150,696 call rows, scoped to every task, warm, the median
of four runs:

- "Tools that fail most this week" read 122 calls in 6 ms.
- "When tool calls fail, last two weeks" read 3,706 calls over 37 pages in 0.97 s. Under load from
  other work on the machine, the same read took up to 2.7 s.
- "Tool calls today by hour" read 757 calls in 29 ms.
- Listing the 78 tool names took 51 ms.
- Each approvals starter read all 293 requests in 15 ms or less.
- A read with no window filled the 5,000-record budget over 50 pages in 2.8 s, most of it the same
  read run once per page.

