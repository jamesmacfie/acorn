# Skeleton

A shaped loading placeholder that mimics the content it stands in for. shadcn has Skeleton;
Bootstrap has Placeholders. acorn has **zero** — every loading state is text ("Loading…",
"Searching…", "...") or, in the best case, `EmptyState busy` / `Spinner`. This doc exists to
record a deliberate position: **build the row-skeleton only, and only after EmptyState lands.**

## Today

- No skeletons anywhere in shell or plugins (confirmed across all four survey passes).
- The closest thing: the diff toolkit synthesizes `{kind:'load'}` rows so `NonCodeRow` draws an
  in-flow placeholder (`DiffForPull.tsx:123`) — a domain-specific skeleton, and the proof the
  pattern earns its keep in virtualized lists where a centred spinner would jump.
- Everything else that "loads" is a pane (EmptyState `busy` covers it) or a button
  (`Button busy` covers it).

## Where a skeleton would actually pay

Lists that hydrate row-by-row with known geometry:

- github's PR list (virtualized, `rowHeightSm` is already a shared token — skeleton rows can be
  exactly row-height)
- rollbar's occurrence list, docker's container list, agents' AgentCenter grid

Panes, headers, and detail views should NOT get skeletons — the app's serve-then-revalidate cache
means most surfaces render real data instantly, and a skeleton that flashes for 40ms is worse
than nothing.

## Proposed API

```tsx
export function SkeletonRow(props: {
  lines?: 1 | 2               // title, or title+meta
  leading?: boolean           // dot/avatar placeholder circle
  class?: string
})
```

A row-shaped shimmer matching `Row`'s geometry (`--row-h` / `rowHeightSm`), not a generic
rectangle — generic rectangles invite skeleton-screens-everywhere, which fights the app's dense
instant-feel aesthetic.

## How to build it

- `packages/client-core/src/ui/primitives.tsx`; `.ui-skeleton` in `styles/primitives.css`
  (frame-served). Shimmer via a background-position animation on `--bg-hover`→`--bg-subtle`,
  gated on `prefers-reduced-motion` (static blocks when reduced).
- `aria-hidden="true"` — the accessible loading signal is the container's `aria-busy`/`role=status`
  (EmptyState `busy` or the list's own live region), never the skeleton itself.
- Export from `@acorn/plugin-api/ui`.

## Refactors

- None mandatory. Adopt opportunistically in the four lists above when they're touched; the
  loading-text cleanups should go to `EmptyState busy` first (see
  [empty-state.md](./empty-state.md)).

## Notes

- Lowest priority in this folder. If it never ships, nothing is broken — which is exactly why
  it's documented separately instead of bundled into EmptyState.
