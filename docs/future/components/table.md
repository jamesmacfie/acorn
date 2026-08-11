# Table

A token-styled static table for small data sets: pricing rows, import lists, header dumps. shadcn
has Table (+ DataTable over TanStack); Bootstrap has Tables. acorn's shell made a *deliberate*
decision against tables for its own lists (`settings.css:193-195`: a table "would give six columns
equal weight") — that decision is right for navigational lists and should stand. But three
surfaces genuinely are tabular, and each invented its own grid system.

## Today

- agents: `.agent-pricing-table` — raw `<table>` ×2 inside an h-scroll wrap, number inputs in
  cells, sr-only actions header (`AgentPricingSettings.tsx:189-243,268-324`, `agent-pricing.css`)
- agents: `.agent-center-list` — a CSS-grid pseudo-table with a header row and
  `.ui-row > .ui-row-body { display: contents }` contortions (`AgentCenter.tsx:234-269`,
  `agent-center.css:91-143`)
- github: `.github-import-list` — CSS-grid two-column rows with hint lines (`GithubImporter.tsx:88-107`,
  `importer.css:23-51`)
- Explicitly out of scope: the virtualized grids (`ResultGrid`'s `.dbgrid`, the diff rows) — same
  exclusion `Row` documents for measured geometry (`primitives.tsx:157-159`); and the `<dl>` facts
  ([description-list.md](./description-list.md)).

## Proposed API

```tsx
export function Table(props: {
  size?: 'sm' | 'md'
  stickyHead?: boolean
  minWidth?: number               // wraps in the h-scroll container when set
  class?: string
  children: JSX.Element           // native <thead>/<tbody>/<tr>/<th>/<td>
})
```

Deliberately thin: real `<table>` semantics, token styling, an overflow wrapper — no column defs,
no sorting, no virtualization. When a consumer needs sorting it can grow a `Table.SortHeader`;
nothing needs it today.

## How to build it

- `packages/client-core/src/ui/primitives.tsx`; `.ui-table` in `styles/primitives.css`
  (frame-served). Hairline row dividers via `--divider`, header via the `--label-*` typography
  tokens (matching SectionHeader's group level), cell padding from density tokens so packs
  compress it.
- The h-scroll wrapper is part of the component (`data-scroll` on a wrapping div) — both current
  `<table>` sites hand-rolled it; artifact-style overflow bugs come from forgetting it.
- Export from `@acorn/plugin-api/ui`.

## Refactors

- agents' two pricing tables — near-mechanical (they're already `<table>`).
- github's importer list — becomes `<Table>` or stays a Row list; judge by whether the hint-line
  row keeps table semantics honest (a `<td colspan>` works).
- agents' AgentCenter grid: the `display: contents` hack exists because `Row` was forced into
  table duty. Either adopt `Table` (losing Row's selection styling) or keep Rows and drop the
  header alignment ambition — the doc-comment should present both; the hack should not survive.

## Notes

- The shell's audit/plugin/device lists stay lists. If someone reaches for Table for a
  navigational list, `settings.css:193-195` is the counter-argument to link.
