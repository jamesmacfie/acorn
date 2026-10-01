# 10-9. The Linear and Rollbar detail headers: an 18-pixel title and three button looks

**Status:** not started. Batch B10a. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

Both detail headers use a level 1 heading (18px) inside a `Toolbar`, where a detail title is level 2.
Linear's header holds **← back** (bare, lower case, a typed arrow), **Refresh** (outline sm), and
**Copy link** (outline sm), while the list header beside it refreshes with an icon.

## Where to see it

Linear issue ACO-42, a related issue opened from a relation row ("← back"), and Rollbar item #1042, with
the area 10 seed.

## The fix

The partial fix. **Open in Linear** or **Open in Rollbar** needs a bridge option that skips in-app link
resolution, and an eyebrow without the label treatment needs a `Heading` change that would restyle
GitHub and Docker too. Both are deferred (see [deferred.md](../deferred.md)).

- `plugins/linear/src/tree/LinearIssueView.tsx:128-139`: `Heading level={2}`. **← back** becomes a ghost
  sm `Button` with `arrow-left`, "Back to {identifier}". **Refresh** becomes `IconButton refresh-cw`
  with the tip "Refresh issue". Keep **Copy link**.
- `plugins/rollbar/src/tree/RollbarItemView.tsx:53-57`: level 2, and a refresh `IconButton` with the
  tip "Refresh error".

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `LinearIssueView.tsx:132` | ← back | Rewrite | Back to {identifier} (ghost sm, `arrow-left` icon) |
| `LinearIssueView.tsx:134` | Refresh | Rewrite | Icon button, tip "Refresh issue" |
| `LinearIssueView.tsx:138` | Copy link | Keep | |
| `LinearIssueView.tsx:162` | Linear ticket sections (aria) | Rewrite | Issue sections |
| `LinearIssueView.tsx:155-157` | Overview / Activity / Comments | Keep | |
| `RollbarItemView.tsx:54` | {PROJECT} · #{id} (label treatment) | Keep the words | The sentence-case eyebrow is deferred with the `Heading` change. |
| `RollbarItemView.tsx:56` | Refresh | Rewrite | Icon button, tip "Refresh error" |

## What earlier batches give you

- **`IconButton` tip defaults to its label** (K3), so a label alone gives the tip.

## Risk and checks

- Before you start, confirm the header is inside the scrolling body; making it sticky is the layout
  owner's job, not this batch's.
- Screens: ACO-42, a related issue, and #1042.
- Tests: `plugins/linear`, `plugins/rollbar`.
