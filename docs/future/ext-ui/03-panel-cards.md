# Phase 3: panel cards in the sidebar

Date: October 21, 2026. Status: proposed. Needs phases 1 and 2.

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
