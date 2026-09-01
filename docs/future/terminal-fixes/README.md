# terminal-fixes: what the browse investigation found, and what is left to build

Analysis 2026-09-01. Status: diagnosis complete; the rendering fix and two one-line repairs shipped
with the analysis; the interaction programme in this folder is designed and not built.

## The verdict first

The blank panels were not the shell's architecture. The regions, the router-as-a-path-signal, the
source registry, and the two-place rendering of a source's `regions` all read correct, and the
`Sections` node that turns GitHub's desktop folds into a terminal tab strip was wired and working —
invisible only because the panel it drew into was already dead. The core defect was one level down,
in the contract between Solid's `Suspense` and OpenTUI's renderable lifetime: a boundary that had
shown content and suspended again had its subtree destroyed on the next tick and handed the same,
now-dead instances back on resolve. Every selection that loaded anything uncached — which is every
selection, over a real network — blanked the panel it landed in, permanently, and popped OpenTUI's
console overlay over what was left.

Why it survived so long: the test fixture answers in a microtask, so nothing ever suspended after
first paint and every browse test passed while the app failed. The reproducer had to be built before
the fix could be trusted; `ACORN_FIXTURE_DELAY_MS` and `apps/tui/src/browseSlow.test.tsx` are that,
and they stay as the regression net.

## What shipped with this analysis (owned elsewhere, recorded here)

- **Destroy on disposal.** `createElement` in the reconciler alias ties each renderable's
  destruction to its creating reactive owner instead of to its removal from the tree.
  [docs/tui.md](../../tui.md) § Destroy on disposal owns the mechanism and the reasoning;
  `apps/tui/src/kit/reconciler.ts` is the code. The liveness guards that grew around the symptom
  (`alive()` in `kit/asking.tsx`, the scratch probe test) were deleted with it.
- **The Menu snapping back.** `chrome/routing.ts`'s rail-follows-path effect read the selection
  inside its own tracked scope, so choosing a different source re-ran it and the choice was snapped
  straight back to whichever source owned the still-current path. One `untrack` fixes it;
  `browse.test.tsx` § "lets the Menu leave a source" pins it.
- **The console overlay.** `main.tsx` now deactivates OpenTUI's console the way the harness always
  did, so a stray library warning is a scrollback line rather than a curtain over the frame.

## What this folder holds

| File | What it is |
| --- | --- |
| [rendering-lifecycle.md](./rendering-lifecycle.md) | The residue of the destroy-race fix: the risk register to watch, the upstream issue to file, and the loading-UX polish that was deliberately not part of the fix. |
| [interaction-model.md](./interaction-model.md) | The focus and navigation programme, sequenced: spatial `right`/`left` between the left column and the main pane, entering Browse selecting the row it lands on, the dead pane-strip Tab stop, descriptor sources' region identity, component-only sources, and the source-model seam that is named but not built. |
| [refused.md](./refused.md) | The alternatives considered for the rendering fix and the seams deliberately not added, with the reasoning, so a later session argues with it rather than re-deriving it. |
