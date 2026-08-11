# TreeRow

A disclosure row for hierarchies: twist glyph, expanded state, nesting depth, selection — the
row-level building block for file trees, container groups, and grouped request lists. shadcn has
no tree (the ecosystem hand-rolls on Collapsible); Bootstrap likewise. acorn hand-rolls it in four
places with literal `▸/▾` glyphs and inconsistent (mostly absent) tree semantics — while `Row`
already owns the adjacent problem (selection, leading/trailing slots, activate wiring) and even
has a `nested` boolean waiting.

## Today

- editor: `FileTree.tsx:42-115` — recursive `<ul class="tree">`, `.tree-dir`/`.tree-file` buttons,
  `.tree-twist` with literal `▾/▸`, spacer twist for files, `classList={{active}}`; **no
  aria-expanded, no role=tree/treeitem**
- docker: `.docker-group-header` with hand-written `role="button" tabindex=0` + Enter/Space
  handler ×2, `.docker-group-chevron` glyph, collapse in a `Set` (`DockerBrowse.tsx:146-258`) —
  `Row`'s own docstring names this exact duplication (`primitives.tsx:156`)
- http: `.http-tree` flat groups — folder label + rows with hover-revealed actions
  (`HttpPanel.tsx:201-223,319-349`)
- context: `.context-tray-expand` twist buttons, two markups in one file
  (`ContextPane.tsx:164-167,206-213`)

## Proposed API

```tsx
export function TreeRow(props: {
  expandable?: boolean
  expanded?: boolean
  onToggle?: () => void
  depth?: number                  // indentation via calc(var(--space-6) * depth)
  selected?: boolean
  onActivate?: () => void         // open the file / select the container
  leading?: JSX.Element           // Icon / StatusDot / method chip
  trailing?: JSX.Element          // hover-revealed actions
  title?: string
  class?: string
  children: JSX.Element
})
```

Built on `Row` (it *is* a Row with a twist slot and depth) — either as a `Row` prop cluster or a
thin wrapper component; wrapper preferred so `Row`'s API stays flat. The twist renders from tokens
(`--marker-w`, rotate transition), not glyph literals, and carries `aria-expanded`.

Container semantics (`role="tree"`/`role="treeitem"`/`aria-level`) stay at the call site — a
`TreeRow` can't know its tree. Provide a short "how to wire the container" note in the JSDoc; full
roving-focus tree navigation is a later layer if a consumer needs it (editor's tree is the
candidate).

## How to build it

- `packages/client-core/src/ui/primitives.tsx` beside `Row`; `.ui-row[data-depth]` + `.ui-row-twist`
  in `styles/primitives.css` (frame-served — http's tree is a frame consumer).
- Depth indentation replaces editor's nested-`ul` padding and generalises `Row`'s single `nested`
  boolean (keep `nested` as `depth={1}` alias).
- Hover-revealed `trailing` is the shared `data-reveal` behaviour (see Row extensions in the
  [README](./README.md)) — implemented once here, reused by plain rows.

## Refactors

- docker's group headers + rows — deletes both hand-written key handlers (the exact debt
  `Row`'s comment predicted).
- editor's FileTree — keeps its recursive structure, swaps `<li>` internals for TreeRow; gains
  aria-expanded.
- http's TreeRow local component (same name, conveniently) and folder labels
  (`SectionHeader level="group"` for the label + TreeRow for rows).
- context's two expander markups (also candidates for
  [collapsible-section.md](./collapsible-section.md) — pick by whether the thing is a *section*
  or a *row*; context's items are rows).

## Notes

- Virtualized trees are out of scope, same as `Row`'s exclusion of virtualized rows — the
  editor tree is lazy-loaded but not virtualized, so this holds today.
