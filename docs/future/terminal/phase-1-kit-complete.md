# Phase 1: the whole kit

Status: not started. Waits on phase 0.

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

- `apps/tui/src/kit/components.ts` (new in phase 0) becomes `Record<KitNodeName, Component>`, complete, no `Partial`.
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
- A snapshot of the http pane at 80 by 24 and at 120 by 40, to catch a regression in a shared node.

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
