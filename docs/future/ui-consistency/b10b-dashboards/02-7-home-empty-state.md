# 02-7. Home has no empty state

**Status:** not started. Batch B10b. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

A new workspace's Home is a title and a small ghost **Add panel** button in the top-left corner of an
empty page. Nothing says what Home is for. Home is the default landing page, and a first-time visitor
sees a blank screen with one faint button.

## Where to see it

Home in the left rail, on a workspace with no panels (the fixture's state).

## Already done

- K2's 00-5 made Home's title `Heading level={1}` and padded `.home-source` like the other pages, so the
  title lands where Memory's does. The heading and padding half of this finding is done.

## The fix

- In `packages/client-core/src/features/workspaces/Home.tsx`, not in `PanelGrid`: with no panels, draw a
  centred `EmptyState` with a title, one line, and **Add panel** at md. `PanelGrid` also renders in
  `ChromeSourcePanel.tsx` (around `:389`) and `ChromeExtendedPane.tsx` (around `:43`), so the empty state
  must not live there.
- The header's **Add panel** ([10-16](./10-16-home-grid-and-header.md)) shows only once panels exist, so
  the empty page has one **Add panel**, not two.
- [10-12](../b10a-linear-and-rollbar/10-12-states.md)'s empty Home tab uses this same state.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| Home with no panels (new) | (only the **Add panel** button) | Rewrite | Title "Nothing on {tab name} yet". Body "Add a panel to see tasks, pull requests, issues, or anything else in view." Action **Add panel**. |
| `PanelGrid.tsx:338` | Add panel | Keep | |

The title and body are the plan's merge of area 02's row 584 and area 10's row 677. On Home with no
tabs, {tab name} is "Home".

## What earlier batches give you

- **The empty-state rule** (K2's 00-9): an empty page uses the centred `EmptyState` with a title.

## Risk and checks

- Before you start, confirm how Home knows it has no panels without reaching into `PanelGrid`.
- `PanelGrid` is shared by three hosts. Home-only changes go through a prop or stay in `Home.tsx`.
- Screens: Home empty, then with one panel (delete it after).
- Tests: the client-core dashboards tests.
