# Refused: transitions that stay off the wire

Part of [docs/future/events/](./README.md). The catalogue will be asked to grow, and the argument
for each individual addition is always reasonable — that is why this file exists. Everything here
failed the admission rule in the [README](./README.md), most often test 2 (machine-scale) or test 4
(the trust sentence cannot be written honestly).

## File opened and file saved

Tempting for test runners and linters. A plugin that genuinely wants this wants a file watcher,
which its node half can run itself, without core putting the editor's inner loop on a
cross-boundary channel. The editor plugin is the standing proof this costs nothing: its only
mutation is the file write, it emits no events at all, and it does not suffer for it. (The missing
`ctx.events.status` ping after a remote save is a defect — [delivery.md](./delivery.md) defect 3 —
and an invalidation ping is not an event.)

## Terminal output, and every other owned stream

Settled by the tier rule already: PTY stream ownership does not survive message passing. The same
answer covers docker's log, stats, and exec streams, and the managed-agent transcript stream —
`agent:event` carries per-token assistant and reasoning appends, tool frames, and file-change
frames, which is the agent's inner loop, not a lifecycle. The lifecycle reduction of that stream is
the "agent session state" event in [core-events.md](./core-events.md); the stream itself stays with
its owner.

## Anything per-keystroke, per-selection, per-render, or per-agent-step

The client-side draft state in http's frame, context's selection toggles and revision bumps, and
browser's navigate/click/fill/console-line accumulation are the surveyed instances. Browser's
console capture is the sharpest: it is terminal output with a different accent.

## Machine-scale invalidation mechanics

The survey found a family of internal pings that look event-shaped and are not: docker's
`docker:changed` (fires on container health checks), github's 304 freshness bumps and viewed-file
marks, changes' stage/unstage/discard churn between commits, memory's access-count bumps, the
per-page loops inside mirror syncs, and workflows' per-step status writes. Each is a cache talking
to itself. The event, where one exists, is the completed sync or the terminal state — one frame per
human-scale outcome, emitted after the funnel point, never from inside the loop.

## Process and port lifecycle

A port manager can poll `lsof` itself; core observing it buys nothing. The carve-out is deliberate
and narrow: *declared run targets* changing state is a core event
([core-events.md](./core-events.md) § Run target state), because those are acorn's own children
tied to a task. Everything else on the machine stays the plugin's own business.

## Raw user activity

An idle or active signal. The time-tracking idea in
[integration-ideas.md](../integration-ideas.md) needs this, and it should still be refused as an
event: a general "what is the human doing right now" broadcast is the most surveillance-shaped
thing that could go on a third-party surface, and it would be added for one consumer. Core should
keep its own activity record and expose the result through `CoreServices`, the way `TaskService`
returns a projection rather than the row. Focus changed ([core-events.md](./core-events.md)) is as
close as the event surface gets, and its coarseness is the point.

## Request and query payloads

http's request-sent and database's query-ran both fail as broadcasts even at human scale, for the
same reason: the payload is the user's private data, and in http's case the response can contain
resolved secrets that are redacted on the existing path. A broadcast would need the same redaction
applied at a second point, which is a standing invitation for the two points to disagree. The
plugin-local record is the feature; see [plugin-events.md](./plugin-events.md) for the reduced
shapes that were considered and where the line sits.

## Compose up and down

Considered for docker and leaning no: another plugin can ask `docker compose ps` itself, so it
fails test 1. Task teardown made the cut instead because it is archive-coupled state another plugin
may hold references into.
