# Phase 08: agent process memory

Status: planned, October 13, 2026.

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
