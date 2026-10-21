# Phase 3: panel cards in the sidebar

Date: October 21, 2026. Status: done. Needs phases 1 and 2.

## Completion note

Landed on October 21, 2026, on the `phase-3-panel-cards` branch.

What landed:

- The route. `GET /sessions/:sessionId/tools/:toolId` in the agents plugin answers
  `{ tool, turnId, taskId }`, behind `ownsSessionUnlessSearch`, and 404 for a call the session
  doesn't have. `readToolCall` in `server/sessions/toolCallRead.ts` reads the call's rows by ID and
  folds every one of them with `mergeToolCall`, then projects the status with `commandStatus`, as the
  client reads do. The store loads the module lazily. Migration 0021 adds
  `agent_events_session_tool_idx`, a partial index on the session and the tool ID over tool rows.
- The bridge. `panel.run` in `extensionBridge.ts` takes `nodeId`, `sessionId`, `toolId`, and
  `viewerZone`. `runShownPanel` in the host's `bridge.ts` reads the call, refuses with `not_found`,
  finds the workspace from the task and project lists, and runs the plan as a draft in `execution`
  mode with `read: true`.
- The card's line carries `panelId` and `shownAt` from the result, so the sidebar can collapse an
  older version before either card runs. `CardLine` carries `toolId`.
- The sidebar. `PanelCard.tsx` loads with `lazy` from `Conversation.tsx`. It draws `RunPanel` in
  `CardFrame`, provides `PanelViewHostContext` with `openLink` only, and runs on visibility,
  **Refresh**, hints, and reconnects. `CardLineItem` keeps the phase 1 line as the loading state and
  the older-host fallback, and owns the collapse with **Show** and **Hide this version**.
- The background answers a port named `sidebar` only when its sender's address is the sidebar page.
- Docs: native messaging, the conversation view, dashboards, the plugin route reference, the
  transcript store, the extension's overview, and security. The site page "Talk to an agent from the
  browser" too, marked checked.
- Tests: checkpoints 1 to 3 as written, plus the index's query plan, the background's sender check,
  row presses, a failed refresh, and the hint coalescing.

Decisions and deviations:

- drizzle-kit splits an index expression at its commas, so the index and its query use
  `event_json ->> '$.tool.id'` rather than `json_extract`. SQLite uses the index only when the
  query repeats the expression exactly. A test checks the query plan.
- The protocol package can't import dashboards-core, so `panel.run`'s `run` is typed `unknown`.
  The sidebar casts it to `DashboardRun` in one place. The host checks only that it has a `rows`
  array.
- A plan that no longer validates is `not_found` too, with its own message. `bad_request` means an
  older host, so the card would wrongly ask for a CLI update.
- The run's reply cap is `NATIVE_REPLY_MAX_CHARS` less the plan's length, because the reply carries
  both.
- Requirement 10's row menu. Phase 3 passes no `onButton`, so the views draw no row menu. A row whose
  press opens something in Acorn says "That row opens in Acorn." with **Open in Acorn** above the
  panel instead. `rowDestination` in `PanelCard.tsx` follows the desktop's press rules, where an
  address always opens in a tab. A risky `openUrl` row action goes to Acorn, because the desktop
  confirms it. `runNodeAction`, `surfaceAction`, and `createTask` leave the row unpressable.
- Rows the agent supplied never change, so a hint doesn't rerun them and the card has no **Refresh**,
  as on the desktop. A source that couldn't answer keeps the last good run on screen, greyed out, as
  `PublishedDashboardPanel` does. The run's problems show as warnings with `planPartLabel`, because
  `describeSourceFailure` imports `infra/`.
- With a failed first run, the card draws only the reason. `RunPanel`'s failed state says "Edit the
  panel to repair…", which the sidebar can't do.
- The card stacks `RunPanel`'s parts in a `Stack`, because the origin line and the description
  otherwise run together. The composer gets `z-index: var(--z-sticky)`, because a table's sticky
  head cells painted over it.
- Verify before building. The desktop sends no `evaluationTime` for a plan, so neither does the host.
  The ledger keeps a call as its opener and its latest state (`ledgerFold.ts`), but the read folds
  every row, which also covers an uncompacted ledger. The background checked the port's name only.
  It checks the sender now, because content scripts it injects can open a port too.

Checks:

- Supplied rows. A plan with 256 KiB of supplied rows (3,474 rows) runs in 27 ms. The reply is
  2,131,835 characters: 262,444 for `plan` and 1,869,375 for `run`. That's 9 chunks, far under the
  16 Mi character limit. Dropping rows from `plan` would save 12%, so `plan` keeps them.
- Checkpoint 4 ran without a live agent. A seed script wrote four `panel_show` calls over supplied
  forecast rows into a `pnpm dev:extension` session's Node: a bar chart, a table, a stat, and a
  changed bar chart with the first chart's panel ID. All three drew, and the first chart collapsed to
  "Warmest hour by day. Replaced by a newer version." with **Show**. A link cell opened its address
  in a new tab. The host logs no operations, so a counter in the sidebar page wrapped
  `chrome.runtime.connect` instead. At 400 pixels high, a reload ran only the two cards in view.
  Scrolling to the top ran the table once, and holding there 10 seconds sent nothing. Scrolling to
  the bottom ran the chart once, and holding there sent nothing. Supplied rows don't rerun on a hint,
  so a hint-driven rerun was checked in `PanelCard.test.tsx` only.
- Sizes. The sidebar's first load went from 368,488 B to 373,320 B of JavaScript, 113,161 B to
  116,082 B gzipped. `PanelCard`'s chunk is 48,571 B, 15,736 B gzipped, with 15.9 kB of CSS, and loads
  with the first card. The Node service measured 1,915,624 B, under the 1,917,500 B ceiling, from
  1,915,111 B after phase 2.

For later phases:

- Phase 5 turns actions on in `PanelCard`. It can pass `onButton` and its row menu's handler to
  `RunPanel`, and replace the "That row opens in Acorn." notice for actions that become runnable.
  `rowDestination` is the place a press is decided.
- `panel.run` names the call. `row.act` can read the plan through the same route, with
  `readToolCall`'s fold.
- The site pages that cite `browser-extension.md`, `security.md`, and `dashboards.md` make no claim
  this phase changed, so only the conversation page was updated.

## Goal

An agent's `panel_show` call draws as a live panel in the sidebar's conversation, with the dashboard's
own views. The card is read only: it opens links but runs no row actions, places nothing, and edits
nothing.

## What the person gets

- The phase 1 line grows into a card: the title, the run's description, and the panel itself, capped
  at 480 pixels with **Expand**, as in the desktop.
- The card runs its plan when it comes into view, and again on **Refresh**. A card scrolled out of
  view doesn't run.
- A newer version of the same panel collapses the older card to one line with **Show**, as in the
  desktop.
- A link cell opens in a new tab. A row whose press would open something in Acorn offers **Open in
  Acorn** instead.
- **Open in Acorn** at the card's header opens the conversation in the desktop, where **Add to
  dashboard** and **Edit in studio** are.

## Starting point

- The desktop card, `PanelToolCard`, runs the plan from the call's input through
  `POST /v1/core/dashboards/run` with `target: { kind: 'draft', content: plan }`, `mode: 'execution'`,
  the viewer's time zone, and `scope: { workspaceId }`, where the workspace is the task's project's.
- The plan is only in the call. `panel_show` stores nothing on the Node
  (`packages/node-core/src/server/agentTools/panelShow.ts`).
- The agents plugin has no route that returns one tool call. `GET /sessions/:sessionId/events` and
  `GET /sessions/:sessionId` page through events, and the fold stays inside a page, so the host can't
  read one call by asking for a short page at its seq.
- The host calls the Node with `nodeRequest` in `apps/cli/src/browser/bridge.ts`, under the browser's
  device credential, and checks the selection before and after a read. It already reads projects
  (`listProjectRows`), and `tasks.pages` names each active task's project.
- After phase 2, `RunPanel` and `CardFrame` draw a run with no shell.

## Requirements

### A route for one tool call

1. The agents plugin adds `GET /sessions/:sessionId/tools/:toolId`, which returns that call folded
   across the whole session (`mergeToolCall`), with its `turnId` and the session's `taskId`. It sits
   behind the same ownership check as the session's other routes, `ownsSessionUnlessSearch`, and
   answers 404 for a call the session doesn't have.
2. The lookup reads the call's rows from the ledger by ID. It doesn't page the session. If the ledger
   has no index on tool ID, add one in the same change.

### The bridge operation

3. `panel.run` takes `nodeId`, `sessionId`, and `toolId`, and answers
   `{ nodeId, sessionId, toolId, plan, run }`. `plan` is the parsed plan, so the sidebar can lay out
   the view. `run` is the run route's answer, unchanged.
4. The host:
   1. Reads the call with the route above.
   2. Refuses with `not_found` unless the call's `name` is `panel_show`, its status is `completed`,
      and its output parses as a `panel_show` result.
   3. Parses the input with `panelShowInputSchema` and the plan with `panelPlanSchema`, as the desktop
      card does, and takes the title from the input.
   4. Finds the task's workspace from the session's task and the project list.
   5. Runs the plan through the run route as a draft, in `execution` mode. The sidebar sends its time
      zone with the request, because the host's clock may not be the browser's.
5. A run is a read. It uses `read: true` so a moved selection refuses the answer, and it caps the
   answer at the host's reply limit, `NATIVE_REPLY_MAX_CHARS`.
6. The browser never sends a plan. A sidebar can ask the host to run only a plan an agent showed in a
   session the device can read.

### The sidebar card

7. `PanelCard` in `apps/extension/src/sidebar/` replaces the phase 1 line for a completed panel
   call. It loads `RunPanel`, `CardFrame`, and the views with a dynamic import, so a conversation
   with no panels never loads them.
8. It sends `panel.run` when `CardFrame` reports it visible, and again on **Refresh**, on the
   conversation's `agent` hint for this session, and when the connection comes back. A failed run
   keeps the last panel and shows why above it, as the sidebar's plugin panels do.
9. It provides `PanelViewHost` with `openLink` only, which opens `http` and `https` addresses in a
   new tab through the extension's `tabs` API. It provides no history.
10. Row presses: a press that opens a URL opens it in a new tab. A press that opens a task, a pane,
    or an overlay is replaced by **Open in Acorn** on the row's menu. Buttons, board moves, and data
    source actions are off. Phase 5 turns actions on.
11. A newer card with the same `panelId` collapses the older one to "<title>. Replaced by a newer
    version." with **Show**, among the cards the sidebar has loaded. A collapsed card doesn't run.
12. A host that doesn't know `panel.run` answers `bad_request`. The card falls back to its phase 1
    line and says "Update the Acorn CLI to see this panel here."

## Out of scope

- **Add to dashboard**, **Keep it up to date**, and **Edit in studio**. **Open in Acorn** covers them.
- Drill-downs. The desktop opens them in a modal with **Add as panel**. The sidebar's views get no
  drill-down handler, so group headers aren't pressable.
- History trends on a stat.

## Risks

- **Reach.** A paired browser can run any panel an agent showed in a session the device can read.
  The desktop can do the same, under the same device, so this doesn't widen what the device can do,
  only where it can do it from. Record it in [security](../../security.md).
- **Run cost.** Each visible card runs its plan on every `agent` hint for its session, and a busy
  agent sends hints several times a second. Coalesce: a card reruns at most once every five seconds
  for a hint, and at once for **Refresh**.
- **The Node's size budget.** The new route adds to the agents plugin's boot path unless its handler
  loads lazily.
- **Supplied rows.** A plan with 256 KiB of supplied rows comes back in `plan` and again in `run`.
  That's under the reply limit, but it's slow over native messaging. Measure one before deciding
  whether `plan` should drop its rows.

## Steps and checkpoints

**Checkpoint 1.** The route, with tests for a call in one page, a call across pages, another
session's call, and a call that doesn't exist.

**Checkpoint 2.** `panel.run` in the host, with tests for a good call, a call with another name, a
failed call, a plan that no longer validates, and a moved selection.

**Checkpoint 3.** The sidebar card, with tests for each view kind from a fixture run, the collapse,
the fallback on an older host, and that a card out of view sends nothing.

**Checkpoint 4.** In `pnpm dev:extension`, ask an agent for a bar chart, a table, and a stat. All
three draw. Ask for a changed version of the chart. The first collapses. Scroll the first card out of
view, and check in the host's log that it stops running.

## Docs that change

- [Native messaging](../../browser-extension/native-messaging.md): `panel.run`.
- [The conversation view](../../browser-extension/transcript.md): panel cards.
- [Dashboards](../../dashboards.md#panels-from-a-conversation): the extension draws the card read
  only.
- [Agent tools](../../agent-tools.md) or the agents plugin's route reference: the tool call route.
- [Security](../../security.md): what the browser's device can run.

## Verify before building

- Whether the run route needs anything the desktop card sends that this doesn't, such as
  `evaluationTime`.
- How the ledger stores a tool call. `toolFold.ts` says the ledger keeps a call as two rows, its
  opener and its latest state. Confirm that before writing the lookup.
- Whether the background's port accepts `sidebar` connections only from the sidebar page. At
  `a6842f9b7`, `runtime.onConnect` checks the port's name and not its sender.
