# Phase 4: draw each layout's narrow projection

Date: October 17, 2026. Status: proposed. Check it in the [phase 2](./02-shell.md) shell. Can run
beside [phase 3](./03-narrow-mode.md), but reads `formFactor()` from it.

## Goal

Every host layout draws the narrow projection that [pane layouts](../../panes/layout.md#named-layouts)
wrote down, and so does the kit's `ListDetail` component. A plugin gets each one with no change of
its own, apart from one new field on the four panes that use `list-detail`.

## Starting point

- The desktop browser's layouts are in `packages/client-core/src/host/layouts`. The host's table
  seam is `packages/client-core/src/host/layouts/table.ts`, which the terminal uses to supply its own.
- The terminal's `apps/tui/src/layouts/ListDetail.tsx` draws both widths in one component: two
  columns from 80 cells, one column below, with a key to switch.
- `LayoutProps` in `packages/client-core/src/host/layouts/regions.ts` already has `hidden`, which drops
  a region and gives its space to the rest.
- Agents, git, notes, and workflows name `list-detail`. Ten plugin files use the kit's `ListDetail`
  (`packages/client-core/src/kit/components/layout/ListDetail.tsx`), among them the editor, the
  database, Linear, and Rollbar.
- The kit has a `Drawer` overlay (`packages/client-core/src/kit/components/overlays/Drawer.tsx`).

## The design

Each layout component branches on `formFactor()`, the way the terminal's branches on width. Keep one
component per layout, so the desktop and the phone can't drift apart. Don't add a second layout
table. The form factor is fixed for a boot, so the branch never remounts a region.

| Layout | Narrow projection |
| --- | --- |
| `single`, `header-body-footer`, `wizard` | No change. Check that a pinned footer stays above the on-screen keyboard. |
| `tabs` | The bar scrolls sideways. Check whether `packages/client-core/src/kit/components/layout/tabScroll.ts` already does this. |
| `list-detail` | One region at a time. See below. |
| `document-over-frame`, `frame-beside-document` | The document fills the pane. The frame region opens in a `Drawer` from a button in the document's header. |
| `stack-split` | The top fills the pane. The bottom opens in a full-height `Drawer`. |

No layout draws a split handle or a collapse-to-rail control when narrow.

### Push the detail when the person picks something

A narrow `list-detail` needs to know when someone picked a row, and the layout can't see the pane's
selection. Add one field to the pane contribution, passed through `LayoutProps`:

```ts
/** `list-detail` only. What the list has selected, as a key, or null. */
selection?: (task: Task, model: M) => string | null
```

The layout keeps its own record of which half shows. When `selection` changes to a key, it shows the
detail. **Back**, at the top of the detail, shows the list and leaves the selection alone, so going
back and forward again lands on the same item. With no key, it shows the list.

The four panes each derive the key from the selection they already keep: the agent session, the
git change, the note, and the workflow run. The kit's `ListDetail` takes the same value as a prop, so
a tree sends it as data like any other prop.

A pane with no `selection` field shows the list and offers a **Show detail** button. That keeps an
outside plugin usable before its author adds the field.

## Steps

1. Add the narrow branch to `ListDetail` in the host layouts, with the `selection` field and **Back**.
2. Add `selection` to the four panes.
3. Do the same for the kit's `ListDetail`, and pass it in the ten plugin files that use it.
4. Add the `Drawer` projection to `DocumentSplit` and `StackSplit`.
5. Check `tabs` and the three unchanged layouts in the phase 2 shell.
6. Fill in the "Narrow" column of [pane layouts](../../panes/layout.md#named-layouts) with what
   shipped, and document `selection` in [layout model](../../panes/layout.md#layout-model).

## Acceptance

- `packages/client-core/src/host/layouts/layouts.test.tsx` covers each layout's narrow projection:
  which regions mount, the selection push, **Back**, and the drawer.
- In the phase 2 shell, you can open an agent session, a git change, a note, and a workflow run, and
  get back to each list.
- The desktop's layout tests pass unchanged.
