# Phase 4: give the window first claim on the CPU

Date: October 21, 2026. Status: proposed. Needs phase 1's loaded baseline.

When the machine is busy, the window's frame gaps grow about 25-fold, and every agent, build, and
`git status` competes with it as an equal. Nothing in the repository sets a process priority. This
phase lowers the priority of work nobody is waiting on, so the window and the Node keep their share.
Read [the programme](./README.md) first.

## Starting point

- A search for `setPriority`, `nice`, `taskpolicy`, and QoS finds nothing. The shell, the helper, the
  Node, and every child run at the default priority.
- From October 14 to 21, the one-minute load was above 12, the CPU count, in 17.7% of Node samples.
  In the busiest hours `agent.processes.live` had a p50 of five, and windows with a frame gap over
  250 ms rose from 0.1% to 2.4%.
- Agents start in `plugins/agents/src/server/processes/ownedProcess.ts` and
  `plugins/agents/src/server/drivers/jsonRpcProcess.ts`. Git, task scripts, and polls run through
  `runProcess` in `packages/node-core/src/server/core/proc.ts`. A child inherits its parent's priority,
  so an agent's builds and tests run at the agent's.

## Changes

1. After an agent process spawns, call `os.setPriority(child.pid, 5)`. Everything the agent starts
   inherits it.
2. Give `runProcess` a `priority: 'interactive' | 'background'` option. Background lowers the child to
   10. Mark task setup and teardown scripts, Docker polls, `git fetch` outside a user action, and the
   data-source and trigger reads as background. Leave the default as interactive, so a Git read the
   user waits on keeps its priority.
3. Leave terminal sessions alone. A person typing in one expects it to keep pace.
4. Keep the shell, the helper, and the Node at the default. The Node's loop answers the window.

On macOS, a nice value lowers CPU share but not disk or memory priority. Don't use `taskpolicy -b`. It
also throttles disk access and would make an agent's builds much slower. If the loaded replay shows
nice values aren't enough, try `taskpolicy -c utility` on agents as a separate, measured change.

On Linux and Windows, `os.setPriority` maps to the platform's own levels. Catch and log its failure
once, because a container may refuse it.

## Tests

- An agent process started by the test driver reports a nice value of five through `os.getPriority`.
- `runProcess` with `priority: 'background'` starts a child at 10, and the default starts one at zero.

## Acceptance

- Phase 1's replay with `--load` and the `agents` fixture: frame gap p95 and max fall, and the agent
  turn's wall time rises by no more than 10%. Record both.
- A working week in Sentry: windows with a frame gap over 250 ms while the load is above the CPU count
  fall from 2.4%.
- [Process startup and teardown](../../managed-agents/operations.md#process-startup-and-teardown)
  documents the agent priority, and `runProcess`'s doc comment names the two options.
