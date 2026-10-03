# UI design

acorn's UI is a dense, keyboard-driven workspace. Theme tokens set color and style packs set shape and
density, so you choose each separately, and plugins draw with a closed kit of components that both the
desktop and the terminal client can render. Read this page to find the topic page that owns a design
rule.

The kit lives in `packages/client-core/src/kit/` and reaches plugins through `@acorn/plugin-api/ui`.
The shared stylesheets are in `packages/client-core/src/infra/styles/`.

## Pages

<a id="shell-hierarchy"></a>
<a id="rail-controls-and-status-markers"></a>
<a id="rail-controls"></a>

[Shell hierarchy](./ui-design/shell-hierarchy.md) covers the desktop and terminal shell, chrome bars,
text and headings, and rail controls with their status markers.

<a id="appearance"></a>
<a id="plugin-themes"></a>
<a id="plugin-style-packs"></a>
<a id="roles-and-what-each-host-makes-of-them"></a>

[Appearance](./ui-design/appearance.md) covers themes, style packs, plugin themes and packs, and the
role tokens with their desktop and terminal values.

<a id="token-axes"></a>
<a id="runtime-set-custom-properties"></a>
<a id="border-roles"></a>
<a id="style-packs"></a>

[Design tokens](./ui-design/tokens.md) covers the token axes, tokens outside both axes, runtime-set
custom properties, border roles, and style pack files.

<a id="the-closed-kit"></a>
<a id="the-three-kit-invariants"></a>
<a id="what-the-kit-refuses"></a>
<a id="what-the-kit-and-layouts-must-never-do"></a>

[The closed kit](./ui-design/closed-kit.md) covers what a node needs to join the kit, its special
nodes, its invariants, and what it refuses.

<a id="how-the-kit-is-built"></a>
<a id="behaviour-a-pane-keeps-redoing"></a>

[How the kit is built](./ui-design/kit-internals.md) covers CSS layering, the behavior nodes take over
from panes, how `Timeline` keeps your place, and `Markdown` rendering.

<a id="every-node-at-80-by-24"></a>
<a id="what-a-mobile-pwa-needs-from-this"></a>
<a id="what-a-terminal-renderer-needs-from-this"></a>
<a id="grouping"></a>
<a id="showing"></a>
<a id="asking"></a>
<a id="pixels-and-the-host-wrappers"></a>

[Every node at 80 by 24](./ui-design/every-node.md) lists every kit node with its focus role and its
terminal rendering, and what the kit owes a terminal host and a mobile web app.

<a id="icons"></a>
<a id="a-button-whose-face-is-a-mark"></a>
<a id="which-names-are-drawn-without-waiting"></a>
<a id="brand-colour"></a>

[Icons](./ui-design/icons.md) covers `Icon`, `IconButton`, which icons load eagerly, and brand marks.

<a id="two-column-panes"></a>

[Two-column panes](./ui-design/two-column-panes.md) covers `ListDetail`, its columns, and collapsing
a list to a rail.

<a id="chrome-and-overlays"></a>
<a id="drag-to-resize"></a>

[Chrome, overlays, and dialogs](./ui-design/overlays.md) covers floating host UI, the drawer, toasts,
dialog shape and focus, and drag-to-resize.

<a id="tooltips"></a>
<a id="the-help-mark"></a>

[Tooltips](./ui-design/tooltips.md) covers tooltip attributes, positioning, tips in plugin frames,
and the help mark.

<a id="interaction-rules"></a>
<a id="menus-and-right-click"></a>

[Interaction rules and menus](./ui-design/interaction.md) covers the keyboard rules, the menu
surface, right-click, confirmation, and row actions.

<a id="states"></a>
<a id="accessibility-and-density"></a>

[States and accessibility](./ui-design/states.md) covers interaction states, the connection and
staleness vocabulary, empty states, and the shared accessibility rules.
