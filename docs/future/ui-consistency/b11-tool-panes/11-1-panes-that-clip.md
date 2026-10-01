# 11-1. Three panes cut off whatever does not fit, and nothing scrolls

**Status:** not started. Batch B11. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

The Database, API, and Docker log panes each put their content in a plain `Stack` inside a region that
hides overflow. The content grows past the pane and is clipped. In Database, results rows 17 to 40, the
table list, and the row editor are out of reach; the table filter input also grows to about 1,080
pixels and pushes the table list out of view. In API, a long response shows its first 30 lines. In
Docker, the newest log lines and the Follow and Clear controls are below the fold, and **Follow** has no
scroller to follow in. These are the three places people read long output.

## Where to see it

- Database pane on a task, with area 11's fake data patch, a 40-row table open.
- API pane, a request to area 11's local server that returns 120 items.
- Docker rail source › a container › **Logs** (read only; see the safety notes).

## The fix

The partial fix. Where the Database row editor goes, beside the virtual grid or under it, needs a
layout decision and is deferred (see [deferred.md](../deferred.md)).

- `plugins/database/src/tree/DatabasePanel.tsx:223`: `<Stack gap="none" grow>`.
- `DatabasePanel.tsx:239`: the filter `Input` goes in a `Toolbar size="sm"`, so it stops growing.
- `plugins/http/src/tree/ResponseView.tsx:65, 125`: `Stack gap="row" grow`.
- `plugins/docker/src/client/ContainerDetail.tsx:163`: `Stack gap="row" grow`, which gives `Log` a
  scroller so **Follow** works.
- jsdom has no layout: assert `data-grow` in tests, and check scrolling in the window.

## Copy

No copy rows.

## Risk and checks

- Before you start, list elements whose `scrollHeight` exceeds `clientHeight` and whose `overflow-y` is
  hidden, through the driver's `execute`. That is the quick way to find a clipping region.
- The Database frame wraps a virtual `Grid`. Do not move the grid into another container.
- K1a's agent once saw the API pane go blank after a restart, list and detail, and come back after
  switching panes. Watch for it.
- Screens: Database with a 40-row table, a long API response, and Docker logs.
- Tests: `plugins/database`, `plugins/http`, `plugins/docker`. Rebuild the database and http bundles.
