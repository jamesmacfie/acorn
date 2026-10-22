# Phase 4: draw each layout's narrow projection

Date: October 17, 2026. Status: shipped October 21, 2026. Check it in the [phase 2](./02-shell.md) shell. Can run
beside [phase 3](./03-narrow-mode.md), but reads `formFactor()` from it.

## Completion note

Completed October 21, 2026. [Pane layouts](../../panes/layout.md#narrow-list-detail) owns the shipped
behavior, and [two-column panes](../../ui-design/two-column-panes.md#narrow) owns the kit node's.
[Mobile web app](../../mobile/narrow-mode.md#narrow-layouts) lists the projections. This page keeps what the later
phases need.

### What landed

- `list-detail` in the host layouts and the kit's `ListDetail` show one column at a time. The pane
  field is `selection?: (task, model) => string | null` on `PaneLayoutContribution`, passed to the
  layout as `LayoutProps.selection`. The kit node takes `selection` as a prop. Both share
  `createNarrowView` (`kit/lib/layout/narrowView.ts`) and the `ViewSwitch` control (**Back**, **Show
  detail**).
- `RegionSheet` (`host/layouts/RegionSheet.tsx`) draws **Show panel** and the kit's `Drawer` for
  `document-over-frame`, `frame-beside-document`, and `stack-split`. On a phone every `.ui-drawer` is a
  full-screen sheet (`overlays.css`).
- `selection` on five panes: Agent, Git, Notes, Workflows, and Apps. The kit node gets it from Editor,
  Database, Docker, Linear, Rollbar's error list and occurrence list, and the workflow editor. The terminal's
  `ListDetail` accepts and ignores the prop.
- Tests: `layouts.test.tsx` (the narrow projections), `ListDetail.test.tsx` (the kit node), and
  `panes.test.tsx` (`selection` reaching the layout).

I checked it in Chromium at 390 by 844 against a throwaway standalone Node, through the phase 2 shell.
Git opens on a change with **Back** above it. **Back** shows the list, **Show detail** returns to the
same change, and tapping the other file pushed its diff. Notes shows its list and **Show detail**.
Agent with no sessions shows its list and no **Show detail**, because there is nothing to show. Editor
opens on the file tree and a tap on a file shows the editor. No contribution failed. The screenshots
are in
`/Users/jamesmacfie/Source/acorn/apps/node/.acorn/worktrees/jamesmacfie-acorn-phase-4-narrow-layouts/references/mobile-phase-4/`,
a folder git ignores. They aren't committed. The desktop's layout tests pass unchanged.

### Decisions and deviations

- **Apps also names `list-detail`, so it got `selection` too.** This page counted four panes.
- **Workflows reports the step, not the run.** The detail draws the selected step, and a run selects its
  first step, so `runId:stepId` moves on either pick. Keying on the run alone left a tap on a step with
  no visible effect.
- **A pane that reports a key opens on its detail.** Git, Agent, Notes, Workflows, and Apps keep a
  default selection once their data loads, so a phone lands on the detail with **Back** above it. The
  phone's top bar has its own back arrow to the task list, so two backs sit stacked at the top.
- **A second tap on the selected row changes nothing.** The layout sees keys, not taps. **Show detail**
  is offered whenever the selection isn't null, which is the way forward from there. This page's design
  offered it only for a pane with no `selection` field.
- **Git's key is the open tab's.** Switching tabs onto one with a remembered selection can push its
  detail, because the key changed. I left it.
- **The kit reads the root attribute itself.** An architecture rule keeps `kit/` from importing `infra/platform`, so `isNarrow()` in `kit/lib/layout/narrowView.ts` reads the attribute `formFactor()` reads. The host layouts call `formFactor()`.
- **The kit node keeps both columns mounted and hides one with CSS** (`data-view` on the root), because
  the caller builds both as elements. The host layout mounts only the showing region. A closed
  `RegionSheet` mounts nothing, so closing one drops the frame region's own state. A region that has to
  keep it holds it in the pane's model.
- **The sheet's button is a bar above the first region, not in the document's header.** The document's
  header belongs to the host editor. The label is the plain **Show panel**.
- **Three of the ten kit-node callers pass no `selection`.** Agent Center has only a detail column and
  isn't a split. GitHub's new pull request form and the Git revision's details have no row to pick, so
  they keep **Show detail**.
- **`tabs` needed nothing.** `Tabs` already scrolls sideways through `trackTabOverflow`.
- **The drawer's phone geometry is in `overlays.css`,** keyed on the root attribute. `narrow.css` only
  sets tokens and the drawer's inset isn't one.

### What later phases need

- Phase 5 opens the Agent pane on one session by calling `selectManagedSession(taskId, sessionId)`,
  which moves `selectedSessionId` and so the pane's `selection`. The pane then shows the conversation. A
  session that is already selected stays on whatever half was showing, so a link should also open the
  pane through `openPane`, and the user can press **Show detail**.
- `selection` is read for every pane that names `list-detail`, so phase 5's **New task** flow needs no
  change to use it.
- Not checked: a pinned footer staying above the on-screen keyboard. Desktop Chromium has no keyboard.
  That belongs to the real-device pass in [phase 6](./06-on-a-phone.md).
- Not checked in the shell: the sheet layouts (`document-over-frame`, `stack-split`), because no
  built-in plugin uses them and loaded plugins don't run on the phone yet. The unit tests cover them.

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
