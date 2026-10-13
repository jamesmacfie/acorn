# Phase 08: agent process memory

Status: landed October 13, 2026.

## Completion note

October 13, 2026. All three changes landed, with tests, in the agents plugin.

- `agent.processes.idle_past_limit` is sampled every 60 seconds beside `agent.processes.idle`, by
  `ProcessUpkeep.idlePastLimit`.
- `stopIdleSessions` makes a second pass after the time limit. It sizes each provider's process tree
  from one `ps` walk, then stops idle processes, longest idle first, until the total is at or under
  **Stop idle agents above**. The setting is `stopIdleAboveGigabytes`, with choices of 2, 4, 8, or 0
  for no limit, and a default of 4.
- The lifecycle runs the sweep after each provider start as well as every five minutes. Only one
  sweep runs at a time, so two can't both stop a process to get under the same limit.

Decisions and deviations:

- The gauge counts processes past the owner's limit by more than one sweep interval, not past the
  limit alone. Sampled every minute against a five-minute sweep, the plain rule reads above zero for
  up to five minutes after any process crosses the limit, so "zero after each sweep" couldn't be read
  from it. With the grace, any value above zero means the sweep missed a process.
- `idleCandidate` also refuses a process while a turn is being handed to it. The time limit never
  reached a freshly started process, but the memory pass treats any idle process as a candidate, and
  a sweep run right after a start could otherwise stop the process before its first turn.
- Step 1 said to read a day of the gauge before changing the sweep. An agent session can't wait a
  working day, so both landed together.
- Tests stand in for the Sentry day. `runtimeIdleStop.test.ts` checks, with a fake process table:
  three idle processes at 1 GB each against a 2 GB limit stop only the longest idle one, a process
  with an unanswered request is never stopped even when it holds the most, no limit stops nothing, a
  start triggers a sweep, and the gauge reads 0 at 34 minutes idle and 1 at 36. No memory or timing
  was measured on a real machine.
- The test driver's fake process ids moved past any real pid, because the sweep that each start runs
  reads the machine's real process table.
- The memory pass's tree sizing lives in `footprint.ts`, which loads on first use. In the static
  graph it pushed the Node service 98 bytes over its ceiling. Moved, the graph is 1,785,490 bytes
  against 1,785,500, so the ceiling stays where it was, with 10 bytes to spare.

For later phases: the Node service has almost no room under its size ceiling, so phases 06, 07, and
10 are likely to hit it at merge.

A person still needs to compare a full working day in Sentry with the
[baseline](../../testing/sentry-baseline-2026-10-13.md), and record it in a dated page under
`docs/testing/`:

- `agent.processes.idle_past_limit` stays at zero.
- `agent.processes.memory` stays under 4 GB except while every live process is busy. Compare its
  p95 and peak with 3.2 GB and 8.0 GB.
- `agent.processes.live` and `agent.processes.idle`, against 18 and 17 at peak.
- `agent.session.start` count and duration. The baseline page doesn't record this span, so compare
  with a day in Sentry from before this change. Resumes after memory stops show up here as extra
  starts. If they become common, raise the default limit.

Read the [programme page](./README.md) first. This phase needs nothing else.

## Deliverable

Acorn reports how long each idle provider process has waited, and it stops idle processes once their
total memory passes a limit, not only once each one passes the idle time limit.

## The problem

Provider processes held the most memory of anything Acorn runs. The
[Sentry baseline](../../testing/sentry-baseline-2026-10-13.md) shows `agent.processes.memory` at
682 MB on average, 3.2 GB at p95, and 8.0 GB at its peak, with 18 processes live and 17 of them idle.
For comparison, the desktop window peaked at 2.6 GB. Each process holds an agent CLI and its MCP
servers, about 450 MB, as [idle stop](../../managed-agents/operations.md#idle-stop) says.

The idle stop runs every five minutes and stops a process that has been idle past your limit, 30
minutes by default. That rule bounds time, not memory. Open 15 sessions in an hour, prompt each once,
and they all live for 30 minutes after their last turn, whatever they hold.

The telemetry can't say whether the sweep is working. `agent.processes.idle` in
`plugins/agents/src/server/sessions/processUpkeep.ts` counts processes with nothing running inside
them right now, because `processFootprint` passes `now` as the idle start. It doesn't count the ones
past the limit, so 17 idle processes could be 17 processes idle for a minute each.

## Change

1. Add a gauge `agent.processes.idle_past_limit` beside `agent.processes.idle`, using the owner's
   limit as the idle start, the same rule `stopIdleSessions` uses. If it's ever above zero after a
   sweep, the sweep has a bug.
2. Add a memory limit to the sweep. When `agent.processes.memory` is above the limit, stop idle
   processes in order of longest idle until the total is under it. Use the rules `stoppableIdle`
   already checks, so a turn, a pending request, or a background subagent keeps its process. Start
   at 4 GB and make it a choice beside **Stop idle agents after**.
3. Run the sweep when a process starts, as well as every five minutes. Opening many sessions is when
   the total climbs.

A stopped session resumes on its next prompt through `session/load` or `thread/resume`, so a stop
costs a slower first reply, not lost work. That's why a memory limit is safe to apply to idle
processes.

## Implementation steps

1. Add the gauge, and read a day of data before you change the sweep.
2. Add the memory limit to `stopIdleSessions`, with the processes sorted by idle time.
3. Add the choice to the agent session defaults in `plugins/agents/src/shared/sessionDefaults.ts`
   and to Settings.
4. Add tests beside `processUpkeep.ts`: a total over the limit stops the longest idle first, and a
   process with a pending request is never stopped.
5. Update [idle stop](../../managed-agents/operations.md#idle-stop) and the gauge list in
   [session events](../../managed-agents/session-events.md).

## Acceptance

- `agent.processes.idle_past_limit` stays at zero after each sweep over a working day.
- `agent.processes.memory` stays under the limit except while every live process is busy.

## Risk

A process stopped for memory resumes on the next prompt, and that first reply takes as long as a
cold start. Measure `agent.session.start` before and after, and raise the default limit if resumes
become common.
