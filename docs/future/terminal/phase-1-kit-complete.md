# Phase 1: the whole kit

Status: **shipped 2026-08-31.**

Read [findings.md](./findings.md) first: it owns `slot()` for element-typed props, the `Markdown` and `Textarea` notes, and which fifteen nodes already exist.

## Goal

Every one of the 70 kit nodes has a TUI component at its decided level, roles map to cells through
one accessor, and the tests that check the `tui` column is filled in start checking that the
renderer does what the column says.

## Why this phase, and why now

Phase 0 proved the kit on two panes and fifteen nodes. Everything else is volume: each remaining node
has a sentence and a level, and the work is writing the component the sentence describes. Doing it as
one sweep rather than pane by pane means phase 2's layouts and phase 6's pane sweep never wait on a
missing node.

## Scope

In:

- `apps/tui/src/kit/components.tsx` becomes `Record<KitNodeName, Component>`, complete, no `Partial`.
- Each `reduced` node's loss written next to its level in `support.ts`, per
  [04-rendering.md](./04-rendering.md) § A second `KIT_COMPONENTS`.
- `roleCell()` beside `roleVar()` in `packages/client-core/src/kit/tokens/roles.ts`, reading the `tui`
  column. Every TUI component gets its colour, weight, spacing, and border through it. No component
  names an ANSI colour.
- The theme mapping: 40-odd theme tokens to 16 slots plus `dim` and `bold`, with truecolor passthrough
  where the terminal reports it.
- `Rectangle` recognition: the TUI component for `pty` and `editor` is a native region; `webview` and
  `frame` draw `<Fallback>`.
- `Markdown` through the shell's markdown policy, rendered to styled text with images dropped.
- `CopyButton` over OSC 52 where advertised, `<Fallback>` otherwise.
- A `tui` vitest project in `apps/tui/`, environment `node`, rendering to OpenTUI's buffer and
  asserting cells.

Out: layouts (phase 2), focus and collections beyond what phase 0 wired (phase 2), chrome.

## Design detail

**One component, one sentence.** The 80×24 table in `docs/ui-design.md` is the spec. Where a sentence
is ambiguous, the fix is to the sentence first, then the component, so the table stays the truth for
the next reader. `tools/arch/kitTable.test.ts` grows a third cross-check: every row in the table has a
component in the TUI table.

**Levels become behaviour.** `support.test.ts` asserts today that every node has a `tui` level. It
adds: a `full` node's component is not the placeholder; a `reduced` node has a written loss; an
`absent` node's component draws nothing and its name in a tree is not a placeholder either; the
`fallback` node draws its `<Fallback>` child when the capability is missing. `roles.test.ts` adds:
`roleCell()` returns a value for every role value on the TUI and returns nothing for `ignored`.

**Colour.** One module, `apps/tui/src/appearance.ts` (new), owns the theme-to-slots mapping. It reads
the same theme record the desktop reads and produces a palette the components read through
`roleCell()`. Style packs are ignored except `density`.

**Virtualised collections.** `Rows` with `virtual` and `Grid` keep their DOM semantics: the visible
window is the rows that fit, `offset` is host state, and the component draws only what fits. OpenTUI
has no virtualiser; the component is one.

## Code touched

- `apps/tui/src/kit/components.ts` (new in phase 0), `apps/tui/src/kit/*.tsx`: about 55 new components.
- `apps/tui/src/appearance.ts` (new).
- `packages/client-core/src/kit/tokens/roles.ts`: `roleCell()`.
- `packages/client-core/src/kit/tokens/support.ts`: losses beside `reduced` levels.
- `packages/client-core/src/kit/tokens/support.test.ts`, `roles.test.ts`: behaviour assertions.
- `tools/arch/kitTable.test.ts`: the third cross-check.
- `apps/tui/vitest.config.ts` (new): the `tui` project.

## Tests

- One buffer test per node in `apps/tui/src/kit/`, asserting the sentence: `Badge` draws `[text]`,
  `Fold` draws `▸ label` closed and `▾ label` open with children indented two cells, `Tabs` brackets
  the selected tab, `StatusDot` draws `●` in the tone's slot and `○` for neutral.
- The three kit invariants above.
- A snapshot of a pane at 80 by 24 and at 120 by 40, to catch a regression in a shared node.

## Docs owed

- `docs/ui-design.md § Every node at 80 by 24`: the `reduced` losses in the table.
- `docs/ui-design.md § What a terminal renderer needs from this`: "tested for presence even though
  nothing reads it" becomes "read by the TUI host".
- `docs/testing.md § Test layers`: the `tui` project.

## Doors left open

- The tree path renders through the same table, phase 5; nothing here assumes a compiled caller.
- Mouse: no component handles a pointer, and the footer never says "click".

## Done when

`KIT_COMPONENTS` on both hosts have the same keys, every kit test passes on both, and the http pane
snapshot at 80 by 24 matches its sentence row by row.

## Verify before building

- `packages/protocol/src/tree/nodes.ts` still lists 70 nodes; count them, the `62 nodes` comments in
  `props.ts` and `components.ts` were stale on 2026-08-30.
- `tools/arch/kitTable.test.ts` still reads `docs/ui-design.md § Every node at 80 by 24` by heading.
- OpenTUI's version still exposes a headless render target for tests.

## What shipped, and where it differs

Seventy-four nodes, not seventy: `KIT_NODES` grew after this file was written, which is what the
verify list below was for. All of them are drawn from `apps/tui/src/kit/`, split by the appendix's own
grouping, and `tools/arch/kitTable.test.ts` now holds three lists to one: the 80×24 appendix, the
support matrix, and both hosts' component tables.

Four things went differently from the plan:

- **The pane at two sizes is Notes, not http.** http ships only a tree bundle, so drawing it means the
  phase 5 sandbox ([findings.md](./findings.md)). Notes is the compiled `list-detail` pane and it is
  what phase 0 drew, so the two runs compare against something.
- **`roleCell()` reads a structured `tui` column rather than parsing prose.** The column was six
  sentences per role; it is now a sentence (`said`) beside the cells the sentence describes, in the
  same entry, so the documentation and the value cannot drift. `roles.test.ts` holds them together and
  writes down which role values draw nothing.
- **The kit lost a prop.** `Markdown`'s `onClick` handed over a DOM event, which findings asked this
  phase to look at. Both its callers wanted the href and the browser on a miss, so `onSelect` returns
  `false` for "not mine" and `onClick` is gone. That is the folder's own rule: where the terminal finds
  a node dishonest, the kit changes for every host.
- **`Table` names the columns it dropped rather than counting them.** A reader who can see that two
  columns are missing still has to widen the pane to learn whether either was the one they wanted.

What was scoped here and is not done, on purpose: the OSC 52 path is written and tested but nothing
presses the button yet, because a `CopyButton` is a focus stop and focus without a DOM is phase 2.
`Rectangle`'s `pty` and `editor` draw their box and say what they are waiting for, for the same
reason — a rectangle is defined by its keys. Both are named in phase 2's scope.
