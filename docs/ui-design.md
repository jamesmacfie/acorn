# UI design

acorn's UI is a dense, keyboard-driven workspace. Theme tokens set color and style packs set shape and
density, so you choose each separately, and plugins draw with a closed kit of components that both the
desktop and the terminal client can render. Read this page to find the topic page that owns a design
rule.

The kit lives in `packages/client-core/src/kit/` and reaches plugins through `@acorn/plugin-api/ui`.
The shared stylesheets are in `packages/client-core/src/infra/styles/`.

## Pages

[Shell hierarchy](./ui-design/shell-hierarchy.md) covers the desktop and terminal shell, chrome bars,
text and headings, and rail controls with their status markers.

[Appearance](./ui-design/appearance.md) covers themes, style packs, plugin themes and packs, and the
role tokens with their desktop and terminal values.

[Design tokens](./ui-design/tokens.md) covers the token axes, tokens outside both axes, runtime-set
custom properties, border roles, and style pack files.

[The closed kit](./ui-design/closed-kit.md) covers what a node needs to join the kit, its special
nodes, its invariants, and what it refuses.

[How the kit is built](./ui-design/kit-internals.md) covers CSS layering, the behavior nodes take over
from panes, how `Timeline` keeps your place, and `Markdown` rendering.

[Every node at 80 by 24](./ui-design/every-node.md) lists every kit node with its focus role and its
terminal rendering, and what the kit owes a terminal host and a mobile web app.

[Icons](./ui-design/icons.md) covers `Icon`, `IconButton`, which icons load eagerly, and brand marks.

[Two-column panes](./ui-design/two-column-panes.md) covers `ListDetail`, its columns, and collapsing
a list to a rail.

[Chrome, overlays, and dialogs](./ui-design/overlays.md) covers floating host UI, the drawer, toasts,
dialog shape and focus, and drag-to-resize.

[Tooltips](./ui-design/tooltips.md) covers tooltip attributes, positioning, tips in plugin frames,
and the help mark.

[Interaction rules and menus](./ui-design/interaction.md) covers the keyboard rules, the menu
surface, right-click, confirmation, and row actions.

[States and accessibility](./ui-design/states.md) covers interaction states, the connection and
staleness vocabulary, empty states, and the shared accessibility rules.
