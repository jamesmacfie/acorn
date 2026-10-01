# 09-7. A pull list row gives the title 61 of its 300 pixels

**Status:** not started. Batch B09. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

A pull list row is, left to right: the checks dot, the state icon, the avatar, "#42", the title, the age
in a reserved 84-pixel field, and a "···" button. The title gets 61 pixels, "Show ch…", on every row.
The state icon says "open" on every row of the Open tab. A pull with no checks has no dot slot, so its
row starts 12 pixels left of the others. The header says "REVIEWS", with no count, for a list the rest
of the plugin calls pull requests. The title is how people tell pull requests apart.

## Where to see it

GitHub in the left rail with the area 09 seed. The list is virtual; patch `requestAnimationFrame` as
[the README](../README.md#driver-quirks) describes, then leave and come back.

## Already done

- K1a capped row meta and gave the body a floor (07-4), and made `RowActions` hide until hover, focus,
  or selection (08-4).

## The fix

Width and props only. One line per row, same height, no change to the virtual list.

- `plugins/github/src/client/PullList.tsx:243-310`: the checks dot is always drawn, a muted empty dot
  with a tip for "no checks". The state icon shows only for draft or closed. "#42" moves into the title
  text in muted mono. Meta is a short age ("14m") with the full date in the tip. Drop
  `metaFields={1}`.
- `plugins/github/src/client/GithubBrowse.tsx:72-84`: `SectionHeader` **Pull requests** with `count`,
  **New** with the plus icon and the tip "New pull request", and refresh with the tip "Refresh pull
  requests".

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `GithubBrowse.tsx:83` | Reviews | Rewrite | Pull requests |
| `GithubBrowse.tsx:78` | + New PR | Rewrite | **New**, with the plus icon, tip "New pull request" |
| `GithubBrowse.tsx:76` | New pull request (tip) | Keep | |
| `GithubBrowse.tsx:79` | Refresh reviews | Rewrite | Refresh pull requests |
| `PullList.tsx:27` | Open / Closed | Keep | |
| `PullList.tsx:191` | Filter… | Keep | |
| `PullList.tsx:324` | Load more / Loading… | Keep | |

The plan's overrule on row 544 and 09-14: **New** in the list header, with the tip "New pull request".

## What earlier batches give you

- **`StatusDot tip`** (K3), for the always-drawn checks dot.

## Risk and checks

- Before you start, measure a row's height; it must not change.
- Screens: the Open tab with six pulls (including #47 with no checks), and collapsed.
- Tests: `plugins/github`.
