# Phase 9: draw before every read finishes

Date: October 21, 2026. Status: proposed. Build after phase 2, and measure each part again first.

Several panes wait for every read before they draw, or read things one after another that could run
together. Phase 2 removes the queue waits in front of many of these, so measure each part again
before you build it. Read [the programme](./README.md) first.

## Starting point

Measured from October 14 to 21:

| Open | p50 | p95 |
| --- | --- | --- |
| Agent pane, first open | 1.5 s | 12.1 s |
| Editor, first open | not read | 8.8 s |
| Pull request pane, first open | not read | 7.8 s |
| `renderer.startup.usable`, visible | 1.8 to 2.7 s | 5.4 to 6 s |
| `/v1/core/dashboards`, from the renderer | 207 ms | 5.5 s at p90 |
| `/v1/p/agents/usage`, on the Node | 8.4 s | 10.3 s |

What each one waits on, from reading the code:

- **Agent pane.** `pageToEnd` in `plugins/agents/src/client/sessions/managedStore.ts` pages a
  transcript forward 2,000 rows at a time until the last event before it draws. `KEEP_RECENT` is
  three, while pane models stay for five tasks, so the fourth task back reads its transcript again.
  The pane shows "Start a managed coding session" while the session list loads
  (`plugins/agents/src/client/sessions/agentPaneModel.ts`).
- **Dashboards.** `SourceSurface.tsx` holds the page in one `Suspense`, and `PanelGridItem.tsx` has no
  boundary of its own, so one slow panel holds every panel. On the Node,
  `packages/node-core/src/server/dashboards/run.ts` reads a panel's sources one after another.
- **Editor.** `plugins/editor/src/client/editorController.ts` revalidates pooled text before it draws.
  `FileTree.tsx` restores open folders one level per round trip.
- **Composer.** Submit fetches the task context again (`submitOperation.ts`), and the message shows
  only after the POST and a snapshot reload. `durableEventBuffer.ts` on the Node holds the first text
  chunk of every reply for 40 ms.
- **Cold sessions.** `providerSessionLifecycle.ts` prepares the account home, MCP servers, skills,
  and hooks one after another. `queueCoordinator.ts` awaits each cold start inside a pass shared by
  the whole Node, so one cold start delays other sessions' turns.
- **Launch.** `App.tsx` waits for a prefs read from this launch before it restores. Over the week,
  `/v1/core/prefs` took 612 ms at the median from the renderer.
- **Usage.** `/v1/p/agents/usage` waits for a full refresh when its cache is older than 5 minutes,
  and the client polls every 5 minutes, so most polls wait.

## Changes

1. Read the newest page of a transcript first and draw it. Load older pages when the reader scrolls
   up. Set `KEEP_RECENT` to five. Show a busy state, not the empty state, while the session list loads.
2. Give each dashboard panel its own `Suspense`, and run a panel's sources with `Promise.all`.
3. Draw the editor's pooled text, then revalidate. Restore the file tree's open folders in one read.
4. Reuse the prefetched task context on submit, and put the turn in the transcript from the POST's
   answer. Send the first chunk of a reply at once, and batch the rest.
5. Run the cold-start preparation steps together, and don't await a cold start inside the shared
   queue pass.
6. Restore from the cached prefs at once, and correct the landing if the Node's answer differs.
7. Answer `/v1/p/agents/usage` from its last snapshot, and refresh in the background through the
   `usage-refreshed` event.

## Tests

- An Agent pane over a 20,000-event session draws after one page read.
- A dashboard with one panel that never answers draws its other panels.
- A sent prompt shows in the transcript before the snapshot reload.
- A usage read with a stale cache answers at once and raises `usage-refreshed` later.

## Acceptance

- Agent pane first open p95 under 3 s, editor under 3 s, over a working week.
- `/v1/p/agents/usage` p95 under 250 ms on the Node.
- `renderer.startup.usable` p50 back to 1.3 s or less on visible launches.
- [The transcript](../../managed-agents/transcript.md) and [dashboards](../../dashboards.md) document
  the drawing order.
