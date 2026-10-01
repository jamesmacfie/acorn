# 10-1. Dashboard rows look like buttons and do nothing

**Status:** not started. Batch B10b. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

In every list, table, and board panel, a row whose record carries an action draws as a focusable button
with a pointer cursor. Every GitHub pull, Linear issue, Rollbar error, and task record carries one. The
placed panel passes `onActivate={() => {}}`, so pressing a row does nothing. A dashboard of tasks or
issues is a list you want to open things from, and every row invites a click and ignores it.

## Where to see it

Home › **Add panel** with a tasks source, publish it, then press "Review changed files" in the panel.
Delete the panel after.

## The fix

- `packages/client-core/src/features/dashboards/PublishedDashboardPanel.tsx:79`: replace
  `onActivate={() => {}}` with the dispatch the old `Panel.tsx` had. Read it with `git show 6734ce55^`
  on that file. The call is
  `runChromeAction(row.action, { pluginId, nodeId, navigate, prefer: 'route', taskId, item })`.
- Confirm any action whose `risk` is `write` or `execute` before it runs.
- `DashboardEditor.tsx:350`: drop the no-op.
- `views/props.ts:28`: make `onActivate` optional.
- Give rows `onPress` only when `row.action && props.onActivate` (`views/ListView.tsx:31`,
  `views/TableView.tsx:29`, `views/BoardView.tsx:57`), so preview rows in the editor are not pressable.

## Copy

No copy rows. A confirmation for a write or execute action needs a "{Verb} {thing}?" label.

## What earlier batches give you

- **`runChromeAction`** in `packages/client-core/src/host/chrome/actions.ts` already handles `openTask`
  and `openUrl`, and asks `openInAppUrl` first.
- **`TableRow` press guard** (K1b's P4): a click on a link or button inside a row goes to that control,
  not the row.

## Risk and checks

- Before you start, read the old `Panel.tsx` dispatch in git history.
- This makes rows act. A write or execute action must ask first. Test one action of each risk.
- Screens: a placed tasks panel, a row pressed, and the editor preview (rows not pressable).
- Tests: the client-core dashboards tests.
