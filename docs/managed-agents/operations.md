# Operations

This page covers how the agents plugin queues and dispatches turns, waits out a plan limit, starts and
stops provider processes, and recovers from failure. `runtime.ts` is the one object routes,
capabilities, and the composition root call. Its methods are the session commands and lifecycle
steps, and its fields are the collaborators a caller reaches directly, such as the store, the provider
catalogue, and process upkeep (`processUpkeep.ts`). `runtimeEngine.ts` is internal to it: it accepts
turns into the durable queue, records events, and settles dispatch outcomes. `queueCoordinator.ts` owns
queue scans, fairness, delayed wakeups, and drain. `providerSessionLifecycle.ts` owns live provider
generations, children, process timers, and callback joins. `store.ts` owns the session tables.
Transcript import, resume verification, and export load their command module on first use.

## The turn queue

One turn dispatches per session at a time. Two ceilings bound concurrency, both set under Settings >
Limits and cost and stored in one `prefs` row, `agents:concurrency:v1`:

- The provider ceiling, 2 by default, counts one agent CLI across the whole Node, which keeps one
  account to a few turns at once.
- The workspace ceiling, 3 by default, counts every provider in one workspace.

The dispatcher reads the row on each scan, so a raise applies to the scan the write triggers. A queued
start reserves both ceilings before it starts a provider, and pending reservations count beside
active turns. Lowering a ceiling leaves running turns alone. The composer's queue is reorderable until
the dispatcher takes a turn (`QueuedAgentTurns.tsx`). A row you sent can be [steered](./steering.md)
into the running turn instead.

A turn is accepted once its queue row is written. A later startup failure records an error on that
turn and leaves it queued. Before it sends input, the pump rereads the queue head, so a cancel,
reorder, edit, or deferred continuation can't dispatch a stale head. The earliest deferred head
blocks later turns in its session. Workflow work gets a dispatch slot after five interactive or
automation turns.

Immediately before the driver send, the runtime applies enabled
[instruction checks](../security.md#instruction-file-checks-and-review) to every queued source,
including resumes, workflow turns, and delegated agents. An incomplete scan or changed snapshot
fails that turn with a retry or review instruction. Optional `agents:before-send` plugin hooks retain
their independent failure behavior.

The store captures provider settings and host attendance at the same acceptance boundary, including
goal turns ([session goals](./session-goals.md)). Goal turns use the same admission hooks as person turns. Interactive and imported sessions resolve to `attended`,
delegated sessions to `supervised`, and workflow sessions to `supervised` under `gated` or
`autonomous` under the host's autonomous posture. Plugin follow-ups inherit their admitted origin's
attendance. Usage-limit continuations retain the original row and policy. Unknown persisted values
fail before dispatch. Legacy turns without attendance are backfilled durably from the host session
snapshot; older sessions without that snapshot use their original attended or supervised behavior.

The coordinator runs on events. It scans when a turn is queued, a provider starts, or a turn settles. A
scan that started nothing runs again if a call arrived during it, and reconciliation runs one scan at
boot. One plugin-database statement selects queue heads and their sessions through the partial
queued-head index. Text frames don't trigger scans.

Only a turn moves a session into `working`. An event with no turn records into the transcript and
marks the session unread without claiming work. **Stop** settles a session that reports work with no
turn to cancel.

**Stop** remains available while a session reports `reconnecting`. It cancels a live turn through
the provider. If the turn has already ended, it stops the provider generation and pending recovery,
expires pending requests, and records `stopped`. Sending another turn resumes the session.

## Plan usage limits

A plan usage limit pauses the turn until the account resets. The runtime needs two facts: a provider
error that looks like a usage or rate limit, and that harness's fresh usage collector reporting every
depleted quota with an exact reset time. It waits for the latest reset plus a short grace, stores that
time and a continuation prompt on the turn, and puts the turn back in the queue. The input, turn ID,
source, and policy stay the same, so workflow and delegation callers keep waiting on the same turn. At
the stored time, the dispatcher sends the continuation into the same provider session.

The wait survives a restart, and the transcript says when acorn will continue. You can remove the
queued card. Turning off `continueAfterUsageLimit` leaves limit errors as failures. A collector with
no exact reset can't schedule, so the error stays a failure, and a short transient rate limit doesn't
enter the long queue. Claude's harness turns off Claude Code's own automatic continuation for ACP
sessions, so acorn's setting decides. Claude Code in a terminal keeps your Claude setting.

## Process startup and teardown

Startup belongs to one session generation before its first task, workspace, or ledger read.
Concurrent callers join it. Stopping aborts pending startup and rejects callbacks from older
generations. `createSession` returns after provider readiness and saved settings apply. Interactive
creation is accepted once the session row is durable, so a startup failure marks that row `failed`
and records the error in its ledger.

The lifecycle owner installs a generation before reading the task, workspace, or session ledger. It
gets those reads, the scoped environment, MCP configuration, and durable callbacks through specific
engine ports. Callers receive immutable occupancy facts or a generation identity. The owner checks
that identity before a handle command or state transition. The engine keeps the one redaction list
shared with event materialization and the durable event buffer.

ACP and Codex initialization have a 60-second deadline. A stop gives ACP session close and Codex
thread unsubscribe up to 1 second, then sends SIGTERM to pipe children or SIGHUP to usage PTYs,
escalates after 2 seconds, and waits 2 more for the exit. A failed exit rejects the teardown. On macOS
and Linux, pipe children run in their own process group, and teardown signals that group and waits for
it to empty. Windows acknowledges only the direct child's exit, and would need a job object for the
same guarantee. Loaded manifest harnesses use the cancellable local ACP driver.

Each pipe child starts at nice 5, just below the window, the helper, and the Node, and everything it
starts inherits that. Nice lowers CPU share only, so an agent's builds keep their disk priority.
Terminal sessions you type in keep theirs. If the platform refuses the change, the Node logs it once.

A stream can drop without killing the provider, and the client reattaches from the session sequence.
Cancellation, timeout, provider disconnect, and restart are explicit states.

When `session/load` answers with the protocol's resource-not-found code, the ACP driver starts a fresh
session, warns that the agent can't see the history above, and replaces the stale reference.

A provider's stderr goes to the Node log as a byte count only, because it can carry credentials. Each
session mints its own scoped internal token ([security](../security.md)), so the redaction list grows
as sessions start.

## Idle stop

A provider process runs until the session is archived or deleted, its MCP servers change, it moves to a
terminal, its task is archived, the idle stop takes it, or the Node exits. Each one holds an agent CLI
and its MCP servers, about 450 MB. While a session works or waits on you, the Node keeps the computer
awake ([keep awake](../node-distribution/keep-awake.md)).

Archiving a task runs core's `core:task-archiving` hook ([hooks](../plugins/hooks.md#hooks)) before
the worktree goes. `stopTaskSessions` in `processUpkeep.ts` stops the task's processes, marks an active
turn `interrupted`, expires pending requests, and records `stopped` with a note to restore the task and
send a prompt. The sessions stay, and after a restore the next prompt resumes them.

**Stop idle agents after** is 30 minutes unless you pick 15 minutes, 2 hours, or never. **Stop idle
agents above** is 4 GB unless you pick 2 GB, 8 GB, or no limit. `stopIdleSessions` in
`processUpkeep.ts` reads both each time it runs: every five minutes and after each provider start, one
sweep at a time. First it stops each process that heard nothing from its provider, and had no turn
dispatched or settled, for the whole time limit. Then, while the process trees, measured as in
[Storage and memory](#storage-and-memory), hold more than the memory limit together, it stops idle
processes, longest idle first. It never stops a process while any of these hold:

- The process is being set up, stopped, or reconnected.
- A turn is running, queued, or being handed to the process.
- A request is waiting on you.
- A background subagent is running.

A `ready` session records `stopped` with the limit that applied, which the client shows as resumable.
The next prompt resumes the conversation, Claude Code through `session/load` and Codex through
`thread/resume`. A `failed` session's process stops too, and nothing is recorded. Delegated and
workflow sessions get no exception: `enqueueTurn` resumes a stopped session, and a workflow gate is a
pending request, so it keeps its session. The sweep is a timer the lifecycle owner holds, not a
[schedule](../schedules.md#limits), because it sweeps a map that exists only in this process.

## Storage and memory

Settings > Storage and memory shows the Node's agents and offers the same stop without the wait.
`AgentStorageSection.tsx` fills core's `core:storage` point from `GET /v1/p/agents/footprint`, which
returns `AgentFootprint`: running processes, how many the rules would stop now, their memory, and the
size of the `agent-objects` and `agent-artifacts` folders. Memory is the resident memory of each
session's process tree, from one `ps -A -o pid=,ppid=,rss=` walk down from each driver's `pid`
(`plugins/agents/src/server/sessions/footprint.ts`). It counts shared pages more than once, so the
page says "about". Where `ps` fails, or on Windows, it shows counts without memory. Folder sizes are
measured at most every 30 seconds. The footprint helper loads when a measurement is requested, and
shutdown joins a sample already in progress.

**Stop idle agents now** is `POST /v1/p/agents/stop-idle`, which runs `stopIdleSessionsNow` with the
same rules and no time limit. Both routes are device-only, because they reach every task's agents.

### Indexes on the event ledger

`agents.sqlite` held about 830,000 events on one machine, and the Node reads it with a synchronous
`DatabaseSync`, so a statement that scans the table stops every request until it ends. Three partial
indexes on `agent_events` keep the reads that run often off a scan. SQLite uses an index on an
expression only when the query writes the expression the same way, so each read repeats the index's
`->>` expression exactly. A `json_extract` of the same path doesn't match, and the read scans the
session or the table. Each has a plan test that fails when a read stops using its index.

| Index | Rows it holds | Read |
| --- | --- | --- |
| `agent_events_session_tool_idx` | Tool rows, by session and tool ID | One call by ID, the command settle, and `commandTurn` (`commandLifecycle.ts`) |
| `agent_events_usage_time_idx` | Usage rows, by time, session, and sequence | A window of the usage source, newest first |
| `agent_events_usage_baseline_idx` | Usage rows with a token count or a cost, by session and sequence | The report a window's deltas count from |

A turn's end settles only that turn's commands, through `agent_events_turn_seq_idx`. A session state
or a subagent's end settles the whole session. A `#session` reference reads the newest 201 events,
not the session.

## Shutdown

Shutdown closes queue admission, aborts starts, and clears reconnect, quiet, idle, and process sample
timers. It joins every provider retirement, queue scan, and callback, then flushes durable events and
search, joins publication work, and stops webhook delivery. All of it runs before the plugin's SQLite
file closes. The facade starts engine retirement as soon as `stop()` is called. It also joins title
generation, session reservations, and initialization work before returning. Repeated calls share the same
stop promise, and an engine or title stop failure reaches plugin disposal. `dispose()` in
`plugins/agents/src/node/index.ts` runs this and then clears its capability bridges, so a second boot in
one process never reads through the first boot's closed handle
(`apps/node/src/composition/runtime.test.ts`).

[Archived agent history](./history-retention.md) covers the retention pass.
