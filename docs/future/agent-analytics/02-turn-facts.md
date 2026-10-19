# Phase 2: record the facts of each finished turn

## Completion note

Built on October 20, 2026, on branch `phase-2-turn-facts`.

What landed:

- `agent_turn_facts`, migration `0019_agent_turn_facts.sql`, with the columns and indexes below.
  `project_id` is nullable, for a task core no longer knows.
- `computeTurnFacts` in `turnFacts.ts` holds the rules. `TurnFactsWriter` in `turnFactsWriter.ts`
  reads one turn and upserts its row in one transaction. `AgentLifecycle.announceTurn` calls
  `onTurnSettled` before its publisher check. The engine loads the writer on the first settled turn,
  then publishes `plugin:agents:turn-facts`, which is in the manifest's `emits` and the lifecycle
  contract.
- `backfillTurnFacts` in `turnFactsBackfill.ts` runs after the ledger compaction, from
  `repairHistoryInBackground`, which replaces `compactLedgersInBackground`.
- `AgentStore.deleteSession` removes a session's facts. The task purge goes through it. The retention
  pass keeps them.
- [Turn facts](../../managed-agents/turn-facts.md) documents the table, the rules, and the
  measurements. Session events, plugin events, history retention, and `docs/managed-agents.md` link
  to it.

Decisions and deviations:

- A reported cost is the session's running total for every harness. ACP defines it that way, and the
  owner's database agrees: one Claude session reported 0.31, 0.64, 3.05, 3.99, then 4.25 USD over five
  turns. `usageDeltas` in `usageRecords.ts` counts cost from the session's previous report. This also
  fixes the `usage-records` source, which counted each Claude turn's whole running total. On the copy,
  Claude's facts summed to 6,583 USD with the fix and 20,116 USD without it, against 6,707 USD in the
  sessions' final reports.
- The usage baseline applies to every harness, because cost needs one. It comes from the newest
  earlier turn's `usage_json` that carries a token count or a cost, so it reads the session's turns,
  never its events. When the previous turn's last report carries no total, the baseline comes from
  an older turn, and the turn also counts what the previous one added.
- Failure runs and repeat runs are counted per stream, the session and each subagent, because parallel
  subagents interleave their calls. Repeats use the repeated-call warning's identity: kind, MCP name,
  and input.
- A blocked request counts toward neither `approvals` nor `approval_wait_ms`. An expired one waited
  until the turn ended.
- A turn that never started gets no row, like a `steered` one.
- A backfilled row publishes no frame. A pass over the owner's history would send about 3,300.
- A backfill step ends early once its writes have held the database for 100 ms. A step of 50 held it
  for 208 ms, because one turn has 18,966 events and takes about 62 ms on its own.
- The writer drops text, tool output, and patches in SQLite with `json_remove`, so a long turn sends
  about a fifth of its bytes to JavaScript.
- The Node service's size ceiling went from 1,900,300 to 1,903,000 bytes. The table definition sits
  in the boot graph, because `schema.ts` is a static import and drizzle-kit reads it. With the engine
  wiring, the boot graph grew 2,708 bytes. The writer, the rules, and the backfill load on first use.

Acceptance, measured on October 20, 2026:

- A runtime test drives a fake-driver turn and sees the row, then `turn-facts`, within a second. The
  frame's listener reads the row as it arrives.
- A test puts 10,000 earlier events in the session. The writer reads the turn's three events, and the
  query plan is one search of `agent_events_turn_seq_idx`.
- The canonical session's largest turn has 19 events. Its facts took 0.61 ms at the 95th percentile.
- The backfill on a copy of the owner's 3.4 GB `agents.sqlite` wrote 3,294 rows in 4.1 seconds, in 68
  steps. The longest step held the database for 161 ms.
- The retention test shows a session's facts survive its history removal and go when its task is
  purged.

For later phases:

- Phase 3 prices tokens at read time. Claude Code reports no token counts, only cost and context, so
  a Claude turn's spend is `reported_cost_usd` or nothing. Codex reports tokens and no cost.
- `usageDeltas` is the shared delta rule. The sources should use it rather than copy it.
- Raise `TURN_FACTS_VERSION` when a rule changes, and the next start rewrites every row.
- Out of scope, and still wrong: a workflow step's usage sums Claude's per-turn costs
  (`operationUsage` in `sessionExecute.ts`), and
  [unattended follow-ups](../../managed-agents/unattended-follow-ups.md#usage) calls Claude a per-turn
  provider. A step with continuation turns overcounts its cost.

Date: October 19, 2026. Status: proposed. Needs nothing.

## Goal

When a turn finishes, the agents plugin writes one row of numbers about it: how long it ran, how long
it waited on the person, how its tool calls went, what it changed, how full its context got, and what
it spent. History gets the same rows from a background pass. [Phase 3](./03-agent-sources.md) serves
the rows as data sources. This phase adds no route, view, or event that a person sees.

## Starting point

- `agent_turns` holds each turn's `status`, `source`, `startedAt`, `completedAt`, `stopReason`, and
  its last usage in `usage_json` (`plugins/agents/src/node/schema.ts`). `agent_requests` holds each
  request's `turnId`, `kind`, `createdAt`, and `resolvedAt`.
- `agent_events` is indexed by `(turn_id, seq)`, so one turn's events read without touching the rest
  of its session.
- The ledger stores each tool call as its opening row and its most recent folded row, with `status`,
  `exitCode`, `name`, `input`, `paths`, and `subagentId` ([the transcript
  store](../../managed-agents/transcript-store.md#how-the-ledger-stores-a-tool-call)). A file change
  carries `path` and `changeId` ([file changes](../../managed-agents/activity.md#file-changes)).
- `usageRecords` in `plugins/agents/src/server/data/usageRecords.ts` turns stored usage snapshots into
  per-event deltas. Codex reports totals for the whole session, and other harnesses per turn, so the
  conversion keys Codex by session.
- Every committed turn change reaches `lifecycle.announceTurn` in
  `plugins/agents/src/server/sessions/lifecycle.ts`, called by the store after the transaction. It
  returns at once when no publisher is attached.
- `compactLedgers` in `plugins/agents/src/server/sessions/ledgerCompaction.ts` is the model for a
  background pass: small transactions, a yield between them, and boot that doesn't wait.
- The retention pass removes a session's events, turns, and requests, and keeps the session row
  ([archived agent history](../../managed-agents/history-retention.md)).
  `plugins/agents/src/server/sessions/deletedTaskPurge.ts` removes everything for a deleted task.
- Settling a session's commands reads its whole history on every turn end. That cost 230 ms warm on
  the owner's largest session when measured on October 19, 2026. The facts writer must not add a
  second read like it.

## The design

### The table

Add `agent_turn_facts` with one row per finished turn, keyed by `turn_id`:

| Column | Holds |
| --- | --- |
| `turn_id`, `session_id`, `task_id`, `project_id` | Identity. `project_id` is read once from core's `tasks.load` when the row is written, because a task never changes project |
| `ordinal`, `first_seq` | The turn's number in its session, and the sequence of its first event, so a reader can name the turn and link to it |
| `provider`, `model`, `source`, `status` | The session's provider, the turn's model as `usageSourceHandler.ts` reads it, the turn's source, and its final status |
| `started_at`, `completed_at`, `active_ms` | The turn's times, and the time between them |
| `first_output_ms` | From start to the turn's first assistant message, reasoning, or tool event. Null when it produced none |
| `approval_wait_ms`, `approvals` | The summed and counted time from creation to resolution of the turn's permission and question requests. A request a policy blocked counts zero |
| `tool_calls`, `tool_failures` | Calls in the turn, its subagents' included. A failure is status `failed`, or a nonzero `exitCode` |
| `longest_failure_run`, `failure_run_seq` | The most failures in a row, in the order the calls started, and the sequence of the run's first call |
| `repeated_calls`, `repeat_run_seq` | Calls that repeat the call before them exactly, by `name` and `input`, counted from the third in a run, and the sequence of the longest run's first call. Three identical failing commands count one |
| `files_changed`, `files_rewritten` | Distinct paths in the turn's file changes, and how many of them had three or more distinct `changeId`s |
| `subagents` | Subagents the turn started |
| `peak_context_used`, `context_size` | The highest `contextUsed` the turn reported, and the window it reported with it. Null when the harness reports neither |
| `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `reported_cost_usd` | The turn's usage deltas from `usageRecords`, summed. `reported_cost_usd` is the provider's own figure, or null |
| `version` | The fact rules' version, a constant in the writer |

The row holds no text: no prompt, no tool input or output, and no file content. Input is compared in
memory to count repeats and never stored.

The writer stores tokens, not an estimated price. [Phase 3](./03-agent-sources.md) prices tokens when
it reads them, with the person's pricing preferences at that moment, as `usage-records` does. A price
change then reaches old turns without a rewrite.

A `steered` turn gets no row. Its time and calls belong to the turn it joined, which has its own.

### The writer

`computeTurnFacts` is a pure function in `turnFacts.ts`, beside `ledgerFold.ts` in
`plugins/agents/src/server/sessions`. It takes the turn row, the turn's events in sequence order, its
requests, and the session's usage snapshot before the turn, and returns the row. Keeping it pure lets
the tests feed it the captured harness fixtures in `plugins/agents/src/server/drivers/__fixtures__`.

`TurnFactsWriter` reads those inputs and writes the row. It reads:

1. The turn row and its requests.
2. The turn's events through the `(turn_id, seq)` index.
3. For Codex only, the last usage event of the session's previous turn, which is the baseline its
   session totals are counted from.

It never reads the whole session.

`AgentLifecycle` takes an optional `onTurnSettled(turnId)` callback and calls it from `announceTurn`
when the turn's status is `completed`, `failed`, `cancelled`, or `interrupted`. The call comes before
the publisher check, so facts don't depend on anyone listening. The writer queues the turn and writes
outside the event's transaction. A failure is logged and left to the backfill pass, and never fails the
turn.

After a row commits, the plugin publishes `plugin:agents:turn-facts` with `taskId`, `sessionId`, and
`turnId`. A reader that refreshes on `turn-changed` would race the writer, so this event says the row
exists. Add the verb to the agents manifest's `emits` and to the lifecycle contract in
`plugins/agents/src/contract/lifecycle.ts`.

### History

`backfillTurnFacts` in `turnFactsBackfill.ts` finds finished turns with no row, or a row whose
`version` is lower than the writer's, oldest first. It writes 50 a step, one transaction each, and
yields between steps, as `compactLedgers` does. It starts after the Node is ready and never blocks
boot. A later rule change bumps `version`, and the same pass rewrites the rows.

A turn whose history the retention pass already removed has nothing to read and gets no row.

### Removal

- The retention pass keeps facts. They hold numbers only, and they let a person see last year's spend
  after the transcripts are gone. This is decision 1 in the [README](./README.md#decisions-for-the-owner).
- Deleting a task removes its facts, in the same purge that removes its sessions.
- Deleting a session removes its facts.

## Steps

1. Add the table and its migration, numbered after the last one in `plugins/agents/migrations`. Index
   `(task_id, completed_at)` and `(session_id, started_at)`.
2. Write `computeTurnFacts` and its tests from the Claude Code and Codex fixtures. Cover repeats, a
   failure run broken by a success, Codex's session totals across two turns, a subagent's calls, and a
   turn with no usage.
3. Add `TurnFactsWriter` and the `onTurnSettled` callback, and publish `turn-facts`.
4. Add the backfill pass, and the removal in the task and session delete paths.
5. Document the table and its rules in a page named `turn-facts.md` beside the transcript store in
   the managed agents docs, and add the event to
   [session events](../../managed-agents/session-events.md).

## Acceptance

- A finished turn has a facts row within a second, and `turn-facts` fires after it commits.
- A test shows the writer reads only the turn's events: run it against a session with 10,000 earlier
  events, and count the rows read.
- Writing facts for the largest turn in the canonical session takes under 20 ms at the 95th
  percentile in the plugin's test tier. Record the measurement and its date in the page from step 5.
- Run the backfill against a copy of a large `agents.sqlite`, never the live one. Record its duration
  and its longest step. No step may hold the database for more than 200 ms.
- After the retention pass removes a session's history, its facts rows remain. After the task is
  deleted, they're gone.
