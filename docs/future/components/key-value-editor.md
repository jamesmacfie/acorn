# KeyValueEditor

An editable rows grid: enable-checkbox, name, value, remove — with an auto-materializing blank
row. The HTTP panel's params/headers/variables tables. No direct shadcn/Bootstrap equivalent
(both stop at static tables); Postman/Insomnia-style apps all converge on this control, and acorn
already has a good one — it's just private to one plugin, and its author already exported it as if
hoping someone would share it.

## Today

- `plugins/http/src/frame/RequestTabs.tsx:19-61` — `KeyValueTable`: `role="table"` div grid
  (`.http-grid`), header row, rows of checkbox + 2 `Input`s + remove `Button`, trailing blank row
  auto-added (`:21`) and dimmed via `.is-blank` (`http.css:242-244`). **Already exported from the
  module** (`RequestTabs.tsx:241`) — a one-consumer export is a request for a home.
- `plugins/http/src/frame/HttpVariables.tsx:97-141` — same `.http-grid` re-used with a 5-column
  override, plus a per-row hint spanning row 2 (`.http-grid-hint`) and a kind `Select`.
- Cousins that should NOT merge in: github's importer list (static rows + actions →
  [table.md](./table.md)), the read-only `<dl>`s ([description-list.md](./description-list.md)),
  agents' pricing tables (numeric grid → table.md).

## Proposed API

```tsx
export type KVRow = { id: string; enabled?: boolean; key: string; value: string }

export function KeyValueEditor(props: {
  rows: readonly KVRow[]
  onChange: (rows: KVRow[]) => void      // including the auto-blank materialization
  columns?: readonly {                    // extra columns (HttpVariables' kind select)
    id: string; header: string; render: (row, update) => JSX.Element
  }[]
  rowHint?: (row: KVRow) => string | undefined   // the spanning hint line
  enableColumn?: boolean                  // default true
  keyPlaceholder?: string
  valuePlaceholder?: string
  ariaLabel: string
})
```

Controlled and dumb: the blank-row invariant (always exactly one trailing empty row) lives inside,
everything else is the caller's data.

## How to build it

- This is a *composite*, not a primitive — it belongs above the primitives layer. Home:
  `packages/client-core/src/ui/KeyValueEditor.tsx`, built from `Checkbox`, `Input size="sm"`,
  `Button iconOnly`, with `.ui-kvgrid` CSS in `styles/primitives.css` (frame-served — its only
  current consumers are frames).
- Solid gotcha the current code already respects: render rows with `<Index>`, not `<For>` —
  editable inputs keyed by reference lose focus per keystroke (this is a recorded repo gotcha).
  Preserve that behaviour in the port.
- `role="table"`/`row`/`cell` markup carried over from the http implementation (it's correct).
- Depends on [checkbox.md](./checkbox.md) landing first, or ships with raw checkboxes and migrates.
- Export from `@acorn/plugin-api/ui`.

## Refactors

- http's `KeyValueTable` (delete, redirect the export) and `HttpVariables`' grid (via `columns` +
  `rowHint`). Two consumers on day one, both in one plugin — which is fine; the component's real
  justification is that the *next* API-shaped plugin (GraphQL panel, env editor, webhook tester)
  gets it free.

## Notes

- If `columns` turns out to be over-general for HttpVariables' one extra select, drop it and give
  the component a single `kindColumn` — judge during the port, not now.
