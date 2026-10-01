# 08-16. The line composer's buttons and the note badge

**Status:** not started. Batch B08a. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

The diff's line composer has two md outline buttons with **Comment** first, where the house pattern is
one solid primary and **Cancel** ghost before it. A failed save reads "failed". The note row's badge
draws text glyphs, "● unsent" and "✓ sent". In Changes, a line "comment" is a private note for the
agent, yet the shared composer says "Comment", because GitHub uses the same one.

## Where to see it

**Review changed files** › Changes. Press the add button in the gutter of a diff line to open the
composer. GitHub's pull request diff uses the same composer.

## The fix

The partial fix. Per-source composer labels ("Note for the agent…", **Add note**) need a
`DiffSource.compose` member, a plugin-API change, and are deferred (see [deferred.md](../deferred.md)).

- `packages/client-core/src/kit/diff/DiffRows.tsx:385-430`: the submit button is `variant="solid"`.
  **Cancel** is ghost and goes first.
- `DiffRows.tsx:405`: "Couldn't save. Try again." This is the one kit fallback; B09 maps GitHub's codes
  to their own sentences before they reach it.
- `plugins/changes/src/client/changesModel.tsx:283-301`: the note badge reads **Not sent** or **Sent**
  in its tone, with no "●" or "✓".

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `changesModel.tsx:288` | ● unsent / ✓ sent | Rewrite | Not sent / Sent |
| `changesModel.tsx:293` | Delete note | Keep | As `tip`. |
| `DiffRows.tsx:405` | failed | Rewrite | Couldn't save. Try again. |

Held with `DiffSource.compose`: `DiffRows.tsx:193, 283` ("Comment on this line" as a gutter tip) and
`:414, 421` ("Comment on this line…" / **Comment** / "Adding…").

## Risk and checks

- Before you start, confirm the composer's height does not depend on button order or variant.
- This is kit diff code. Change variant, order, and text only.
- Screens: the composer open in Changes, and in the GitHub diff if the seed is available.
- Tests: the client-core diff tests and `plugins/changes`.
