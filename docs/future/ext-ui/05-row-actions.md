# Phase 5: row actions

Date: October 21, 2026. Status: done. Needs phase 3 for panels, and phase 4 for apps.

## Completion note

Landed on October 21, 2026, on the `phase-5-row-actions` branch.

What landed:

- The bridge. `row.act` in `extensionBridge.ts` takes `nodeId`, `target`, `rowId`, `actionId`,
  `confirmedRisk`, `viewerZone`, and `key`, and answers `{ nodeId, outcome, action }`. `actOnRow` in the
  host's `bridge.ts` reads the target's plan, runs it again, finds the row and action in that run, and
  posts the row's first record to the act route with `key` as the idempotency key. The plan readers
  are split out of `panel.run` and `app.run` as `shownPanel` and `appPlan`, and all three share them.
- The sidebar. `apps/extension/src/sidebar/rowActions.ts` holds the confirm's words, the keys, and
  the next step, for both cards. `PanelCard` passes `onButton` and `onOpenRecord` to `RunPanel`, and
  draws the confirm and the link confirm as alerts above the panel, as the desktop's panel does.
  `AppCard`'s host gets a `rowAction`, and asks every query and panel to run again after one.
- `AppHost.rowAction` takes a fifth argument, `confirmedRisk`, the risk `AppRuntime` confirmed. The
  desktop's `AppView` ignores it, because it finds the action in its own last run.
- Two fixes the live check found, both older than this phase. `TableView` and `ListView` read their
  rows once, when they mounted, so a later run never redrew them, in the desktop too. Each now picks
  between groups and rows inside JSX. And the Node shares a source read for five seconds, so a rerun
  right after an action drew the rows from before it. `actOnDataRecord` now clears the shared reads
  once it has dispatched an action.
- Docs: native messaging, the conversation view, agent-built apps, security, and data sources. The
  site page "Talk to an agent from the browser" too, marked checked.
- Tests: checkpoints 1 and 2 as written, plus the link confirm, an action that continues in Acorn, a
  later run's rows in a list and a table, and the shared read dropped after an action.

Decisions and deviations:

- `row.act` also takes `viewerZone`, which the doc didn't list. The rerun must find the same rows as
  the card's run, and a plan that groups by time makes its row IDs in the viewer's zone.
- `key` must be a UUID, because the act route refuses any other idempotency key.
- An app target that isn't the head is `not_found`: "v1 of this app is read only, because v2
  replaced it." `bad_request` would tell the card to update the CLI.
- The confirm's words. The doc gives "Close issue? Close issue on Fix the login redirect. This can
  change something." and also "the desktop's words for the action's risk". The card uses the first
  shape, which the app runtime already uses, with the desktop panel's risk words: "change something"
  for `write` and "run something" for `execute`. A `read` action runs without a confirm, as on the
  desktop.
- A press again after `ambiguous_mutation` reuses that press's key. Any other press gets a new one.
  If the action took effect and the row has left the rerun, the retry answers `not_found`, and
  nothing acts twice.
- `onActivate` doesn't send `row.act`. A row's press is its own unnamed `action`, never a named one,
  so it keeps phase 3's rules, and a row whose own action is `runNodeAction` still does nothing. The
  plan's buttons and the row menu carry the named actions. **Start task** in the menu says "That row
  opens in Acorn."
- Passing `onButton` gives every table row a menu, so every row now has `role="button"`. The phase 3
  test that counted pressable rows now checks that a press on such a row sends nothing.
- A panel card says "Action completed." or "This action no longer applies." after an action, as the
  desktop's panel does. An app card hands the outcome to the program.
- Board moves (`fieldMove`) still don't drop the shared reads. They stay in the desktop, which doesn't
  run again after a move.
- Verify before building. The act route answers `done`, `no-longer-available`, or `ready` with a next
  action of any verb but `runNodeAction`, which it runs itself. The sidebar opens an `openUrl` after
  the link confirm and offers **Open in Acorn** for the rest. The route takes no task. Only a next
  action's destination uses the viewer's task, and the desktop finds that when it opens.

Checks:

- The CLI (181 tests), the extension (291), protocol (325), trellis (49), node-core (1,931), and
  client-core (2,912) pass. `tsc` passes in those packages, the terminal client, and the desktop.
  Lint, the formatter, knip, and the arch tests (95) pass. In the combined run, client-core's
  "posts one message per verb" in `host/frames/sdk.test.ts` failed once under load, and passed alone.
- Checkpoint 3 ran without a live agent. A throwaway plugin loaded through `ACORN_BUNDLED_PLUGINS_DIR`
  offered three issues in memory, with a **Close issue** write action on each open one. A seed script
  wrote a `panel_show` table with a **Close issue** button, and an `app_show` app whose button runs
  the action on the first issue, into a `pnpm dev:extension` session's Node. In the panel, the confirm
  read "Close issue? Close issue on Write the release notes. This can change something." After
  **Close issue**, the card said "Action completed." and the row read "closed" without a refresh. In
  the app, the runtime's confirm read "Close issue? Close issue on Fix the login redirect. This can
  change something.", and after **Confirm** the app's list showed it closed. The plugin's action
  answers nothing next, so `openUrl` and **Open in Acorn** were checked only in the card tests.
- Sizes. The Node service measured 1,915,694 B, under the 1,917,500 B ceiling, from 1,915,652 B after
  phase 4. The 42 bytes are the read cache clear. The sidebar's bundle wasn't measured.

For later work:

- A row's own unnamed `action` with `runNodeAction`, and a risky `openUrl` one, still open in the
  desktop only. Running them from the sidebar needs an operation that names the row's press, not a
  named action.
- Board moves, corrections, and drill-downs stay in the desktop.

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
