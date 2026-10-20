# Phase 5: row actions

Date: October 21, 2026. Status: proposed. Needs phase 3 for panels, and phase 4 for apps.

## Goal

A row's actions run from the sidebar, in a panel card and in an app card, after the same confirm the
desktop shows. A program or a sidebar can only run an action the data source offered on a row the
Node returned.

## What the person gets

- A panel card's row menu and buttons offer the source's actions, such as **Close issue** or
  **Approve**. Each asks first: "Close issue? Close issue on Fix the login redirect. This can change
  something."
- An app's row-action buttons work the same way.
- An action that answers with a URL opens it in a new tab, after the link confirm.
- An action that opens something in Acorn, such as a task or a pane, offers **Open in Acorn**.

## Starting point

- The run route's rows carry each row's `actions`, with `id`, `label`, and `risk` (`read`, `write`,
  or `execute`), and its `records`. `POST /v1/core/data-sources/act` takes the record, the action's
  ID, and `confirmedRisk`, with an `Idempotency-Key` header, and answers an `outcome` and sometimes an
  `action` to take next, such as `openUrl`.
- The desktop's app view finds the row and action in its own last run of the plan, never in what the
  program sent (`runRowAction` in `plugins/trellis/src/client/AppView.tsx`). The desktop's panel runs
  a row's actions through `runChromeAction`, after the risk confirm in `PublishedDashboardPanel.tsx`
  (`RISK_CONFIRM`).
- After phases 3 and 4, the host can run a panel's plan from its call and an app's plan from its
  revision, and the sidebar draws both with actions off.

## Requirements

### The bridge operation

1. `row.act` is a write. It takes `nodeId`, `key`, `rowId`, `actionId`, `confirmedRisk`, and a
   target, which is one of:
   - `{ kind: 'panel', sessionId, toolId }`
   - `{ kind: 'app', taskId, appId, revision, plan, inputs }`
2. The host runs the target's plan again, as `panel.run` or `app.run` would, and finds the row by
   `rowId` and the action by `actionId` in that run. A row or action that isn't there fails with
   `not_found`: "That row changed. Refresh and try again."
3. The host refuses an app target for a revision that isn't the app's head, because an older revision
   is read only.
4. The host sends the row's first record, the action's ID, and `confirmedRisk` to the act route, with
   `key` as the idempotency key. It answers the route's `outcome` and any next action, unchanged.
5. An answer that never arrives is `ambiguous_mutation`, as with every bridge write. The sidebar
   retries with the same key only when the person presses again.

### The sidebar

6. A panel card passes `onActivate`, `onButton`, and the row menu's handler to the views. Each one
   confirms with the desktop's words for the action's risk, then sends `row.act` with a new key.
7. An app card gives its `AppHost` a `rowAction` that sends `row.act`. `AppRuntime`'s own confirm runs
   first, as in the desktop.
8. A next action of `openUrl` goes through the link confirm and opens a new tab. Any other next
   action offers **Open in Acorn** for the task.
9. After an action, the card runs its plan again, so the row shows its new state.

## Out of scope

- Board moves, which write a field by dragging a card between columns. They stay in the desktop.
- **Correct this row**, which needs the studio.

## Risks

- **A write from the browser.** This is the first bridge operation that changes a data source's
  records. The confirm names the action and the row, the host takes both from a fresh run, and the
  Node checks `confirmedRisk` against the action's own risk. Record it in [security](../../security.md).
- **One extra run per action.** The host reruns the plan to find the row. For a plan over a slow
  source, an action takes as long as a refresh plus the action. That's the price of keeping the host
  stateless. If it's too slow, the host can keep each target's last run for a minute instead.
- **A row that moved.** If the source's rows changed between the card's run and the press, the host
  refuses rather than acting on a different row. The person refreshes and presses again.

## Steps and checkpoints

**Checkpoint 1.** `row.act` in the host, with tests for a good action, a row that's gone, an action
the row doesn't offer, an app revision that isn't the head, and a retry with the same key.

**Checkpoint 2.** The sidebar's handlers, with tests that a press confirms before it sends, that
declining sends nothing, and that the card runs again after.

**Checkpoint 3.** In `pnpm dev:extension`, with a source that offers a write action, ask an agent for
a table of its rows. Run the action from the sidebar's row menu. The confirm names the action and the
row, and after it the row shows the change. Do the same from an app with a row-action button.

## Docs that change

- [Native messaging](../../browser-extension/native-messaging.md): `row.act`.
- [The conversation view](../../browser-extension/transcript.md): row actions in cards.
- [Agent-built apps](../../agent-built-apps.md#what-an-app-can-reach): the host checks row actions
  against a fresh run in the extension.
- [Security](../../security.md): row actions from the browser.

## Verify before building

- Which next-action verbs the act route can answer, and which of them the sidebar can carry out.
- Whether any source's actions depend on the viewer's task, which the desktop passes through
  `runChromeAction` and the host doesn't have.
