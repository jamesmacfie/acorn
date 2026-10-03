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

Three plugin events describe the durable model:

- `plugin:agents:turn-changed` carries the task, session, turn, source, status, and attempt after a
  turn is queued, dispatched, retried, settled, or repaired at restart.
- `plugin:agents:request-changed` carries the task, session, provider request ID, kind, and status
  after a request is created, claimed, acknowledged, expired, cleaned up, or repaired.
- `plugin:agents:sessions-changed` carries task and session IDs, presence and archive state, and a
  `changes` array of `created`, `renamed`, `archived`, `restored`, or `deleted`. A rename also
  carries `renameSource`, `generated` or `user`. Titles stay out of the payload.

The store and repository send these after the commit, not each route on its own. Node consumers
rebuild state through the task-scoped `agents.turns`, `agents.requests`, and `agents.sessions`
capabilities. Turn reads leave out the prompt, the effective policy, errors, and transcript content,
and request resolution stays private to the runtime. Core's `agent-session:changed` is the generic
completion and attention event, and `agent:*` is the transcript stream.

The fallback title, a generated title, and a rename all go through the repository's one title write,
which also publishes the `agent:session` frame clients use to update their cache.

## What a session reports

Starting a provider raises an `agent.session` span, and dispatching a turn raises an `agent.turn`
span, both through `ctx.telemetry` ([ambient attribution](../telemetry/runtimes.md#ambient-attribution)).
The session span carries the session ID, the provider, and whether it reconnected. The turn span
carries the turn ID, session ID, provider, and source. Neither carries a prompt, a result, or a
transcript.

The session span covers spawning or reconnecting the provider and nothing more, because a session
outlives its process and a span over its life couldn't close. The turn span opens at dispatch, not at
enqueue, because a turn can wait minutes behind the concurrency limit. It closes on a completed turn,
an error, a provider that closed, or a retry that puts the turn back in the queue. A turn whose
process died reports nothing.

Every 60 seconds while telemetry is on, the engine reports three gauges: `agent.processes.live`,
`agent.processes.idle` (those the idle rules would stop now), and `agent.processes.memory` (summed
resident bytes of their process trees). They come from `processFootprint()`, the same numbers
Settings > Storage and memory draws. Counting memory runs `ps` through the process broker, so the
sample is skipped while telemetry is off, and the memory gauge is left out when `ps` fails.
