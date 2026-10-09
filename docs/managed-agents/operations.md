# Operations

This page covers how the agents plugin queues and dispatches turns, waits out a plan limit, starts and
stops provider processes, and recovers from failure. `queueCoordinator.ts` owns queue scans,
fairness, delayed wakeups, and drain. `providerSessionLifecycle.ts` owns live provider generations,
children, process timers, and callback joins. `runtimeEngine.ts` owns durable event handling and
dispatch outcomes; `runtime.ts` composes one engine and persists accepted turns before requesting a
scan. The facade owns session reservation, initialization, defaults, titles, transcript import and
export, configuration, and history retention. Its readonly store, attachment, artifact, webhook, and
MCP references point to the engine's instances. Product commands call explicit engine operations
for readiness, provider handles, event recording, queue wakeup, and retirement.
Transcript import, resume verification, and export load their command module on first use, then
share one instance.

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

Immediately before the driver send, the runtime applies enabled
[instruction checks](../security.md#instruction-file-checks-and-review) to every queued source,
including resumes, workflow turns, and delegated agents. An incomplete scan or changed snapshot
fails that turn with a retry or review instruction. Optional `agents:before-send` plugin hooks retain
their independent failure behavior.

The store captures provider settings and host attendance at the same acceptance boundary, including
goal turns. Goal turns use the same admission hooks as person turns. Interactive and imported sessions resolve to `attended`,
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

## Session goals

An interactive session can hold one goal of up to 2,000 characters. Set it from the conversation or
the **Set session goal** palette command. If the session is idle, acorn queues the goal as its first
turn. Goal turns use the normal queue and count against the same concurrency and usage limits.

After a turn settles and its queue drains, acorn checks the goal against the event ledger. The check
reads recent messages and shortened tool input and output, with a 12,000-character evidence limit.
It uses a one-shot call on the session's harness. Claude Code uses its `haiku` alias; other harnesses
use their configured default. A failed or invalid check blocks the goal and does not queue more work.

Only a verdict that says useful work remains queues another **Goal** turn. A goal stops after eight
continuations or two consecutive goal turns without a tool call or file change. **Stop** pauses an
active goal. **Resume** queues a turn to carry on. A restart interrupts an active provider turn and
pauses its goal, as does a provider disconnect during a turn. A dispatch failure blocks the goal.
An admission refusal also blocks the goal and queues no turn.
A completed turn whose check was interrupted is checked after startup. The session
row stores the objective, counters, status, and last verdict, so every client sees the same state.

The goal route is device-only: `PUT /v1/p/agents/sessions/:id/goal` accepts an objective or `null`
to clear it, and `POST /v1/p/agents/sessions/:id/goal/resume` resumes a paused goal. Workflow,
delegated, imported, terminal-controlled, and archived sessions cannot accept a goal.

A workflow step's completion condition uses the same judge, evidence limit, and continuation limits
(`judgeGoal` in `plugins/agents/src/server/sessions/sessionGoal.ts`), but the step owns it, not the
session. `agents.sessionExecute` checks it inside the step's operation and queues the continuations
itself, so interactive goal scheduling never sees a workflow session. Each verdict is an
`agent_operations` row keyed by the attempt's opening turn and the turns it read
(`workflow.goal.evaluate`), and the attempt's final state is one more (`workflow.goal`). A retry
opens a new turn, so its state starts clean. Startup doesn't restart a step's goal work. Only the
workflow runner's recovery and retry do. The run's own **Stop** and **Retry** control a workflow
session, which has no goal **Edit**, **Clear**, or **Resume**. For the step's side, see
[agent steps](../workflows/agent-steps.md#completion-conditions).

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
([hooks](../plugins/hooks.md#hooks)) before the worktree is removed.
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
pending request, so it keeps its session. The sweep is a timer the lifecycle owner holds, not a schedule
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
measured at most every 30 seconds. The footprint helper loads when a measurement is requested, and
shutdown joins a sample already in progress.

**Stop idle agents now** is `POST /v1/p/agents/stop-idle`, which runs `stopIdleSessionsNow` with the
same rules and no time limit. Both routes are device-only, because they reach every task's agents.

## Shutdown

Shutdown closes queue admission, aborts starts, and clears reconnect, quiet, idle, and process sample
timers. It joins every provider retirement, queue scan, and callback, then flushes durable events and
search, joins publication work, and stops webhook delivery. All of it runs before the plugin's SQLite
file closes.
The facade starts engine retirement as soon as `stop()` is called. It also joins title generation,
session reservations, and initialization work before returning. Repeated calls share the same stop
promise, and an engine or title stop failure reaches plugin disposal.
`dispose()` in `plugins/agents/src/node/index.ts` runs this and then clears its capability bridges, so
a second boot in one process never reads through the first boot's closed handle
(`apps/node/src/composition/runtime.test.ts`).

[Archived agent history](./history-retention.md) covers the retention pass.
