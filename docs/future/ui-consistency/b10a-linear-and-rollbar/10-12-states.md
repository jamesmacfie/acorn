# 10-12. Linear and Rollbar states: false claims, corner text, and raw codes

**Status:** not started. Batch B10a. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

The list header's count shows 0 while loading. A filter with no match shows the source's empty
sentence, "No active issues in the Linear projects this repository follows.", as if there were none.
Rollbar declares no empty state, so its list says "Nothing here yet.". Nothing selected is a centred
line with no title; Rollbar's points at the wrong context. A failed load is a banner flush against the
top bar with a raw code ("provider_needs_auth") and no retry, and it takes **Refresh** away. "ticket"
appears in one error and "issue" everywhere else.

## Where to see it

Linear and Rollbar with the area 10 seed: loading, the filter with no match, no rows, nothing selected,
a failed load, a failed refresh, and ACO-51's empty tabs. Use the `nodeFetch` patch for delays and
errors.

## The fix

The partial fix. A tree-side **Reconnect** needs a bridge verb that reaches settings, and is deferred.
The Home tab's empty state and the panel states are B10b's.

- `packages/client-core/src/host/chrome/ChromeSourcePanel.tsx:227`: show `count` only once rows exist.
- `ChromeSourcePanel.tsx:291-297`: "Nothing matches that filter." when a filter is set. Host-owned, no
  descriptor change.
- `plugins/rollbar/acorn-plugin.config.mjs` (near `:66`): declare an `emptyState`.
- `plugins/linear/src/tree/app.tsx:145` and `plugins/rollbar/src/tree/app.tsx:126`: a centred
  `EmptyState`, "Choose an issue" or "Choose an error". `PageStatus` is local to each tree app; give it
  a `title`.
- `linear/src/tree/app.tsx:67` and `rollbar/src/tree/app.tsx:80`: the failure banner sits inside the
  inset, with a plain reason from a per-plugin code table and **Try again**.
- `plugins/linear/src/tree/LinearIssueView.tsx:183, 224, 244`: empty tabs are
  `EmptyState align="start" size="sm"`.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `ChromeSourcePanel.tsx:54` | Nothing here yet. | Keep | For a source that declares no empty state. |
| `ChromeSourcePanel.tsx:62` | Open (empty-state action fallback) | Keep | |
| `ChromeSourcePanel.tsx:227` | {count} while loading | Remove | No count until the list answers. |
| `ChromeSourcePanel.tsx:233` | Refresh {label} | Keep | |
| `ChromeSourcePanel.tsx:248` | Filter… | Keep | |
| (new) filter with no match | (the source's empty sentence) | Rewrite | Nothing matches that filter. |
| `linear/acorn-plugin.config.mjs:123` | No active issues in the Linear projects this repository follows. | Rewrite | No open issues in the linked Linear projects. |
| `linear/src/tree/app.tsx:67` | Could not load this Linear ticket. | Rewrite | Couldn't load this issue. |
| `linear/src/tree/app.tsx:67`, detail | provider_needs_auth, provider_unavailable, … | Rewrite | `provider_needs_auth`: "Linear turned down acorn's key. Reconnect Linear in Settings." `provider_unavailable`: "Linear didn't answer. Try again." `provider_not_connected`: "Linear isn't connected." `provider_resource_not_found`: "Linear can't find this issue." |
| `linear/src/tree/app.tsx:115` | Failed to add comment. | Rewrite | Couldn't post your comment. |
| (route) `provider_missing_scope` on comment | provider_missing_scope | Rewrite | acorn's Linear key can't post comments. Reconnect Linear with a key that can. |
| `linear/src/tree/app.tsx:123` | Copied to the clipboard | Keep | |
| `linear/src/tree/app.tsx:145` | Pick an issue from the list. | Rewrite | Title only: Choose an issue |
| `linear/src/tree/app.tsx:218` | Loading Linear… | Rewrite | Loading issue… |
| `LinearIssueView.tsx:183` | No description. | Keep | |
| `LinearIssueView.tsx:224` | No activity yet. | Keep | Same shape as the other two empty tabs. |
| `LinearIssueView.tsx:244` | No comments yet. | Keep | |
| `LinearIssueView.tsx:250, 112, 97, 88` | Leave a comment… / Write a reply… / Reply / Unknown (author) | Keep | |
| `rollbar/acorn-plugin.config.mjs` (new `emptyState`) | (host's "Nothing here yet.") | Rewrite | No active errors in the linked Rollbar projects. |
| `rollbar/src/tree/app.tsx:40, 60` | Loading Rollbar… / Loading Rollbar item… | Rewrite | Loading… |
| `rollbar/src/tree/app.tsx:80` | Could not load this Rollbar item. | Rewrite | Couldn't load this error. Plus the plain reason: "Rollbar turned down acorn's token. Reconnect Rollbar in Settings." / "Rollbar is limiting requests. Try again in a minute." / "Rollbar didn't answer. Try again." |
| `rollbar/src/tree/app.tsx:107` | Rollbar context copied | Rewrite | Copied the error details |
| `rollbar/src/tree/app.tsx:126` | Open a task or select an item from the Rollbar rail. | Rewrite | Title only: Choose an error |
| `RollbarItemView.tsx:60` | Could not refresh this Rollbar item. | Rewrite | Couldn't refresh this error. Showing the last data we got. |

The plan's overrules: stale data uses one phrase everywhere, "Showing the last data we got."; Rollbar's
loading line is "Loading…".

## What earlier batches give you

- **The empty-state rule** (K2's 00-9).
- **Remote-tree panes reach their edges** (K2's 08-6), so a banner placed in the inset lines up.

## Risk and checks

- Before you start, list the codes each route returns; the table above covers the ones seen.
- The config change needs the rollbar bundle rebuilt and the node restarted.
- A failing request may sit on "Loading…" in the driver. Judge those states from code.
- Screens: every state listed under "Where to see it".
- Tests: `plugins/linear`, `plugins/rollbar`, client-core.
