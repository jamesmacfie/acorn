# 11-9. Buttons in the tool panes come in four heights

**Status:** not started. Batch B11. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

Across Database, API, Docker, and the terminal drawer, buttons are 32 (md), 26 (sm), 11 (bare text), and
7 by 11 (the saved-query picker's remove "✕", which deletes on one click with no confirmation). The bare
11-high ones are the API request's name, **Variables**, a row's copy and delete glyphs, the variable
delete, and Docker's log **Clear**.

## Where to see it

The API pane's list and Variables view, the Database pane's saved-queries picker, and Docker's log find
bar.

## Already done

- K1a forced sm on buttons in chrome bars, which fixed the md cases.
- K4a's P17 made the `Picker` remove an armed `ConfirmButton` (xs, icon-only, the `x` icon) with an
  optional `removeLabel`. No caller passes it yet.
- B02's 02-18 fixed the terminal strip's "^C" (now **Stop**, an `IconButton`).

## The fix

- Bare 11-high buttons become `IconButton` (glyphs) or ghost sm (words):
  `plugins/http/src/tree/HttpDetail.tsx:55`, `HttpList.tsx:48-56, 77-90`, `HttpVariables.tsx:125-134`,
  and Docker's log **Clear** in `plugins/docker/src/client/ContainerDetail.tsx`.
- The saved-queries picker (`plugins/database/src/tree/DatabasePanel.tsx`, around `:263`) passes
  `removeLabel="Delete saved query"`, so one click no longer deletes a query.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `kit/components/inputs/Picker.tsx:170` (via the caller) | ✕ (label Remove) | Rewrite | `removeLabel="Delete saved query"`. The armed prompt reads "Delete saved query?". |
| `HttpList.tsx:77` | Duplicate as a new request (`title`) | Rewrite | tip "Duplicate" |
| `HttpList.tsx:88`, `HttpVariables.tsx:130` | Confirm delete | Done | K1a made them **Delete request?** and **Delete variable?**. |

K4a's note suggested `removeLabel="Delete query"`; the plan and the copy table say "Delete saved query".
Use the plan's.

## What earlier batches give you

- **`Picker removeLabel`** (K4a's P17). Default "Remove"; the armed prompt is "{removeLabel}?". The
  terminal `Picker` draws no remove control.
- **`IconButton`'s tip defaults to its label** (K3).

## Risk and checks

- Before you start, grep the http, database, and docker plugins for `variant="bare"`.
- Screens: the API list and Variables, the saved-queries picker with one query, and Docker logs.
- Tests: `plugins/http`, `plugins/database`, `plugins/docker`. Rebuild the http and database bundles.
