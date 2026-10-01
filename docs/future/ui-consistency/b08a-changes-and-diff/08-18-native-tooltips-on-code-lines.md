# 08-18. Every code line in Changes carries a native tooltip

**Status:** not started. Batch B08a. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

`DiffCanvas` sets `title` on every code row to the source's line-action hint, which Changes sets to
"⌥-click: add line reference to the agent composer". Resting the pointer anywhere in the diff opens a
browser tooltip over the code you are reading.

## Where to see it

**Review changed files** › Changes. Rest the pointer on any line of code for a second.

## The fix

- `packages/client-core/src/features/diff/DiffCanvas.tsx:245`: drop the row `title`.
- `plugins/changes/src/client/changesModel.tsx:302-309`: the hint moves to `data-tip-sub` on the **Ask
  agent** gutter button. Reuse `DiffSource.lineAction.title` for it.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `changesModel.tsx:303` | ⌥-click: add line reference to the agent composer | Rewrite, move | On the **Ask agent** button's tip: "⌥-click a line to add it to your message" |
| `DiffRows.tsx:323` | Ask agent about this line | Keep | As `tip`, with the ⌥-click line as `tipSub`. |

## What earlier batches give you

- **`formatChord`** (B02), if the chord needs formatting: `packages/client-core/src/kit/lib/rendering/formatChord.ts`,
  or `@acorn/plugin-api/client` in a plugin.

## Risk and checks

- Before you start, confirm the row `title` is the only native tooltip on code rows.
- The gutter buttons themselves stay as they are (08-10 is deferred for the performance work).
- Screens: hover a code line (none), then hover the Ask button (forced visible, since hover cannot be
  driven).
- Tests: the client-core diff tests and `plugins/changes`.
