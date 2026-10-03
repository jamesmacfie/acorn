# Operations

This page covers how the agents plugin queues and dispatches turns, waits out a plan limit, starts and
stops provider processes, and recovers from failure. Most of it is in
`plugins/agents/src/server/sessions/runtimeEngine.ts`.

## The turn queue

One turn dispatches per session at a time. Two ceilings bound concurrency, both set under Settings >
Limits and cost and stored in one `prefs` row, `agents:concurrency:v1`:

- The provider ceiling, 2 by default, counts one agent CLI across the whole Node, which keeps one
  account to a few turns at once.
- The workspace ceiling, 3 by default, counts every provider in one workspace.

The dispatcher reads the row on each scan, so a raise applies to the scan the write triggers. A queued
start reserves both ceilings before it starts a provider, and pending reservations count beside
active turns. Lowering a ceiling leaves running turns alone. The composer's queue is reorderable until
the dispatcher takes a turn (`QueuedAgentTurns.tsx`).

A turn is accepted once its queue row is written. A later startup failure records an error on that
turn and leaves it queued. Before it sends input, the pump rereads the queue head, so a cancel,
reorder, edit, or deferred continuation can't dispatch a stale head. The earliest deferred head
blocks later turns in its session. Workflow work gets a dispatch slot after five interactive or
automation turns.

The dispatcher runs on events. It scans when a turn is queued, a provider starts, or a turn settles. A
scan that started nothing runs again if a call arrived during it, and reconciliation runs one scan at
boot. One plugin-database statement selects queue heads and their sessions through the partial
queued-head index. Text frames don't trigger scans.

Only a turn moves a session into `working`. An event with no turn records into the transcript and
marks the session unread without claiming work. **Stop** settles a session that reports work with no
turn to cancel.

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

ACP and Codex initialization have a 60-second deadline. A stop gives ACP session close and Codex
thread unsubscribe up to 1 second, then sends SIGTERM to pipe children or SIGHUP to usage PTYs,
escalates after 2 seconds, and waits 2 more for the exit. A failed exit rejects the teardown. On macOS
and Linux, pipe children run in their own process group, and teardown signals that group and waits for
it to empty. Windows acknowledges only the direct child's exit, and would need a job object for the
same guarantee. Loaded manifest harnesses use the cancellable local ACP driver.

A stream can drop without killing the provider, and the client reattaches from the session sequence.
Cancellation, timeout, provider disconnect, and restart are explicit states.

When `session/load` answers with the protocol's resource-not-found code, the ACP driver starts a fresh
session, warns that the agent can't see the history above, and replaces the stale reference.

A provider's stderr goes to the Node log as a byte count only, because it can carry credentials. Each
session mints its own scoped internal token ([security](../security.md)), so the redaction list grows
as sessions start.

## Idle stop

A provider process runs until the session is archived or deleted, its MCP servers change, it moves to
a terminal, its task is archived, it sits idle past your limit, or the Node exits. Each one holds an
agent CLI and its MCP servers, about 450 MB.

Archiving a task runs core's `core:task-archiving` hook
([hooks](../plugins/node-side-extension-points.md#hooks)) before the worktree is removed.
`stopTaskSessions` stops each of the task's processes, marks an active turn `interrupted`, expires
pending requests, and records `stopped` with a note to restore the task and send a prompt. The sessions
aren't archived. After a restore, the next prompt resumes them.

**Stop idle agents after** is 30 minutes unless you pick 15 minutes, 2 hours, or never.
`stopIdleSessions` runs every five minutes and reads the limit each time. It stops a process only when
all of these hold:

- The process has started and isn't being set up, stopped, or reconnected.
- No turn is running or queued.
- No request is waiting on you.
- No background subagent is running.
- Nothing has come from the provider, and no turn dispatched or settled, for the whole limit.

A `ready` session records `stopped` with the limit that applied, which the client shows as resumable.
The next prompt resumes the conversation, Claude Code through `session/load` and Codex through
`thread/resume`. A `failed` session's process stops too, and nothing is recorded. Delegated and
workflow sessions get no exception: `enqueueTurn` resumes a stopped session, and a workflow gate is a
pending request, so it keeps its session. The sweep is a timer the engine owns, not a schedule
([schedules](../schedules.md#what-deliberately-is-not-a-schedule)), because it sweeps a map that
exists only in this process.

## Storage and memory

Settings > Storage and memory shows the Node's agents and offers the same stop without the wait.
`AgentStorageSection.tsx` fills core's `core:storage` point from `GET /v1/p/agents/footprint`, which
returns `AgentFootprint`: running processes, how many the rules would stop now, their memory, and the
size of the `agent-objects` and `agent-artifacts` folders. Memory is the resident memory of each
session's process tree, from one `ps -A -o pid=,ppid=,rss=` walk down from each driver's `pid`
(`plugins/agents/src/server/sessions/footprint.ts`). It counts shared pages more than once, so the
page says "about". Where `ps` fails, or on Windows, it shows counts without memory. Folder sizes are
measured at most every 30 seconds.

**Stop idle agents now** is `POST /v1/p/agents/stop-idle`, which runs `stopIdleSessionsNow` with the
same rules and no time limit. Both routes are device-only, because they reach every task's agents.

## Shutdown

Shutdown runs in an order that can't revive what it stopped: cancel every pending reconnect timer,
because a live one would call `ensureSession`, then stop each provider, then flush the event buffer's
timers, then stop the webhook delivery pump. All of it runs before the plugin's SQLite file closes.
`dispose()` in `plugins/agents/src/node/index.ts` runs this and then clears its capability bridges, so
a second boot in one process never reads through the first boot's closed handle
(`apps/node/src/composition/runtime.test.ts`).

[Archived agent history](./history-retention.md) covers the retention pass.
