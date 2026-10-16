# Phase 18: document the shared components

Date: October 15, 2026. Status: done. Needs phase 3. Follows the page rules in
[phase 11](./11-docs-start-and-core.md#how-every-docs-page-is-written).

## Completion note

October 16, 2026. The Components section is generated and published: a page for each of the 83 kit
nodes in six sidebar groups, and the seven concept pages. Every node page has a written purpose, a
picture on both hosts, a props table, its events, its level and loss on each host, its 80 by 24
sentence, its focus role, an example, related nodes, and mistakes.
[Generated reference pages](../../site/references.md#the-component-pages) is the reference for how the
pages are built and checked.

What landed:

- **One generator, two books.** `apps/site/scripts/reference.mjs` builds the plugin reference and the
  components from `BOOKS` in `apps/site/scripts/books.mjs`. The component facts are in
  `apps/site/scripts/componentFacts.mjs`, the written halves in `apps/site/src/content/components/`, and
  the output in a Git-ignored folder of the docs collection. The seven concept stubs moved into the written folder.
  `stale.mjs` reads both books. The shared formatting helpers moved to `apps/site/scripts/factsFormat.mjs`.
- **Facts.** Props from each kit component's type through the TypeScript checker, events, both hosts'
  levels from `NODE_SUPPORT`, focus from `NODE_FOCUS`, and the 80 by 24 sentence from
  `docs/ui-design/every-node.md`. The concept pages generate the support table of every node, the role
  tables from `roles.ts`, the layout regions, the theme swatches from `tokens-theme.css`, the icon set
  with its terminal marks, the focus roles, and `FORBIDDEN_PROPS`.
- **Pictures.** 50 new specimens in `apps/site/specimens/components/`, and eight layout pictures listed in
  `apps/site/specimens/layouts.json`, which both generators draw with each host's real layout component.
  The desktop generator captures a modal's portal, and drops an `<img>` `src` from another origin.
- **Site components.** `SpecimenCode` shows a specimen's source as the example, `IconSet` is the
  filterable icon grid, and `ThemeSwatches` draws the themes. `Specimen` draws a modal's backdrop inside
  its frame.
- **The check.** `apps/site/scripts/components.test.mjs` fails on a node with no page, purpose, or
  picture, or whose pictures don't draw it, and on a fixture node with no group or a page with no
  written half.
- **SDK exports.** `Sections`, `Graph`, `HistoryMark`, `IconButton`, `ConfirmButton`, and `Rectangle` are
  named exports of `acorn-plugin-sdk/remote` and the facade. The two name snapshots grew by those
  names, which an additive change allows under the same major.

The checks: a production build writes 293 pages, and the site's node tests, the budget, and 321
Playwright tests pass. A preview build passes 379. `astro check`, `tsc` in client-core, the site, and
the terminal client, and knip are clean. The specimen chain passes in compare mode, and the SDK, the
facade, and the terminal client's 855 tests pass. The architecture suite fails six checks, none on a
file this phase touched, the six phase 17 recorded.

### Decisions

- **Props come from the kit components' types, not the remote declarations.** The remote declarations
  type only `Pane`, `Stack`, and `TabPanel`. Every other node is an open record, so a table from them
  would be empty. `every-node.md` names a node's exported kit type as its props, and those types carry
  doc comments. Adding a prop to a kit component's type adds its row with no site edit. A function
  outside the 12 events is listed as shell code only, `FORBIDDEN_PROPS` are dropped, and an element
  prop shows as `text`.
- **The 80 by 24 parser is a copy.** It reads the rows with the same pattern `tools/arch/kitTable.test.ts`
  uses. The site can't import from `tools/arch`, and that test holds the table's shape.
- **Written halves are in kebab case under group folders**, such as `inputs/icon-button.mdx`, rather
  than `<Node>.mdx`, so a written path matches its generated path and URL.
- **The groups are data**, `COMPONENT_GROUPS` in `apps/site/scripts/componentFacts.mjs`. Only and Fallback are in
  Rectangles, beside the node they most often serve.
- **One specimen per family where that reads better.** The modal specimen covers `Modal`, `ModalBody`,
  and `ModalActions`, and the table specimen covers its four nodes.
- **Packs are compared through the site's own Appearance control**, above two pictures. The pack CSS is
  scoped to the root, so a page can't show four packs side by side.

### Deviations

- **Six nodes can't be drawn from a tree on any host**: `Rows`, `Menu`, `Popover`, `Sections`,
  `SplitHandle`, and `DiffPane`. Each needs a function prop, such as a trigger or a render, which can't
  cross. Their pages say so and show what a tree uses instead. `NOT_DRAWN_FROM_A_TREE` in the test lists
  them with the reason, and fails once one draws.
- **The pages were checked in a production preview in Chromium**, not in a `dev:agent` session. The
  pages document the kit's contract, and every picture is the hosts' own output.
- **Not split across pull requests.** All six groups landed here, because the generator and the check
  need every node to have a page.

### Problems for their owners

- **Several nodes only half work from a tree**, because a handler they need isn't one of the 12 events:
  `FindBar`'s `onQuery`, `onNext`, and `onPrev`, `DocumentTabs`' `onClose`, `ToggleButton`'s
  `onPressedChange`, and `MentionTextarea`'s `onInput`, whose `onSubmit` sends no text. `RowActions` on
  the desktop shows only its menu button for a tree's actions, because its items are a function.
- **The terminal draws a node inside `EmptyState` as `[object Object]`**, as phase 16 found for a
  `Badge` in a `TableCell`.
- **`DescriptionList` takes item children a tree can't send.** A tree uses `Facts`.
- **The specimen stylesheet is 100 KB, 15 KB compressed**, against about 6 KB with phase 3's ten. Every
  page is inside its budget, but it's loaded on every page.
- **Pre-existing reds on this base**: `pnpm lint` stops at the format check on
  `apps/site/specimens/docs/trust-model.tsx` and `apps/site/src/features.ts`, and client-core's icon
  census wants `bug`, `coins`, and `square-kanban` added to the eager set. Neither comes from this
  change. Both were fixed on the branch afterwards: the two files are formatted, and the census no longer
  scans `apps/site`.

### What later phases need to know

- Phase 19: the component pages' facts are `ReferenceTable`, `IconSet`, and `ThemeSwatches` components,
  so `llms.txt` must render the page, not read its source.
- A new kit node fails the build until it's in `COMPONENT_GROUPS` and has a written half with a picture
  that draws it.

## Goal

Every component a plugin can draw with has a page that shows it on the desktop and in the terminal,
lists its props, says how each host draws it and what it does with focus, and gives an example to copy.
The section explains why the kit is closed, so an author understands why there's no `style` prop before
they go looking for one.

This is where acorn's claim that a plugin works in both clients gets proved, one component at a time.

## Starting point

- The kit has 83 nodes, listed in `KIT_NODES` in `packages/protocol/src/tree/nodes.ts`.
- `NODE_SUPPORT` in `packages/client-core/src/kit/tokens/support.ts` gives each node a level per host,
  `full`, `reduced`, `fallback`, or `absent`, and a sentence on what a reduced node loses.
  `NODE_FOCUS` in `packages/client-core/src/kit/tokens/focusRoles.ts` gives its focus role.
- `packages/client-core/src/kit/tokens/roles.ts` maps each role, such as `tone="danger"` or
  `gap="section"`, to a desktop token and a terminal value.
- `docs/ui-design/every-node.md` has each node's 80 by 24 sentence: what it draws at 80 columns by 24
  rows in monochrome. `tools/arch/kitTable.test.ts` holds that table to the code, so its format is
  stable enough to read.
- The props a plugin can pass are the remote declarations in `packages/plugin-sdk/src/remote/public.ts`.
- `packages/protocol/src/chrome/paneLayouts.ts` lists the eight named layouts and their regions.
- Icons resolve through `packages/client-core/src/kit/tokens/iconNodes.ts`, brand marks through
  `brandMarks.ts` beside it, and the terminal's one-cell glyphs through `apps/tui/src/kit/glyphs.ts`.

## Changes

### 1. Generate the component pages

Extend phase 15's reference generator to write one page per kit node, grouped in the sidebar as
Grouping, Content, Inputs, Collections, Overlays, and Rectangles. Each page has:

| Part | From |
| --- | --- |
| Name and one-line purpose | Written, in `apps/site/src/content/components/<Node>.mdx` (new) |
| Specimens, desktop and terminal | Phase 3, one or more per node |
| Props: name, type, required, and doc comment | The remote declarations, through the TypeScript compiler API |
| On each host: level, what's lost, and the 80 by 24 sentence | `NODE_SUPPORT` and `docs/ui-design/every-node.md`, read with the same parser `kitTable.test.ts` uses |
| Focus: a stop, a collection, or not focusable | `NODE_FOCUS` |
| Events it can send | The 12 semantic events, filtered to the props the node declares |
| Example | Written: the tree code behind the specimen, from its source file |
| Related components and mistakes | Written |

Add the coverage check: every name in `KIT_NODES` has a page, a written purpose, and at least one
specimen.

Write the purposes and examples group by group. 83 is a lot, so split the work by group across
pull requests, and start with the nodes the guides in phases 16 and 17 use most: `Pane`, `Stack`,
`Section`, `Rows`, `Row`, `ListDetail`, `Button`, `IconButton`, `Input`, `Field`, `Select`, `Tabs`,
`Toolbar`, `Alert`, `Badge`, `EmptyState`, `Table`, and `SettingsSection`.

### 2. Write the section's concept pages

| Page | What it must cover |
| --- | --- |
| One kit, two hosts | Why the list is closed, the four rules a node meets to join, how a tree reaches each host, and the support levels. A specimen of a whole pane on both hosts. |
| Roles and tokens | Every role enum with its values, each value's desktop token and terminal value, generated from `roles.ts`. Why a plugin names a meaning, never a pixel or a color. |
| Layouts | The eight named layouts, each as a specimen on both hosts with its regions labeled, and its narrow projection described. Why a layout is a name and never a setting. |
| Icons | Searching the icon set, the icons that load without waiting, brand marks, tones, and which icons have a terminal glyph. A small filter over the eager set, and a link to the full Lucide list for the rest. |
| Themes and style packs | Every built-in theme as a swatch generated from `tokens-theme.css`, every pack compared on one specimen, and how a plugin adds its own. |
| Keyboard and accessibility | Focus stops and collections, what Enter and Escape do, the keys a plugin can and can't claim, no hover-only controls, and what the kit gives you for free. |
| What the kit refuses | The refusals from `docs/ui-design/closed-kit.md`, each with its reason. |

## Out of scope

The kit's internals: CSS layering, the host component tables, and how each host is built. Those stay
in the internal docs.

## Acceptance

- All 83 nodes have a page, a purpose, a specimen on both hosts, and a generated props table.
- The coverage check passes, and fails when a fixture adds a node with no page.
- Adding a prop to a node's remote declaration adds it to the page with no site edit.
- The roles page matches `roles.ts` and updates when it changes.
