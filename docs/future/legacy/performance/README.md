# Desktop performance plan

Date: 2026-09-24. Status: proposal. Nothing here is built.
Evidence baseline: commit `8bf4a71b` on `james/arch-review`, read and measured on an M-series macOS
laptop with the pinned Node 24.11.0 runtime (`apps/desktop/src-tauri/binaries/node-aarch64-apple-darwin`).

This plan covers the desktop app: how fast it starts, how fast it switches between tasks and panes,
and how much work it does while you use it. The terminal client is out of scope.

The performance programme that ran from 2026-08-31 to 2026-09-03 is the starting point. Its record is
[performance.md](../../../performance.md) and the files under [docs/performance/](../../../performance/).
Read its decisions and refusals before arguing with anything here. Three weeks of work since then,
including the architecture reset on this branch, moved several of its numbers the wrong way, and one
change reversed one of its seven decisions. This plan starts from those regressions and then goes
after what that programme never measured: task switching in the real app, streaming work, and memory.

## Read in this order

1. [Measurement and guardrails](./01-measurement.md): the startup check that went blind, the checks
   that are missing, and how to time a task switch in the real window.
2. [Node boot](./02-node-boot.md): the node service is back on the path to the first useful frame,
   and inlining its dependencies takes about 245 ms off it.
3. [Renderer startup](./03-renderer-startup.md): the bytes and requests the window loads before it
   draws, and a double plugin activation.
4. [What the first frame waits for](./04-first-frame.md): the shell waits for the node before it
   draws anything, and how to stop that safely.
5. [Task switching](./05-task-switching.md): what a task switch throws away and fetches again.
6. [Panes and the agent transcript](./06-panes-and-transcripts.md): the cost of mounting and
   updating the heaviest pane.
7. [Steady state](./07-steady-state.md): work the app does while you are not doing anything, and
   while an agent streams.
8. [Memory](./08-memory.md): never measured. What grows, and what the other files would add to it.
9. [Refused alternatives](./refused.md): what not to do, and the condition that would change that.

## Where the time goes on a cold start

A cold start is four processes in a row. The numbers below are from the September record except
where a file here re-measured them.

| Step | Cost | Owner |
| --- | --- | --- |
| Rust shell starts the helper, helper prints its ready line, window opens | about 45 ms | [02](./02-node-boot.md) |
| Renderer loads its startup graph | about 195 requests, 970 KB, one extra serial hop | [03](./03-renderer-startup.md) |
| Node process spawns and evaluates its service bundle | about 345 to 380 ms, measured here | [02](./02-node-boot.md) |
| Node boots to `listener-up` | about 120 to 150 ms packaged | [02](./02-node-boot.md) |
| Shell waits for the node's first status, then mounts | everything above the node's first status | [04](./04-first-frame.md) |
| Shell mounts from the persisted cache, panes fetch | not measured in a packaged build | [01](./01-measurement.md) |

Since 2026-09-17 the shell does not draw until the node reports in, so every millisecond of node boot
is a millisecond of loader on screen. That makes the node's boot the largest startup target again.

## Suggested order of work

Each row is a unit one developer or agent can take alone. The order front-loads the fixes that are
measured, small, and reversible.

| Order | Item | Size | Why this position |
| --- | --- | --- | --- |
| 1 | [Make the startup check see the real graph](./01-measurement.md#m1-make-the-renderer-startup-check-see-the-real-graph) | Small | Every renderer change after it needs a working check. |
| 2 | [Remove the bootstrap's extra hop](./03-renderer-startup.md#r1-remove-the-serial-hop-in-front-of-the-app) | Small | Fixes 71 requests and one serial hop that landed on 2026-09-24. |
| 3 | [Inline the node's pure-JavaScript dependencies](./02-node-boot.md#n1-inline-pure-javascript-dependencies-into-the-service-bundle) | Medium | About 215 ms off every cold start, measured. |
| 4 | [Turn on Node's compile cache](./02-node-boot.md#n2-turn-on-nodes-compile-cache) | Small | About 30 ms more, measured, one environment variable. |
| 5 | [Activate client plugins once](./03-renderer-startup.md#r3-activate-client-plugins-once-when-nothing-changed) | Small | A duplicate roster fetch and a listener leak on every launch. |
| 6 | [Time a task switch in the real window](./01-measurement.md#m4-time-a-task-switch-in-the-real-window) | Small | Gives items 7 to 11 a baseline. |
| 7 | [Stop refetching a held agent snapshot](./05-task-switching.md#t2-stop-refetching-an-agent-snapshot-the-store-already-holds) | Small | Up to 2 MB fetched and parsed on every switch back to an agent task. |
| 8 | [Keep pane models for recent tasks](./05-task-switching.md#t1-keep-pane-models-for-the-last-few-tasks) | Medium | Alternating between two tasks rebuilds every model today. |
| 9 | [Index the agent roster by task](./07-steady-state.md#s1-stop-every-rail-row-rescanning-the-agent-roster-per-event) | Small | Every rail row rescans every session about 25 times a second while an agent streams. |
| 10 | [Draw the shell before the node answers](./04-first-frame.md#f1-draw-the-shell-from-the-persisted-cache-again) | Medium | Needs an owner's decision. Buys back what 2026-09-17 gave up. |
| 11 | The rest of [05](./05-task-switching.md), [06](./06-panes-and-transcripts.md), and [07](./07-steady-state.md) | Varies | Pick by what item 6 measures. |
| 12 | [Measure memory](./08-memory.md) | Small | Required before anything in 05 keeps more alive. |

## Rules for anyone working these

- Measure before and after, on the built artifact, and write both numbers into the item's file with
  the commit and the machine. The September programme found that a number taken under `tsx` was
  seven times the real one. Numbers from jsdom count calls, not milliseconds.
- Treat every claim here as dated evidence. Line references are hints. Each file ends with a
  verify-before-building list, and in September following that list found a false premise in almost
  every phase.
- Keep the process topology, the trust boundaries, and the plugin seams. None of the items here
  needs to move a boundary. If one seems to, stop and write down why.
- When an item ships, update the owning doc under `docs/` and add the numbers to
  [performance.md](../../../performance.md) under a dated heading, the way the September phases did.

## Verify before building

- Rebuild with `pnpm --filter @acorn/desktop build` and confirm the startup numbers in
  [03](./03-renderer-startup.md) still hold at your commit.
- Re-read `apps/desktop/src/client/App.tsx` for the startup gate and confirm it still waits on
  `nodeGateHolds()`.
- Confirm `apps/node/vite.config.ts` still externalises every bare import.
