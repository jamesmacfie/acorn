# Doors left open: what the PWA and the terminal need from every phase

Part of [docs/future/layout/](./README.md). This programme builds desktop only. A mobile PWA comes
next and a terminal renderer last, and the owner's instruction is that nothing here may make either
harder. This file is the checklist every phase's "doors left open" section is measured against, and
the list of things that are never done.

## For the PWA

The mobile client is a browser talking to a node, so it is the same DOM host with different widths
and a different shell. `docs/future/remote.md` owns the auth inversion, the node serving the shell,
and TLS; nothing here changes those. What this programme owes it:

- **Every layout carries a narrow projection** in [05-layouts.md](./05-layouts.md), written before the
  layout lands. `list-detail` becomes one region at a time; `document-over-frame` collapses the frame
  region to a sheet.
- **Breakpoints are style tokens**, not numbers inside a layout, so the mobile shell can set them.
- **`formFactor` on surfaces stays** (`packages/protocol/src/pluginContract.ts`). A rectangle that
  only makes sense on a wide screen says `['desktop']` and the mobile shell hides it rather than
  mangling it.
- **Kit nodes have no desktop-only assumption without a support row.** Hover is never load-bearing.
  Tooltips have a focus equivalent. Nothing reads `window` width.
- **The subset shell stays a decision.** `remote.md` argues mobile is a focused subset (attention,
  agent status, approvals, task list, start a task), not the workspace squeezed down. Host-owned
  layouts make that subset cheap; they do not decide what is in it.

## For the terminal

A terminal host cannot run the web renderer, so it needs the tree, the kit, the layouts, and the
keymap to be honest about intent. `docs/future/terminal.md` owns the host itself. What this
programme owes it:

- **Every kit node has an 80×24 monochrome sentence** in [04-kit.md](./04-kit.md) and a row in
  `NODE_SUPPORT` with a `tui` column, tested for presence even though nothing reads it.
- **Every layout has a terminal projection** in [05-layouts.md](./05-layouts.md).
- **Role tokens never expose pixels.** `space.row`, never `gap: 8`. Each role has a documented
  terminal value, including `ignored`.
- **The keymap core is host-agnostic.** `@opentui/keymap`'s terminal adapter exists in the same
  package; acorn adds no key handling outside it.
- **Intents, never keys.** A node handles `next`, not `ArrowDown`. A terminal maps `j` to `next`
  without touching the kit.
- **Collection state is host-owned**, so a cell-buffer host keeps `active`, `selected`, and `offset`
  the same way.
- **The tree protocol names nothing about the DOM.** Mutations apply to any retained tree.
- **Rectangles are the only DOM-only thing**, and `Rectangle kind="pty"` is native in a terminal.
- **The PTY stays owned by the terminal plugin** through `ctx.events.streams`; a terminal host renders
  it directly and needs no new seam.

## Never do these

Each one reopens a door this programme is closing. They are refused for the life of the design, and
[refused.md](./refused.md) holds the argument.

1. No `class`, `className`, or `style` prop on any kit node, even "just for desktop."
2. No raw scale value in a plugin-facing enum. `space.row`, never `space.3` or a number.
3. No plugin-positioned layout. A plugin picks a layout; it never says where a region goes.
4. No key event reaches a plugin outside `Input`, `Textarea`, `Composer`, and the inside of a
   rectangle.
5. No second keymap. One engine, one command catalog, adapters per host.
6. No kit node without a support row and an 80×24 sentence.
7. No layout without both projections written down.
8. No iframe inside an iframe; `frame-src 'none'` stays.
9. No `postMessage` between plugin origins that the host does not carry and validate.
10. No static widget schema. Logic stays in plugin code; the wire is a tree of kit nodes.
11. No hover-only affordance.
12. No node that reads `window`, the pointer, or a key code.

## How a phase satisfies this file

Each phase file ends with a "doors left open" section that names, for that phase's work, which
items above it touched and how it held them. Phase 9's test pass includes the support-matrix,
role-mapping, and no-class tests as permanent invariants, so the doors stay open after the programme
ends.
