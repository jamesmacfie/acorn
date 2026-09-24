# Refused alternatives

Date: 2026-09-24. [Back to the plan](./README.md).

What this plan decided not to propose, and the condition that would change the answer. The
September programme's own refusals still stand, with their exit conditions, in
[what-was-measured-this-time.md](../../../performance/what-was-measured-this-time.md) § What was
refused. Read those first: the process topology, the transcript virtualizer, per-plugin node chunks,
the `503`-until-ready node contract, the filesystem watcher, and the incremental transcript
projection are all settled there.

## Keeping the node running after the window closes

A node that survives quit would make every launch after the first skip node boot entirely. It
reverses the rule in [shell.md](../../../shell.md) § Node child that nothing outlives its supervisor,
which exists because a surviving node holds the data-root lock and makes the next launch fail. It also
changes what quitting means to a person: agents and terminals would keep running with no window.

Revisit if node boot is still over about 300 ms after [02](./02-node-boot.md), and only as a
deliberate product decision about background running, not as a speed fix.

## A virtualizer for the agent transcript

Still refused, for the reason in [managed-agents.md](../../../managed-agents.md): `measure()` churn
made output flash and become unselectable. [P1](./06-panes-and-transcripts.md#p1-skip-layout-and-paint-for-cards-off-screen)
gets the layout and paint saving from CSS without measuring anything. Revisit only if P1 ships and a
transcript mount is still over about 200 ms, and start from the removal commit.

## A hidden task view per task

Refused as the default. [panes.md](../../../panes.md) records why `keepAlive` was deleted. A hidden
view one task deep is proposed as the last item in [05](./05-task-switching.md), gated on a
measurement after the cheaper items and on the memory numbers in [08](./08-memory.md). Keeping more
than one task's view alive stays refused, because the memory grows with every task a person visits
and nothing in the app would bound it.

## Replacing Zod in the renderer

Zod is 73 KB of the renderer's startup set, and `zod/mini` would be smaller. The schemas live in
`packages/protocol` and the node shares them, so switching touches both runtimes for a gain nobody
has measured in parse time. Revisit if a packaged first-paint measurement puts script evaluation at
the top of the renderer's startup cost.

## Removing base64 from the helper wire

Still parked for the September reason: no request or response body has come close to the size that
would make it matter. The largest measured body is the agent snapshot at about 2.1 MB, and
[T2](./05-task-switching.md#t2-stop-refetching-an-agent-snapshot-the-store-already-holds) removes most
of those requests instead. The exit condition is unchanged: a `[perf:request]` line over about ten
megabytes.

## Per-key query persistence

Refused in September because the whole cache stringifies in 2.4 ms. Revisit only if
[F2](./04-first-frame.md#f2-measure-the-cache-restore-before-touching-it) finds the IndexedDB read in
front of the first frame over about 30 ms.
