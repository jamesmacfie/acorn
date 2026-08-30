# Phase 1: the kit's Table owns its rows

Status: not started. Waits on nothing.

## Goal

`Table` stops taking raw `<thead>`/`<tr>`/`<th>`/`<td>` children. The kit gains `TableHead`,
`TableRow`, and `TableCell`, every caller migrates, and the support matrix's promise for `Table` on
the terminal — box-drawn, truncating columns by priority — becomes something a host could actually
keep, because it finally sees the rows.

## Why this phase, and why now

`Table` in `packages/client-core/src/kit/components/primitives.tsx` is a scroll container around a
bare `<table>` whose children are whatever JSX the caller writes. Every caller therefore writes row
markup the closed kit forbids everywhere else: the agents pricing page
(`plugins/agents/src/client/settings/AgentPricingSettings.tsx`), the shortcut cheat sheet
(`packages/client-core/src/host/keys/CheatSheet.tsx`), and the dashboards table view
(`packages/client-core/src/features/dashboards/views/TableView.tsx`). The support matrix
(`packages/client-core/src/kit/tokens/support.ts`) lists `Table` as `tui: 'reduced'`, but a terminal
host cannot truncate columns it receives as opaque DOM. This is the kit being dishonest, which is
exactly what the terminal programme said gets fixed in the kit for every host, not worked around.
It is also the only thing standing between the pricing page and kit purity, so it sits between
phases 0 and 7 on the critical path to an empty baseline.

## Scope

In:

- Three new kit nodes: `TableHead` (column labels, one per column, an alignment token, a priority
  for truncation), `TableRow`, `TableCell` (content, alignment, an optional header flag for row
  headers). Compound halves of `Table` the way `ListColumn` and `DetailColumn` are halves of
  `ListDetail`.
- `Table` narrows its `children` to those nodes in substance; the scroll container, `size`,
  `stickyHead`, and `minWidth` stay as they are.
- Rows in `support.ts`, sentences in `docs/ui-design.md` § Every node at 80 by 24, entries in the
  DOM host's component table (`packages/client-core/src/host/tree/components.ts`), and the tree
  protocol's node list, so a loaded plugin can emit them.
- All three callers migrate. The pricing page keeps five editable `Input` cells per row — a
  `TableCell` holds kit children like any other container node, editability is not special.

Out: sorting, selection, virtualization, column resizing. Nothing in the tree wants them; a
dashboard that outgrows this asks the kit again with a caller in hand. Also out: any change to
`Grid`, which is a different node with a different sentence.

## Design detail

**Why nodes and not a columns prop.** A `columns`/`rows` data prop was considered and refused
([refused.md](./refused.md)): the pricing page's cells are `Input`s with handlers, and data props
would need a renderer-function escape hatch, which is a schema growing an `if`. Child nodes keep
cells as ordinary kit trees, which is what the remote tree protocol already serializes.

**The admission conditions, walked.** Three callers today, so the "two consumers" bar is cleared
before the node exists. The 80 by 24 sentence: `TableHead` is one bold line; `TableRow` is one line,
cells separated by a box-drawing vertical, truncated by column priority with the loss named in the
header — which is the sentence `Table` already carries, now enforceable. No focus role beyond what
the cells' own children carry. No `class`, no `style`, alignment as an enum.

**Truncation priority lives on the column, not the host.** `TableHead` takes the priority so the
plugin says which columns survive narrowing; the DOM host may ignore it (CSS handles overflow), the
terminal host must not. That keeps the narrowing decision with the author, which is the same rule
the layouts follow.

## Code touched

- `packages/client-core/src/kit/components/primitives.tsx` (or a split-out table file if it crowds
  the primitives — follow the folder's local convention)
- `packages/client-core/src/kit/tokens/support.ts`
- `packages/client-core/src/host/tree/components.ts`, the tree protocol node list under
  `packages/protocol/src/tree/`
- `plugins/agents/src/client/settings/AgentPricingSettings.tsx`
- `packages/client-core/src/host/keys/CheatSheet.tsx`
- `packages/client-core/src/features/dashboards/views/TableView.tsx`

## Tests

- `tools/arch/kitTable.test.ts` already fails if the kit and the 80 by 24 table disagree; the new
  rows make it pass, which is the test that the paperwork happened.
- A jsdom test per migrated caller: the pricing page still edits a price and resets a row; the cheat
  sheet still lists a binding; the table view still renders a collection row.
- A type-level check that `Table` refuses a raw `<tr>` child, alongside the existing prop tests in
  `packages/client-core/src/kit/tokens/props.test-d.ts`.

## Docs owed

- `docs/ui-design.md` § Every node at 80 by 24: three new rows, and `Table`'s row loses nothing but
  gains the note that truncation priority is author-declared.
- `docs/ui-design.md` § The closed kit, if it enumerates node counts anywhere.
- See [docs-migration.md](./docs-migration.md).

## Doors left open

1. Column sorting as a host-owned affordance over `TableHead`, if a dashboard asks.
2. A `rows`-as-data convenience for the read-only case, layered over the nodes rather than beside
   them.

## Done when

- No caller of `Table` writes a raw table element; a grep for `<thead`, `<tr`, `<td`, `<th` outside
  the kit's own table implementation returns nothing in `packages/client-core/src` and `plugins/`.
- The three callers render and behave as before.
- `kitTable.test.ts`, the support tests, and `pnpm lint` are green.

## Verify before building

- `Table` in `primitives.tsx` still takes bare `children: JSX.Element` and the three callers named
  above are still the only ones writing raw row markup (grep `<tbody`/`<thead` across the tree).
- `support.ts` still lists `Table: { dom: 'full', tui: 'reduced' }`.
- The four admission conditions are still the ones written at `docs/ui-design.md` § The closed kit.
- The tree protocol's node list still enumerates kit names explicitly (a new node is a wire change).
