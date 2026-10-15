# Phase 18: document the shared components

Date: October 15, 2026. Status: proposed. Needs phase 3. Follows the page rules in
[phase 11](./11-docs-start-and-core.md#how-every-docs-page-is-written).

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
