# PaletteSurface

The markup half of the overlay palettes: input header + scrollable result list + empty state. The
behaviour half already exists and is good — `createOverlayPalette`
(`packages/client-core/src/palette/overlay.ts`) owns open/query/selection, arrow keys, focus
restore, and single-active coordination. What never got extracted is the DOM, so the same ~30
lines of markup exist **four times in two class vocabularies**. shadcn's Command (cmdk) is the
equivalent — and notably cmdk is *also* split into behaviour + slotted markup.

## Today

Verbatim-duplicate markup (`.overlay-backdrop > .overlay.palette > input.palette-input +
ul.palette-list > li > button.palette-row[.selected] > .palette-label + .palette-hint`):

- `apps/desktop/src/app/client/CommandPalette.tsx:173-204` (⌘K)
- `packages/client-core/src/palette/WorkspacePalette.tsx:47-84` (⌘L)
- `plugins/editor/src/client/FilePalette.tsx:55-92` (⌘P) — a plugin importing
  `@acorn/client-core/palette/palette.css` directly, one of only two CSS files on the boundary
  allowlist (`tools/arch/boundaries.test.ts:272-296`)

Same shape, different class family (`.finder-input/.finder-list/.finder-row/.finder-empty`,
`overlays.css:88-98`):

- `plugins/github/src/client/Shortcuts.tsx:98-133` (the `/` file finder)

## Proposed API

```tsx
export function PaletteSurface<T>(props: {
  palette: OverlayPalette<T>           // the createOverlayPalette instance — behaviour stays there
  placeholder: string
  emptyText: string
  row: (item: T, selected: boolean) => JSX.Element   // label + hint composition per caller
  footer?: JSX.Element                 // hints row ("↑↓ navigate · ↵ open")
})
```

The component renders backdrop/overlay/input/list and wires the palette's handlers; each caller
keeps its own row body (the palettes render label+hint, the file finders render dir+name).

## How to build it

- `packages/client-core/src/palette/PaletteSurface.tsx` — beside the hook, not in `ui/`: it
  imports `createOverlayPalette`'s types, and `ui/`'s purity allowlist already carves out
  `palette/model.ts` only. (Alternatively: loosen the allowlist to `palette/`; either is
  defensible — decide with the boundaries test open.)
- CSS stays `palette/palette.css`; the `.finder-*` family in `overlays.css` gets deleted after
  github migrates.
- Export for plugins on `@acorn/plugin-api/ui/host` (palettes are host surfaces — they use shell
  focus machinery; a sandboxed frame cannot open one). The editor plugin's direct CSS import then
  disappears, shrinking the boundary allowlist by one.

## Refactors

- CommandPalette, WorkspacePalette — mechanical; behaviour untouched.
- editor's FilePalette — removes the cross-boundary CSS import.
- github's Shortcuts finder — removes the `.finder-*` vocabulary and its near-duplicate markup.

## Notes

- Do NOT try to also absorb `Picker` (anchored, filtered, non-modal) or `Modal` — the three-way
  distinction (palette / picker / modal) is already well-argued in `Modal.tsx:8-12` and
  `dismissable.ts:10-11`; this component completes the palette leg only.
