# 07-5. The graph: tiny targets, text that shrinks past reading, and ids for names

**Status:** not started. Batch B07a. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

On the editor's **Graph** tab, a card's port and each edge's remove control are 14 by 14, under the
kit's 20-pixel floor, and the remove glyph is a text "×". Fit zooms down to 0.35, where a 12px label
draws at 4px. A screen reader hears the remove control as "Remove the edge from c25f2284-… to
ec5db3f9-…", because edges carry step ids. The graph is the view people reach for to understand a
workflow with branches.

## Where to see it

Workflows › **Release check** › **Graph** tab. The run pane's **Graph** view uses the same kit node.

## The fix

This is the small part. Selection that edits, zoom controls and keys, edge labels, and the run graph's
placement are deferred as new features (see [deferred.md](../deferred.md)).

- `packages/client-core/src/kit/lib/layout/graphLayout.ts:22`: `GRAPH_ZOOM_MIN` goes from 0.35 to 0.6,
  so a label never drops below 7px.
- `packages/client-core/src/infra/styles/primitives.css` (around `:916-941`): `.ui-graph-port` and
  `.ui-graph-cut` at `--control-h-xs`.
- `packages/client-core/src/kit/components/content/Graph.tsx:49`: `DOT` is half of that.
- `Graph.tsx:285`: the "×" becomes `Icon name="x"`.
- `primitives.css` (around `:901`): the card padding becomes a fixed rung, not `--pad-surface`. The
  card is a fixed 200 by 92 in JS (`graphLayout.ts:12-13`), which justifies leaving the semantic
  token: in Cozy, `--pad-surface` is 24 and clips the third line.
- `Graph.tsx:282`: the remove control's name uses the two cards' labels.

## Copy

No copy rows. The remove control's accessible name becomes "Remove the edge from {label} to {label}".

## Already done

- K1a's P1 put `x` in the eager icon set, so `Icon name="x"` draws at once.

## Risk and checks

- Before you start, confirm the card size literals in `graphLayout.ts` and `primitives.css` still
  agree.
- The port size scales with zoom: 20px is 12px on screen at 0.6. That is the floor, not a bug.
- Fit runs in `requestAnimationFrame`, which the hidden driver window never fires. Patch it as the
  README describes before judging centring.
- Screens: the editor Graph tab and the run pane's Graph view.
- Tests: `Graph.test.tsx`, `plugins/workflows`, and the CSS hygiene test.
