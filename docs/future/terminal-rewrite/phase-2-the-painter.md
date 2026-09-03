# Phase 2: the painter

Status: not started. Waits on phase 0's spikes 2 and 3. Independent of phase 1. Not shippable to
readers on its own; it runs behind a build switch until phase 3.

## Goal

A second painter exists beside OpenTUI's, selected at build time by `ACORN_TUI_PAINTER=own`, and
draws every golden frame from phase 0 that contains no scroll viewport, input, textarea, or pty
rectangle, cell for cell. It is four folders under `apps/tui/src`: the node tree Solid mutates, the
Yoga pass over it, the cell buffer with its diff and flush, and the input parser. None of the 75 kit
components, seven layouts, or chrome files change more than an import.

## Why this phase, and why as a switch

[review.md](./review.md) § 2a through § 2c are the rendering fault class, and every one of them is a
property of OpenTUI's `Renderable`: it has a lifecycle (destroyed a tick after detach), it has
behaviour (a `text` refuses a bare child, a `span` drops props), and it reads its size from Yoga
without clamping. The design in [architecture.md](./architecture.md) § 1 to § 3 replaces the
renderable with a plain object and moves every behaviour into a paint pass that reads the tree. A
plain object cannot be destroyed too early, cannot refuse a child, and has whatever size the layout
function wrote.

The switch is what makes this phase safe to build over weeks. Both painters compile from the same
component source because the components speak intrinsic JSX (`<box>`, `<text>`, `<span>`) with flex
props, and the only thing that decides which painter receives those calls is the alias for
`@opentui/solid` in `apps/tui/vite.config.ts`. Point the alias at our reconciler module and the whole
app draws through the new painter; point it back and nothing has changed. The goldens are the judge.
The test suite runs against both while the switch exists, which is the only way to know the new
painter is a painter and not a different kit.

## Scope

In:

- **The node tree** in `apps/tui/src/tree/` (new): the `Node` type, the nine universal-renderer
  operations, `render`, `Dynamic`, and the JSX namespace types for the intrinsics and their props.
  The module is the alias target for `@opentui/solid`, so it must export the same names the six
  importing files use: `Dynamic`, `render`, and `extend` (which becomes a no-op that registers
  nothing, because our kinds are fixed; `apps/tui/src/kit/rectangle.tsx` calls it once for the
  embedded terminal and phase 3 removes that call).
- **The layout pass** in `apps/tui/src/layout/` (new): Yoga node creation and freeing tied to
  `createElement` and `removeNode`, the prop-to-setter table, the text measure function, and the
  read-back that writes each node's rectangle and clamps it to finite non-negative integers.
- **The paint pass** in `apps/tui/src/paint/` (new): the `Cell` and `Buffer` types, the tree walk
  with clipping, box backgrounds and borders (which sides, in the glyphs `borderCell` in
  `packages/client-core/src/kit/tokens/roles.ts` returns for a border role; today every border is
  OpenTUI's `single` style and the role decides the sides), text runs with wrap and truncation, the
  previous-frame diff, the flush with synchronized output, and the frame scheduler.
- **The input parser** in `apps/tui/src/input/` (new): the terminal open and close sequences
  (alternate screen, raw mode, kitty keyboard with `disambiguate`, SGR mouse, DEC 1004 focus
  reporting), the byte parser producing our `KeyEvent`, `MouseEvent`, `FocusEvent`, `PasteEvent`,
  and a `SIGWINCH` resize. In this phase the parser exists and is tested against recorded byte
  sequences; it is wired into the dispatcher in phase 3 when the widgets that need it exist.
- **Colour and attributes**: `apps/tui/src/appearance.ts` and `apps/tui/src/kit/roles.ts` lose their
  `RGBA` and `TextAttributes` imports for a `Color` type of ours (an index 0 to 15, an RGB triple, or
  `default`) and a bitmask of ours. `spanStyle` merges into `textStyle` because a span takes the same
  props as a text.
- **Width**: `ellipsise` and `pad` in `apps/tui/src/kit/cells.tsx` measure with `Intl.Segmenter` and
  the East Asian Width table spike 3 chose. `☰`, `🗀`, `🗎`, `🗒`, `🗃` and `🖵` in
  `apps/tui/src/kit/glyphs.ts` become one-cell characters, because they measure two today and the
  file's own comment says they do not; the goldens for the trust prompt and the notes tab are
  recaptured after the swap. The emoji ban in that file stays, and its `\p{Emoji_Presentation}` test
  becomes an assertion that the painter's measure returns 1 for every value in `GLYPHS`, which is the
  check that would have caught those six.
- **The switch**: `ACORN_TUI_PAINTER` read in `apps/tui/vite.config.ts` and `apps/tui/vitest.config.ts`
  to pick the alias target, defaulting to `opentui`. `main.tsx` picks `createCliRenderer` or our
  `openTerminal` from the same define.
- **The golden comparison** running in a test file that is skipped unless the switch is `own`, so
  the default suite is unaffected until phase 4.

Out: the scroll viewport, `Input`, `Textarea`, the pty rectangle, and mouse hit testing, all phase 3.
Deleting anything, phase 4. Any change to a component's props or output; a component that needs one
to draw the same cells under both painters has found a bug in the painter, not in the component.

## Design

### The node

```ts
type Node = {
  kind: 'box' | 'text' | 'span' | 'scrollbox' | 'input' | 'textarea' | 'pty' | '#text'
  props: Record<string, unknown>
  parent: Node | null
  children: Node[]
  yoga: YogaNode | null           // null for '#text' and 'span', which are measured by their text parent
  rect: { x: number; y: number; w: number; h: number }   // last layout, clamped
  text?: string                   // '#text' only
}
```

That is the whole type. Focus, visibility semantics, scroll offsets, and edit state are not on it:
focus is the store's, visibility is `props.visible` read by layout as `DISPLAY_NONE`, scroll offset
and edit state arrive in phase 3 as props the widget components own.

### The operations

`createElement(kind)` makes a node and, for kinds that lay out, a Yoga node. `createTextNode(text)`
makes a `#text`. `insertNode(parent, node, anchor)` links the node, inserts the Yoga child at the
matching index, and marks the frame dirty. `removeNode(parent, node)` unlinks, removes the Yoga child,
and marks dirty. It does not free the Yoga node, because Solid's `Suspense` may hand the node back;
the Yoga node is freed when the *owner* is disposed, which `createElement` learns by calling
`onCleanup` under the current owner, the same trick `apps/tui/src/kit/reconciler.ts` uses today for
`tieDestroyToOwner`. A node created outside an owner frees on remove. `setProperty(node, name, value)`
stores the prop, applies it to Yoga if the table has a setter for it, and marks dirty. `replaceText`
updates a `#text` and marks its nearest `text` ancestor's Yoga node dirty so it re-measures.
`getParentNode`, `getFirstChild`, `getNextSibling`, `isTextNode` read the fields.

A `#text` directly under a `box` is legal. Paint draws it as a one-line default-styled run at the
box's content origin. That is the orphan-text override made unnecessary rather than moved.

### Layout

One `calculateLayout(cols, rows, LTR)` on the root per dirty frame. The read-back walks the tree,
reads the four computed values, adds the parent's absolute origin, clamps, and writes `rect`. A
`text` node's measure function wraps or truncates its concatenated children (its own `#text` and
`span` children, in order) at the width Yoga offers, using `wrapMode` (`word` or `none`) exactly as
`apps/tui/src/kit/cells.tsx` § `Line` passes it, and returns lines by the width measure. Measurement
results are cached on the node keyed by the width and the text so a frame that moved nothing measures
nothing. The no-shrink rule ([tui.md](../../tui.md) § What the TUI never does) is honoured by the same
props it is honoured by today; nothing about it moves into the engine.

### Paint

`paint(root, buffer)` walks depth first. Each node's clip is the intersection of its rect with its
parent's clip. A `box` fills its background if it has one, draws its border in the style and colour
`apps/tui/src/kit/roles.ts` computed, and recurses into the content rect. A `text` draws the lines
its measure produced, each run with the fg, bg, and attribute bits of the `span` or `text` that owns
it. A `#text` under a box is one run. `visible === false` is skipped entirely, which is also what
Yoga does with `DISPLAY_NONE`, so the two agree without a rule.

The buffer is a flat array of cells. A wide glyph writes itself at its first cell and a continuation
marker at the second, so diff and flush treat the pair as one. Flush compares the two buffers row by
row, groups changed cells into runs, and writes for each run a cursor position (`CSI row;col H`) and
the styled text, with an SGR only where the style changes from the previous cell written. The whole
write is inside `CSI ? 2026 h` and `CSI ? 2026 l`. After flush the buffers swap and the new back
buffer is cleared. A resize clears both and forces a full frame.

Colour output: `default` is `39` or `49`; an index is `30 + i` or `90 + (i - 8)`; RGB is `38;2;r;g;b`.
Attributes are `1`, `2`, `4`, `7` set and their `22`, `24`, `27` resets. That is the whole SGR
vocabulary the kit needs.

### Scheduling

Every operation that changes the tree calls `requestFrame()`, which sets a flag and, if none is
pending, `setImmediate(frame)`. `frame()` runs layout if any Yoga node is dirty, paints, flushes,
clears the flag. This is at most one frame per event-loop turn, which coalesces a burst of signal
writes into one paint the way OpenTUI's `requestRender` does. There is no timer and no frame rate.

### Input

`openTerminal(stdin, stdout)` writes the enter sequences and returns `{ cols, rows, close, events }`.
The parser is a state machine over bytes: ground, ESC, CSI with parameters, SS3, OSC (for replies we
do not act on), and a lone-ESC timeout of the length OpenTUI's parser uses. It emits `KeyEvent`
(`name`, `text`, `ctrl`, `shift`, `alt`, `super`, `press | release | repeat`), `MouseEvent` (`x`, `y`,
`button`, `action`, modifiers), `FocusEvent` (`in | out`), `PasteEvent` (text), and `ResizeEvent`.
Kitty's `CSI u` form and its release events are decoded when the terminal answered the request; the
legacy forms are decoded always. The names match the spellings `apps/tui/src/keys/tiers.ts` and the
intent table already use (`up`, `down`, `return`, `escape`, `pageup`, `pagedown`, `home`, `end`,
`tab`, `f6`), so no binding is respelled.

### What each workaround becomes

| Today | After |
| --- | --- |
| `apps/tui/src/kit/reconciler.ts` `insert` override (orphan text) | Not needed; a `#text` under a box paints |
| `apps/tui/src/kit/reconciler.ts` `createElement` override (destroy race) | Not needed; nothing destroys on detach |
| `apps/tui/src/renderGuard.ts` prototype patches | The clamp in the layout read-back, one function |
| `apps/tui/src/renderGuard.ts` listener cap | Not needed; no `selection` event |
| `apps/tui/src/kit/roles.ts` `spanStyle` | Merged into `textStyle` |
| `apps/tui/src/appearance.ts` "always name a colour" | `default` emits `39`; the comment goes |
| `apps/tui/src/main.tsx` console overlay suppression | Not needed; no overlay |
| `apps/tui/src/kit/render.tsx` `RAW_KEYS` | Not needed; the harness pushes a `KeyEvent` |

## Code touched

- `apps/tui/src/tree/` (new), `apps/tui/src/layout/` (new), `apps/tui/src/paint/` (new),
  `apps/tui/src/input/` (new).
- `apps/tui/vite.config.ts`, `apps/tui/vitest.config.ts`: the switch and the alias target.
- `apps/tui/src/main.tsx`: pick the renderer by the define; the version check stays until phase 4.
- `apps/tui/src/appearance.ts`, `apps/tui/src/kit/roles.ts`, `apps/tui/src/kit/cells.tsx`: the colour
  type, the merged style, the width measure. These compile under both painters, so the colour type
  needs an adapter to `RGBA` while the switch exists; it is ten lines and phase 4 deletes it.
- `apps/tui/package.json`: `yoga-layout` added; nothing removed yet.

## Tests

- `apps/tui/src/tree/tree.test.ts` (new): the nine operations against a hand-built tree; `Suspense`
  removing and re-inserting the same node keeps its Yoga node; disposing the owner frees it.
- `apps/tui/src/layout/layout.test.ts` (new): the prop table covers every flex prop the kit uses
  (grep the kit for `flexDirection=` and friends, assert each has a setter); a node inserted after a
  pass reads a zero rect, because the read-back clamps the `NaN` width and height spike 2 measured
  coming out of Yoga; the measure cache hits on an unchanged text.
- `apps/tui/src/paint/paint.test.ts` (new): a box with each border style; a wrapped text; a wide
  glyph occupies two cells and one flush run; a diff of a one-cell change emits one cursor move and
  one run; a full clear after resize.
- `apps/tui/src/input/parser.test.ts` (new): recorded byte sequences for each key the tiers name in
  both kitty and legacy forms, SGR mouse press and wheel, focus in and out, a bracketed paste, a lone
  Escape after the timeout.
- `apps/tui/src/golden.test.ts` (new, skipped unless the switch is `own`): every phase 0 golden
  without a widget matches character for character and run for run. Failures print the comparison
  helper's `row:col` report.
- `apps/tui/src/kit/kit.test.tsx` and `apps/tui/src/layouts/layouts.test.tsx` run under both switch
  values in CI. Under `own`, the cases that draw a widget skip with the phase 3 marker.

## Docs owed

None until phase 4, because nothing a reader can run changes. The phase file records the spike
numbers that decided the Yoga entry and the width measure.

## Done when

- Under `ACORN_TUI_PAINTER=own`, every widget-free golden matches.
- The kit and layout suites pass under both switch values, with the widget cases skipped under `own`.
- The eager closure under `own` is measured with `apps/tui/scripts/check-startup-graph.mjs` and the
  number is written here beside the `opentui` number.
- No file under `apps/tui/src/tree`, `apps/tui/src/layout`, `apps/tui/src/paint`, or `apps/tui/src/input`
  imports from `@opentui/*`.

## Verify before building

- Spike 2 and spike 3 answers are written in [phase-0-baseline-and-spikes.md](./phase-0-baseline-and-spikes.md).
- Confirm `solid-js/universal` is still exported by the catalog's `solid-js` (it is at 1.9.13) and
  that `vite-plugin-solid` still takes `generate: 'universal'` and `moduleName`.
- Confirm the six files importing `Dynamic` from `@opentui/solid` still do, and whether any new file
  imports something else from it, so the module exports everything the alias must satisfy.
- Tally the props handed to `<box>` and `<text>` again (the review's tally at `9e5d90ca` is 21
  distinct props) so the layout table is complete on the day it is written.
- Read [ui-design.md](../../ui-design.md) § Every node at 80 by 24 and [panes.md](../../panes.md)
  § Layout model first; a golden mismatch is judged against those sentences, and where a golden
  disagrees with the sentence, the sentence wins and the golden is corrected with a note.
