# Session events and waits

This page covers the bounded wait route, the lifecycle events other plugins read, and the telemetry a
session reports. All three describe a session without copying its private content.

## Bounded waits

The wait route returns `session`, `turns`, `requests`, and up to 500 events. Its `wait` field carries
`until`, `afterSeq`, `matched`, a qualifying `terminal` fact, and `eventsThroughSeq` with
`eventsComplete`. The facts and the snapshot come from one SQLite transaction. A cut-off event list
doesn't mean the completion is missing. Delegation reads the `terminal` fact and keeps its own
`matched`, `timedOut`, `state`, `attention`, and `lastSeq` result fields.

The conditions match like this:

- `turn_completed` matches a committed `turn_completed` or `error` event after the cursor, even past
  the returned events. An earlier completed turn, or a ready session, doesn't count.
- Ready, attention, and stopped read the current session row. Attention leaves out `none` and
  `unread`. Stopped covers `stopped`, `failed`, and `archived`.

Each waiter subscribes before it reads, runs one check at a time with one follow-up queued, and
ignores frames from other sessions. A timeout returns the authoritative snapshot, which may match by
the time it commits. Caller cancellation, deletion of the target, a storage failure, or engine
shutdown rejects the wait. Settling removes the listener, the deadline, and the abort handlers. An
HTTP wait forwards its request's abort signal without cancelling the session's work.

## Cross-plugin lifecycle

Three plugin events describe the durable model, and a fourth describes what a session is doing
([activity](#activity)):

- `plugin:agents:turn-changed` carries the task, session, turn, source, status, and attempt after a
  turn is queued, dispatched, retried, settled, or repaired at restart.
- `plugin:agents:request-changed` carries the task, session, provider request ID, kind, and status
  after a request is created, claimed, acknowledged, expired, cleaned up, or repaired.
- `plugin:agents:sessions-changed` carries task and session IDs, presence and archive state, and a
  `changes` array of `created`, `renamed`, `archived`, `restored`, or `deleted`. A rename also
  carries `renameSource`, `generated` or `user`. Titles stay out of the payload.
- `plugin:agents:activity` carries one tool call's, subagent's, or context count's current state.

The store and repository send these after the commit, not each route on its own. Node consumers
rebuild state through the task-scoped `agents.turns`, `agents.requests`, and `agents.sessions`
capabilities. Turn reads leave out the prompt, the effective policy, errors, and transcript content,
and request resolution stays private to the runtime. A roster entry also carries the session's
advertised `configOptions`, which is what [session control](./session-control.md) accepts. Core's `agent-session:changed` is the generic
completion and attention event, and `agent:*` is the transcript stream.

## Activity

`plugin:agents:activity` and `agents.activity.v1` let a plugin draw a live view of a session on any
harness, from the ledger every driver already fills. The types are in
`plugins/agents/src/contract/lifecycle.ts`, and `server/sessions/activity.ts` is the one projection
the frames and the read share. Outside this repository, import `AgentActivityCapability` from
`acorn-plugin-types`, and cast each `events.on` frame to `AgentActivityFrame` from the same package.

A frame names its task and session and carries one item's whole current state, keyed by its id, so a
later frame for the same item replaces it:

- `tool`: `toolCallId`, `turnId`, `kind`, `title`, `status`, up to 8 `paths`, and the `subagentId` that
  ran it. Sent when an update reports a status, so a call sends its start and its finish, and an output
  chunk sends nothing.
- `subagent`: `subagentId`, `turnId`, `title`, `role`, `status`, and `background`. Sent the same way.
  Its parent is the session: harnesses report one level of subagents, and a tool's `subagentId` hangs
  it under one.
- `usage`: `contextUsed` and `contextSize`, merged with what was last sent. Sent only when either
  changes, because harnesses report usage several times a turn.

Tool input and output, message text, reasoning, and command lines stay out. The title is what the
transcript card shows, except a command's: Codex and Claude title a command with its command line, so a
call of kind `execute` is always titled `Command`. Titles are cut at 200 characters. Command lines stay
with [the permission hook](./permission-policy.md), where the grant is explicit. No harness reports
rate-limit percentages per session. Plan usage is account-wide, on the
[providers](./providers.md) page.

The repository publishes a frame after the event's transaction commits, beside the turn and request
announcements. `read({ taskId, sessionId })` rebuilds the same items from the ledger: each tool call's
newest stored row, which holds its whole folded state, the session row's subagent roster, and the
newest context counts. It keeps the 50 newest tools and subagents, and answers `null` for a session
outside the task. A consumer that reads once and then applies each frame, replacing the item by its
id, holds the same items the read would return. That holds after a Node restart, because the read
comes from the ledger alone. `lifecycle.test.ts` checks it. Order is a display hint, not part of the
state: the read lists tools by their last stored update, and an output chunk moves that without a
frame.

| Harness | Tools | Subagents | Context |
| --- | --- | --- | --- |
| Claude Code | Every call, kind from ACP | `Agent` calls, attributed tool calls | `contextUsed`, `contextSize` |
| Codex | Commands, file changes, MCP and dynamic tools, web searches | Child threads, attributed tool calls | Last request's tokens and the context window |
| DeepSeek | Every call as kind `other`, titled by tool name | None | `contextUsed`, `contextSize` |
| `omp` | Every call through ACP | None in ACP mode | What its `usage_update` carries |

## Review input

`agents.reviewInput.v1` reads one completed turn for a reviewer, such as the `acorn-advisor`
plugin. The contract is in `plugins/agents/src/contract/lifecycle.ts`,
and a plugin outside this repository imports `AgentReviewInputCapability` from `acorn-plugin-types`.
`read({ taskId, sessionId, turnId })` checks that the turn belongs to that session and the session
to that task. A turn outside them, or a missing one, answers `{ available: false, reason:
'not-found' }`, so a reader learns nothing about turns it may not see. A turn that hasn't completed
answers `not-completed`.

A completed turn returns two things, and nothing else:

- `userText`: the turn's text and context parts in order, at most 16 KiB of UTF-8 in all. Each part
  has a `provenance`. Only text typed into an interactive turn is `person`. Text in another kind of
  turn names the turn's source, such as `plugin` or `delegation_report`, and an attached context
  snapshot carries its source ID and label. A part cut at the bound has `truncated: true`, the parts
  after it are dropped, and `userTextTruncated` is true.
- `finalText`: the turn's last top-level assistant message, folded from its streamed deltas, at most
  32 KiB, with `finalTextTruncated`. A subagent's message isn't the agent's answer, so it's skipped.

Files, attachments, images, paths, tool calls and their output, reasoning, and the event ledger stay
out. The read selects assistant rows only, so tool output never leaves SQLite. Stop reasons come from
`agents.turns`, not from this reader.

The fallback title, a generated title, and a rename all go through the repository's one title write,
which also publishes the `agent:session` frame clients use to update their cache.

## What a session reports

Starting a provider raises an `agent.session.start` span through `ctx.telemetry`
([ambient attribution](../telemetry/runtimes.md#ambient-attribution)). It covers task-root resolution,
workspace and execution-history reads, MCP preparation, and the provider handshake. Its child
`agent.session` covers the driver start alone, preserving the provider-only timing.

Both spans carry task and session IDs, the provider, whether it reconnected, and outcome `ready`,
`error`, or `cancelled`. Child `agent.session.phase` spans carry a fixed `phase` label:

| Phase | What it waits for |
| --- | --- |
| `task.root`, `workspace.read`, `history.read`, `mcp.prepare` | The runtime's preparation before driver start |
| `driver.load` | Protocol session code and ACP SDK imports |
| `provider.probe` | Codex executable discovery, authentication status, and version checks before protocol startup |
| `provider.initialize` | The protocol initialization response, including process startup |
| `provider.session.create`, `.resume`, `.load` | The provider's session or thread response. A refused resume followed by fresh creation produces separate error and success spans |
| `provider.models`, `.permissions`, `.skills`, `.modes` | Each Codex metadata request, measured separately while they run concurrently |
| `provider.metadata`, `provider.ready` | Durable metadata and readiness event handling |

The driver phases are children of `agent.session`; runtime preparation phases are children of
`agent.session.start`. An optional metadata failure keeps its error outcome even when startup succeeds.
Cancellation closes an active phase when the signal aborts. Neither protocol parameters nor error
messages become attributes. The shared ACP driver and native Codex driver emit protocol phase detail;
other native drivers retain the total driver span. These spans start at provider connection, after
session admission has resolved its initial task root. Worktree preparation during admission has
[its own spans](../telemetry/runtimes.md#task-preparation).

Dispatching a turn raises an `agent.turn` span. The turn span
carries the turn ID, session ID, provider, and source. Neither carries a prompt, a result, or a
transcript. When the turn ends, it also carries `first_output.ms`, the time to the provider's first
message, reasoning, or tool call, and `approval.wait.ms`, the time the turn waited on permission asks.
The second tells a slow provider apart from a person who hasn't clicked **Allow** yet.

The startup spans cover connecting the provider, because a session
outlives its process and a span over its life couldn't close. The turn span opens at dispatch, not at
enqueue, because a turn can wait minutes behind the concurrency limit. It closes on a completed turn,
an error, a provider that closed, or a retry that puts the turn back in the queue. A turn whose
process died reports nothing.

Every 60 seconds while telemetry is on, `processUpkeep.ts` reports four gauges: `agent.processes.live`,
`agent.processes.idle` (those the idle rules would stop now), `agent.processes.idle_past_limit`, and
`agent.processes.memory` (summed resident bytes of their process trees). All but `idle_past_limit` come
from `processFootprint()`, the same numbers Settings > Storage and memory draws.
`agent.processes.idle_past_limit` counts the processes the idle rules would stop that have been idle
past your time limit for more than one five-minute sweep. A working sweep has stopped all of those, so
any value above zero means the [idle stop](./operations.md#idle-stop) missed one. It's zero while the
limit is Never. Counting memory runs `ps` through the process broker, so the
sample is skipped while telemetry is off, and the memory gauge is left out when `ps` fails.
