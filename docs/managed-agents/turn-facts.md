# Turn facts

The agents plugin writes one row of numbers for each finished turn into `agent_turn_facts`. The row
answers how long a turn ran, how long it waited on you, how its tool calls went, what it changed, how
full its context got, and what it spent. This page covers the columns, the rules behind them, when
rows are written, and what removes them. Read it before you change a rule or read the table.

The table is declared in `plugins/agents/src/node/schema.ts`. The rules are the pure function
`computeTurnFacts` in `plugins/agents/src/server/sessions/turnFacts.ts`. `TurnFactsWriter` in
`plugins/agents/src/server/sessions/turnFactsWriter.ts` reads one turn and stores its row, and
`backfillTurnFacts` in `plugins/agents/src/server/sessions/turnFactsBackfill.ts` fills in history.

## The table

The table has one row per finished turn, keyed by `turn_id`, and indexed by `(task_id, completed_at)`
and `(session_id, started_at)`:

| Column | Holds |
| --- | --- |
| `turn_id`, `session_id`, `task_id`, `project_id` | Identity. `project_id` comes from core's `tasks.load` when the row is written, and is null when core no longer knows the task |
| `ordinal`, `first_seq` | The turn's number in its session, and the sequence of its first event, so a reader can name the turn and link to it |
| `provider`, `model`, `source`, `status` | The session's provider, the model the turn's policy names (`modelAtTurn`), the turn's source, and its final status |
| `started_at`, `completed_at`, `active_ms` | The turn's times, and the time between them |
| `first_output_ms` | From the start to the turn's first assistant message, reasoning, or tool event. Null when it produced none |
| `approval_wait_ms`, `approvals` | The time from creation to resolution of the turn's permission and question requests, summed and counted |
| `tool_calls`, `tool_failures` | Calls in the turn, its subagents' included, and how many failed |
| `longest_failure_run`, `failure_run_seq` | The most failed calls in a row, and the sequence of the run's first call |
| `repeated_calls`, `repeat_run_seq` | Calls that repeat the call before them, counted from the third in a run, and the sequence of the longest run's first call |
| `files_changed`, `files_rewritten` | Distinct paths the turn changed, and how many of them took three or more edits |
| `subagents` | Subagents with an update in the turn |
| `peak_context_used`, `context_size` | The highest context count the turn reported, and the window reported with it |
| `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `reported_cost_usd` | The turn's usage, and the provider's own cost figure or null |
| `version` | `TURN_FACTS_VERSION`, the version of the rules that wrote the row |

The row holds no text: no prompt, no tool input or output, and no file content. The writer compares
tool input in memory to count repeats and never stores it. The row holds tokens, not a price. A
reader prices them with your pricing preferences when it reads, so a price change reaches old turns
without a rewrite.

## The rules

A tool call spans several ledger rows ([how the ledger stores a tool
call](./transcript-store.md#how-the-ledger-stores-a-tool-call)). The rules fold each call's rows with
`mergeToolCall`, as the transcript does, and order the calls by their first row. Then:

- **Failures.** A call failed when its status is `failed`, or when it reported a nonzero `exitCode`.
- **Runs.** Failure runs and repeat runs are counted per stream: the session's own calls, and each
  subagent's. Parallel subagents interleave their calls in one turn, so one stream would break every
  run. When two runs tie, the first one counts.
- **Repeats.** A call repeats the one before it in its stream when kind, MCP name, and input all
  match, the identity [repeated tool calls](./repeated-tool-calls.md) uses. A call with no input
  repeats nothing. A run of three identical calls counts one repeat, and a run of four counts two.
- **Files.** A file change with a path counts toward `files_changed`. A path with three or more
  distinct change IDs counts as rewritten. A change with no change ID counts as an edit of its own.
  Codex's whole-turn diff has no path and counts toward neither.
- **Waiting.** Only `permission` and `question` requests count. A request a policy blocked never
  reached you, so it counts toward neither column. A request that expired unanswered waited until the
  turn ended.
- **Context.** `context_size` is the window last reported at or before the peak. With no context
  count, it's the last window reported. Both are null when the harness reports neither.

### Usage

Usage comes from the turn's `usage` events, turned into deltas by `usageDeltas` in
`plugins/agents/src/server/data/usageRecords.ts`, the same rule the `usage-records` data source uses.
Two counters run for the whole session:

- Codex's token counts.
- Every harness's reported cost. ACP defines `cost` as the session's running total.

So the writer also reads a baseline: the turn row's `usage_json` of the newest earlier turn in the
session whose last report carries a token count or a cost. It searches the session's turns, not its
events. Other harnesses' token counts start again each turn and need no baseline. A counter that goes
down, because a harness restarted, counts from zero again.

On October 20, 2026, Claude Code reported cost and context counts and no token counts. Codex
reported token counts and no cost.

## When rows are written

`AgentLifecycle.announceTurn` calls `onTurnSettled` when a turn reaches `completed`, `failed`,
`cancelled`, or `interrupted`, whether or not anyone listens. The engine queues the turn on the
writer, which it loads on the first settled turn. The writer reads three things:

1. The turn row, joined to its session, and the turn's requests.
2. The turn's events through the `(turn_id, seq)` index, with text, tool output, and patches
   dropped in SQLite by `json_remove`.
3. The usage baseline.

It never reads the rest of the session. It computes the row and upserts it in one transaction,
outside the transaction that settled the turn. Then the engine publishes `plugin:agents:turn-facts`
with the task, session, and turn IDs ([session events](./session-events.md#cross-plugin-lifecycle)).
A reader that refreshes on `turn-changed` would race the writer, so this event says the row exists.
A failed write is logged and left to the backfill. It never fails the turn.

A `steered` turn gets no row. Its time and calls belong to the turn it joined. A turn that never
started gets no row either.

### The backfill

After the ledger compaction finishes at startup, `repairHistoryInBackground` runs `backfillTurnFacts`.
It walks finished turns in insertion order and writes those with no row, or with a row an older
`version` wrote. To change a rule, raise `TURN_FACTS_VERSION`, and the next start rewrites every row.

Each step is one transaction of up to 50 turns. A step ends early once its writes have held the
database for 100 ms, because one turn can't be split. The pass yields between steps, stops when the
plugin stops, and never delays boot. Backfilled rows send no frame, because a pass over a large history
would send thousands.

## What removes them

- The [retention pass](./history-retention.md) keeps a session's facts when it removes its history.
  They hold numbers only, and they let you see last year's spend after the transcripts are gone.
- Deleting a session removes its facts in the same transaction (`AgentStore.deleteSession`).
- Deleting a task removes its facts, because the purge deletes each of its sessions.

## Measurements

On October 20, 2026, on an Apple M2 Pro:

- In the plugin's test tier, the largest turn of the canonical large-surface session has 19 events.
  Writing its facts took 0.47 ms at the median and 0.61 ms at the 95th percentile, over 100 writes.
- On a copy of a 3.4 GB `agents.sqlite` with 3,327 turns and 868,665 events, the backfill wrote
  3,294 rows in 4.1 seconds, in 68 steps. The longest step held the database for 161 ms.
- That copy's largest turn has 18,966 events, and 16.5 MB of them are tool rows. Writing its facts
  took about 62 ms, most of it SQLite reading the rows.

## Limits

- A usage row with no turn isn't counted. Neither is an event that lands after the row was written,
  until a version change rewrites it.
- A background subagent that reports in a later turn counts as a subagent of that turn too.
- When the previous turn's last usage report carries no total, the baseline comes from an older turn,
  so the turn also counts what the previous one added. With no earlier total at all, it counts the
  whole running total.
- A project ID is read once. A row for a task core has forgotten has none.
