# Session revisit check, October 13, 2026

This page records the measurements behind UI performance phase 04, session revisit.
Every number here comes from jsdom, not from the real window. An agent-launched desktop window is
always hidden, so the `session-revisit` flow wasn't run. jsdom builds the same DOM and runs the same
JavaScript in V8, but it doesn't lay out or paint, and the desktop runs WebKit's JavaScriptCore. Read
the numbers as shares of the work, not as what a person sees.

In jsdom, a return to the canonical session took 63 to 67 ms. Folding its 7,011 events was about
3 ms of that, and keeping the projection in the store removed it. Parsing the Markdown of the drawn
page was about 0.15 ms, so the parsed-Markdown cache wasn't built. Almost all of a return is
mounting the newest 200 cards and disposing the session you left.

## Machine and run

- Host: macOS on an Apple M2 Pro, Node v24.11.0, at base `487855a53`.
- Data: the large-surface fixture's `canonical` and `small` sessions, seed 1, written through the
  agents plugin's own store and read back with `exportSnapshot`. The canonical session has 7,011
  events and draws as 3,344 cards.
- Method: a throwaway `.test.tsx` mounted the real `AgentConversation`, with the real transcript,
  cards, and Markdown, and with the composer, the queue, and the Node API mocked. Both snapshots were
  loaded into the store first. The test switched the selected session from canonical to small and
  back 12 times. It timed each switch from the signal write to the end of the synchronous render,
  which is when the new page's cards exist, then let one macrotask run. The first two rounds warmed
  up and weren't counted, which leaves 10 timed returns each way.
- After a return, the page held 200 cards, 2,147 elements, and 82 Markdown blocks.
- The same test also timed a fresh fold over the canonical events, and `renderBlocks` over the text
  of every message on the drawn page: 66 messages, 4,876 characters.
- Order: base, candidate, candidate, base. The candidate is step 1 of the phase, the projection kept
  in the store.

## Results

Median of 10 returns per run:

| Run | Build | Return to canonical | Return to small |
| --- | --- | ---: | ---: |
| 1 | Base | 66.4 ms | 49.4 ms |
| 2 | Candidate | 62.9 ms | 50.4 ms |
| 3 | Candidate | 62.7 ms | 49.9 ms |
| 4 | Base | 67.6 ms | 49.0 ms |

The two base runs differ by 1.2 ms and the two candidate runs by 0.2 ms. The candidate is about 4 ms
faster on the canonical return. A fresh fold of the canonical events took 2.7 to 3.5 ms across runs,
which accounts for the difference. The small session's return didn't change, because its fold is a
few hundred events.

Parsing the drawn page's Markdown took 0.14 to 0.18 ms across runs. That's the most a cache of
parsed Markdown could save on this return, about 0.2% of it. Phase 03 measured the parse at about
16 microseconds per KB in Node, so a page with 200 KB of message text would parse in about 3 ms.
That's still small next to mounting the cards, and a parse cache doesn't save the mount.

## Memory

With `--expose-gc`, four canonical snapshots parsed from JSON held about 4.2 MB of heap each. A
projection folded over one held about 1.3 MB more. The store keeps the snapshots on screen and the
three viewed last. A mounted transcript already holds its projection, so keeping projections adds
at most three: about 3.8 MB in the worst case, when all three are canonical-sized. That is about 22%
of what the store's events hold in that case, and under 2% of the roughly 250 MB heap of the jsdom
process that ran the test. Whether it stays within 10% of the real renderer's memory after eight
sessions needs the real-window check below.

## Measurements still required

A person needs to run these in a visible window.

1. Start the large-surface fixture at the canonical profile, with telemetry on:

   ```sh
   pnpm dev:agent -- --session revisit --fixture large-surfaces --profile canonical --telemetry on --vite
   ```

2. In the window's web inspector, run `localStorage.setItem('acorn.perf', '1')` and reload, so
   spans reach the performance timeline.
3. Run the flow twice:

   ```sh
   pnpm dev:agent:ui -- --session revisit flow session-revisit
   ```

4. From each report in the session's `reports/` folder, list the `acorn:agents.session.open` spans
   from the `revisit` stage. Record the median and the largest for returns to the canonical session
   and to the small one. The span starts when the session is selected and ends after its read and
   the next paint. The flow's own `wait` times start after the click returns, so they leave out the
   render that happens inside the click.
5. For the base build, check out `487855a53`'s copies of
   `plugins/agents/src/client/sessions/managedStore.ts` and
   `plugins/agents/src/client/sessions/AgentTranscript.tsx`, let Vite reload, and run the flow
   again. Run base, candidate, candidate, base, and restore the files afterward.
6. Check the `long-session-back` checkpoint's health: it should show 200 mounted turns and
   **Show earlier (3,144)**, as the jsdom run did.
7. For memory, open eight real sessions in turn in one window, then read the WebKit content
   process's memory in Activity Monitor. Do it on each build and compare.

If a canonical return is well above 100 ms in the real window, check what the span spends before
building anything else. The fold and the Markdown parse together were about 5% of a jsdom return.
