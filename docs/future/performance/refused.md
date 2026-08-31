# Performance: refused

What this programme decided not to do, and why, so a later session argues with the reasoning rather
than with silence. Dated 2026-08-31 with the rest of the folder.

## Row patching instead of coarse `<noun>:changed` invalidation

The content-free event with a whole-route refetch is a deliberate design: a payload is a second
projection to keep in step, and `watchConnectionChanges` documents a concrete case where a patch
would leave the rest of the projection stale (the list route synthesizes rows the event cannot
carry). The observed pain is not the coarseness, it is the `term:status` amplifier, which phase 2
fixes without touching the model. Revisit only if instrumented refetch volume stays high after that.

## A general topic or subscription model on `/v2/events`

`docs/future/events.md` records the broadcast ceiling knowingly. A per-connection interest registry
is real machinery with its own failure modes, and the two concrete costs found in the trace, the
`term:status` fan-out and the helper forwarding non-active nodes, are both fixable at their source
in phase 2. The model stays refused until a measurement on a real multi-node fleet demands it.

## Splitting the node into worker threads or multiple processes

The single loop carries synchronous SQLite, terminal emulation, and git spawns, and no measurement
says any of them is the problem. Phase 3 removes the largest unconditional load (emulating unwatched
sessions) and phase 0 adds the histograms that would justify a split. Process architecture is a
one-way door; do not walk through it on a structural argument.

## Dropping unreferenced icons at build time

68 of 1,756 names appear as literals in the tree, but a user can assign any icon to a task and a
plugin manifest can name any one, and both choices are persisted. A build-time census breaks stored
data. The split in phase 0 (eager 68, lazy rest) gets the bytes without the breakage.

## Rebuilding the transcript virtualizer

Removed on purpose: `measure()` churn made output flash and become unselectable, and
`docs/managed-agents.md` owns that record. The rebuild-everything projection is what made it
thrash, so phase 4's fixes come first, and any revisit starts by reading the removal commit.

## Single-theme diff tokens

Every token carries `light` and `dark` so a theme switch costs nothing. That is roughly double the
token memory a large diff needs, and it stays that way until a real diff's memory is the complaint,
because the switch being free is a property people notice.

## Replacing base64 on the helper wire ahead of a measurement

`wire.ts` names its own ceiling and its own upgrade (an id-tagged binary frame beside the JSON
reply), and nothing but terminal output is likely to reach it. Phase 3 moves `term:out` to binary
frames because that path is measured in frames per second; request and response bodies stay JSON
until a body shows up in the phase 0 numbers.

## Scrollback beyond the ring after phase 3

Gating the headless emulator on attached sinks means a cold attach rebuilds the screen from the
256 KB raw ring, so history older than the ring is gone and an alternate-screen app whose state
depends on older bytes redraws from its next output. That is the accepted price for not running a
parser per session forever. If a session class appears where full history matters, the answer is a
bigger ring for that class, not a return to always-on emulation.
