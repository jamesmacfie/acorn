# Terminal rewrite: the order of work

Plan, 2026-09-03. Nothing here is scheduled. Each phase is independently shippable except where the
graph says otherwise, has its own file, and ends with the golden frames and the reachability suite
green. The standing rule is that no phase deletes a workaround until the test that pinned the
workaround passes against the replacement.

## The graph

```text
0 baseline and spikes
├─ 1 one owner of the keys            (needs spike 1; ships alone, under OpenTUI's painter)
└─ 2 the painter                      (needs spikes 2 and 3; behind a build switch)
   └─ 3 widgets and the pty           (needs spike 4)
      └─ 4 cut over                   (needs 1 and 3)
5 what the reference apps do          (independent; reads better after 1)
```

Phases 1 and 2 are independent of each other and can run in parallel once phase 0 is in. Phase 1 is
worth shipping on its own even if the rest stalls, because it ends the navigation fault class by
itself. Phase 2 is not shippable to readers on its own: it runs behind a switch until phase 3 gives it
the widgets a pane needs. Phase 4 is the only phase that deletes anything.

## The phases

**[Phase 0: baseline and spikes.](./phase-0-baseline-and-spikes.md)** Capture a character frame and a
run frame of every first-party pane, the shell, and each overlay at 80 by 24 and 120 by 40 from the
current renderer, and commit them as the golden set. Pin `reachability.test.tsx` as the acceptance
property. Run four spikes, each a day or less, that close the design's open questions: can OpenTUI's
inputs take keys without holding the renderer's focus; which `yoga-layout` entry and how long is a
pass; which width measure; can `@codemirror/state` be the textarea model. Done when the goldens are in
the tree and each spike has a written answer.

**[Phase 1: one owner of the keys.](./phase-1-one-owner-of-the-keys.md)** Keep the `@opentui/keymap`
engine the desktop shares and build it from a host adapter of ours that reads focus from the region
store, so the store is the only owner of focus and OpenTUI's own focus is used for nothing but drawing
an input's cursor. Delete the second reveal and the `focusable` flag dance. Done when the store's focus
value is the only one anything reads, invariant 9 is rewritten, and the reachability suite is green.

**[Phase 2: the painter.](./phase-2-the-painter.md)** The node tree with Solid's universal renderer
operations, the Yoga pass over it, the cell buffer, the diff, and the flush, behind
`ACORN_TUI_PAINTER=own` so both painters build from one source. Boxes, text, spans, borders, colour,
width, clipping. Done when every golden frame that holds no scroll viewport, input, textarea, or pty
matches under the new painter.

**[Phase 3: widgets and the pty.](./phase-3-widgets-and-the-pty.md)** The scroll viewport, `Input`,
`Textarea`, mouse hit testing, and the `pty` rectangle over `@xterm/headless` with a key encoder. Done
when every remaining golden frame matches and the keys and panes suites pass under the new painter.

**[Phase 4: cut over.](./phase-4-cut-over.md)** Remove the switch, the three `@opentui` packages, the
reconciler override, the render guard, the FFI probe, the Node 26 check, and the flag. Rewrite the two
harness files onto the test renderer. Drop the dead CodeMirror, shiki, and xterm browser dependencies
from `apps/tui/package.json`. Move the behaviour into `docs/tui.md` and delete this folder. Done when
the repo's pinned Node runs `acorn` and its whole test suite.

**[Phase 5: what the reference apps do.](./phase-5-what-the-reference-apps-do.md)** Digits jump to
rail panels, the cheat sheet is generated from the dispatcher's table, `g g` and `G` beside Home and
End, a visible context stack in the footer. Each taken up against the keyboard rules, none copied
because it exists elsewhere. Done when each item is in `docs/tui.md` § Keys and focus or in
[refused.md](./refused.md).

## What a phase must leave behind

Each phase file ends with a **Done when** list and a **Verify before building** list. The second is
the more important one: this folder was written on one day against one commit, and by the time a
phase is picked up the code may have moved. A reader verifies the premises before trusting the plan,
and records in the phase file where a premise turned out false, the way the performance programme's
phase files do.
