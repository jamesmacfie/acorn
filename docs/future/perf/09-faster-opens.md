# Phase 9: draw before every read finishes

## Completion note

Landed October 22, 2026, on branch `phase-9-faster-opens`. Four of the seven changes are built in full and
one in part, with tests and docs. Two changes and the biggest part of a third are left, for the reasons
below. None of the acceptance numbers are taken. They need a working week of Sentry and the owner's
visible window.

I didn't measure each part again first, because there's no Sentry here. I read the code for each one
instead, and built what the code still shows waiting.

What landed:

- **Agent pane (change 1, in part).** `KEEP_RECENT` is five, so it matches the five kept pane models. While
  the task's session list loads, the pane shows a busy line, not the start cards (`AgentPane.tsx`). The
  transcript tests that pinned three now pin five.
- **Dashboards (change 2).** `PanelGridItem` puts each published panel in its own `Suspense`, with the
  title and a busy line as the fallback. `runDashboard` starts every source's read together and settles
  them in plan order, so problems and budgets come out as before.
- **Editor (change 3).** `show()` draws the pooled text, then checks the disk. The file tree reads every
  remembered open folder that shows in one round trip, and leaves those under a collapsed parent alone.
- **Composer (change 4).** Submit reuses the task context it already captured for the same key
  (`automaticCapturedKey`). The queued turn goes into the store from the POST's answer
  (`managedAgentStore.upsertTurn`). The Node commits the first chunk of each message at once and batches
  the rest (`durableEventBuffer.ts`).
- **Cold start (change 5, in part).** `providerSessionLifecycle.ts` reads the task root, workspace, history,
  read-block setting, account home, skills, and hooks together. It then prepares the MCP servers and the
  read-block guard together.
- **Usage (change 7).** `/v1/p/agents/usage` answers a snapshot past its five-minute age at once and
  refreshes behind it, which raises `usage-refreshed`. Only the first read after the Node starts, and a
  forced refresh, wait for a probe.
- The dashboards, editor, transcript store, providers, and operations pages describe the new order.

Decisions and deviations:

1. **The paged transcript is not built.** The doc asks for the newest page first and older pages on scroll.
   The snapshot route returns the oldest events, and the client's projection, tool-call folding,
   `completeThrough` mark, and the **Show earlier** window all assume the events run from the start.
   [The transcript](../../managed-agents/transcript.md) also says the projection stays whole. A tail read
   would leave tool cards whose opening row is missing, wrong card counts, and a prepend that shifts the
   scroll when the older pages arrive. That's a design of its own, bigger than this phase, and it is the
   change most likely to move the 12 s open. It needs an owner's call on how an incomplete projection
   should look.
2. **The queue pass still waits for a cold start.** I read the coordinator and left it. Moving the wait off
   the pass means a started session counts against the limits from the moment it is admitted, and a start
   that fails must free its slot and wake blocked turns. `failedStarts` lives for one scan, and a failed
   start leaves its turn queued, so waking the queue after a failure would retry the same start in a loop.
   It needs a memory of failed starts that outlives a scan. The parallel preparation above shortens the
   wait for everyone meanwhile.
3. **The launch restore still waits for the Node's prefs.** `prefsSettled` exists because the persisted
   cache is up to five seconds old, and a restore from it opened the wrong place after a quick quit.
   Restoring from the cache means hydrating every persisted slice twice, against live input, with write
   guards armed from the stale copy. After phase 2, the prefs read no longer queues behind slow reads, so
   what's left is one round trip. Measure `renderer.startup.usable` first, then decide.
4. **The file tree uses parallel reads, not a new route.** The doc says "one read". The open set is known
   on the client, so asking for all of it at once costs one round trip without a route, a bridge method,
   the route golden list, or an API page.
5. **The cold-start steps overlap in the trace.** The `agent.session.phase` spans for `task.root`,
   `workspace.read`, and `history.read` now run side by side and end in any order, so their sum no longer
   equals the time before `mcp.prepare`. A step fails only after every step in its group has settled
   (`settleAll`), so the skill folder and MCP relays that a step built reach the cleanup. Two telemetry
   tests were reordered to match.
6. **The dashboard run's describe loop is still sequential.** It resolves and describes each source one
   by one, which is local work. The reads, which cross to plugins, are the ones that moved. No Node test
   proves the reads overlap: a two-source plan needs real registered sources, and the existing
   dashboard and data-source tests all pass.
7. **The first-chunk change adds one commit per message.** A reply's first chunk is now its own write.
   A flush a caller asks for ends the stream, so the next delta counts as a first chunk again. The timer's
   flush doesn't.
8. **The sent prompt shows from the POST's answer as a queued turn.** The transcript's message itself is a
   `user_message` event that the Node records when it dispatches the turn. Nothing here moves that.

What later phases need to know:

- A new editor mount reads the remembered file beside the root, even when the kept state doesn't need
  it, and the revalidate then reads it again. Reusing the warmed read in `revalidate` would save one
  read per remount. I left it.
- The site pages that cite the changed docs (the usage, editor, and dashboards pages) still say what's
  true, so I didn't mark them.
- Phase 10 compares `agent.session.phase` per phase, not as a sum.
- The Node service budget measures 1,933,400 B against a 1,934,100 B ceiling. Phase 8 measured 1,932,991 B.

Not taken, for the owner:

- Agent pane first open under 3 s, editor first open under 3 s, `/v1/p/agents/usage` p95 under 250 ms on
  the Node, and `renderer.startup.usable` at 1.3 s or less all need a working week of Sentry. The pane
  number won't move much until the paged transcript is built.
- The new dashboard, editor, and composer paths need a look in a visible window.

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
