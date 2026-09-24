# Memory

Date: 2026-09-24. Status: proposal. Nothing here has been measured. [Back to the plan](./README.md).

The September record ends with "Memory, anywhere" on its list of things nobody measured. Four of its
phases traded memory for time and none weighed it. This plan adds more trades in
[05](./05-task-switching.md): models for three tasks, terminal surfaces for two, and possibly a
hidden task view. Measure before any of those ship, so the trade is a number rather than a guess.

## What grows, and what bounds it today

| What | Where | What bounds it |
| --- | --- | --- |
| Agent snapshots | `managedAgentStore.snapshots` in `plugins/agents/src/client/sessions/managedStore.ts` | Nothing while the app runs. Every session opened stays until it is deleted or the node is switched. The largest first page on record is 2.1 MB of JSON. |
| Agent roster | `managedAgentStore.sessions` | Every non-archived session on the node, loaded at startup by `loadAll`. |
| xterm instances | `TerminalSurface.tsx`, one per open tab of the active task | Tabs the person opened. Each holds a scrollback buffer and a WebGL context. |
| Editor documents | the editor's pane model | Files opened in the task, until the task is left. |
| Pane models | `paneModels.ts` | One task per pane. [T1](./05-task-switching.md#t1-keep-pane-models-for-the-last-few-tasks) makes it three. |
| Highlighted code | `htmlCache` in `client-core/src/infra/highlight/shiki.ts` | Its own size limit. |
| Query cache | the per-node `QueryClient` | `gcTime` for unmounted queries. About 1 MB persisted after months of use. |
| Diff tokens | the diff pane | Every token carries light and dark colours, which the September record accepted. |

## W1: Take one baseline

**Change.** On a data root with a real week of work, take a Web Inspector heap snapshot of the
renderer at each of these points and record the total and the top retainers:

1. Right after launch, with the shell drawn.
2. After opening five tasks with agent sessions, one after another.
3. After an hour of normal use with two agents streaming.
4. After closing every task view and waiting a minute.

Also record the helper's and the node's resident memory from Activity Monitor at the same points. The
node's matters too: it holds a headless emulator for each watched terminal.

Put the table here with the machine, the commit, and the data root's size.

**What to look for.** Growth between points 3 and 4 that does not come back is a leak. The
`activate` leak in [R3](./03-renderer-startup.md#r3-activate-client-plugins-once-when-nothing-changed)
is one known source. The agent snapshot store is the most likely large retainer.

## W2: Bound the agent snapshot store

**Change, after W1.** Keep full snapshots for the sessions on screen and the few most recently shown,
and drop the rest. A dropped session keeps its row in the roster, so the rail and the Agent Center
still draw it, and opening it fetches the snapshot again. Pick the count from W1. Five is a
reasonable first guess.

The socket keeps appending to held snapshots, which is what makes
[T2](./05-task-switching.md#t2-stop-refetching-an-agent-snapshot-the-store-already-holds) possible. A
dropped snapshot stops receiving appends, and T2's rule already covers it, because a session with no
held snapshot is fetched.

## W3: Weigh each keep-alive before it ships

Each item in [05](./05-task-switching.md) that keeps more alive states its memory cost in its done-when
line:

- T1: three tasks of pane models, measured as the difference between point 2 in W1 before and after.
- T3: the previous task's xterms. Each holds its scrollback and a WebGL context. Count the contexts as
  well as the bytes, because WebKit caps them.
- T8, if it is ever built: one hidden task view, measured the same way.

If a keep-alive costs more than about 50 MB on the W1 data root, it needs a smaller bound or a
different design.

## Verify before building

- Confirm the snapshot store has no eviction beyond `removeSession` and `clear`.
- Confirm Web Inspector can attach to the release renderer. If it cannot, take W1 in a development
  build and say so.
