# Design tokens

This page covers the token files: the theme and style axes, the tokens outside both, the custom
properties JavaScript sets, border roles, and the rules for style pack files. Read it before you add
or rename a token. It's part of [UI design](../ui-design.md).

## Token axes

`tokens-theme.css` holds the theme axis and `tokens-style.css` holds the style axis, in
`packages/client-core/src/infra/styles/`. `data-theme` on `<html>` selects the theme, and `data-style`
selects the pack. The two token sets are disjoint: a theme sets color only, and a pack sets shape,
typography, space, density, chrome, and motion. `styles/tokenAxes.test.ts` enforces both directions,
so the load order of the two files never matters, and the 4 packs by 12 themes need no screenshot
matrix.

Every style token has a value in `tokens-style.css`, and packs only override it, so a pack can't leave
a `var()` undefined. Terminal is the default style, the way light is the default theme, so
`tokens-style.css` is also the Terminal pack, and a fresh install needs no script to avoid a flash of
the wrong style. A style reaches a color only through a theme slot: `--card-bg: var(--bg-subtle)` says
which surface a card sits on, and the theme still owns its color. `--card-bg: #fafafa` isn't allowed.

Only the 22 palette primitives, such as `--bg`, `--text`, and `--accent`, are restated per theme.
Derived tokens, such as `--danger`, `--success`, and `--surface-sunken`, are declared once on `:root`
as `var()` references into the primitives, so they follow every theme, and adding one is a one-line
change. A theme block that restates a derived token is refused, including a plugin's.
`--brand-legible` is derived the same way, for a mark's own color.

Three color tokens are neither primitive nor derived: `--viz-series-1`, `--viz-series-2`, and
`--viz-series-3` say "which one" on a chart, not status. They're real values on `:root`, one set that
clears 3:1 contrast on light and dark grounds. A pack can restate them. A plugin theme can't, for the
same reason it can't restate a derived token. [Dashboards](../dashboards.md) covers how a chart uses
them.

The kit's `MentionTextarea` colors `@file`, `/command`, and `$skill` runs from role tokens the caller
passes as `segments`, so the composer needs no tokens of its own.

### Self-description and dark mode

`--is-dark` and `--color-scheme` describe the theme instead of coloring it, and the host sets both from
the theme's `dark` boolean.

A `:root` token may reference another `:root` token, never a token an element sets on itself, because
a custom property substitutes its `var()` references where it's declared. So the syntax rules color
Shiki's spans with `light-dark(var(--l), var(--r))` on the span itself, which follows
`--color-scheme`.

The manual setting, `data-theme="dark"` on `<html>`, wins over the OS preference,
`prefers-color-scheme: dark`, and both apply the same `--dark-*` values through one-line `var()`
references. The OS-preference block also works before any JavaScript runs, because preferences load
asynchronously. Without it, a dark-mode user would see a white flash on boot.

### Tokens read from JavaScript

A canvas can't read a stylesheet, so some tokens are read with `getComputedStyle`. `--bg`,
`--bg-subtle`, `--bg-hover`, `--bg-selected`, `--text`, `--text-muted`, and `--text-faint` are read by
the xterm and CodeMirror bridges, and `--term-fs` by `TerminalSurface`, because xterm measures its
cell width from the font. These are `BRIDGE_TOKENS` in `kit/tokens/tokenAxes.ts`, and the test asserts
they exist, because renaming one breaks the terminal or the editor with no type error. A style pack
can't repoint `--font-mono`, so code, diffs, the terminal, and the SQL grid stay monospace in every
pack. `--font-glyph` keeps the same protection for inline Unicode glyphs drawn as text.

### Tokens outside both axes

`tokens-invariant.css` holds tokens neither a theme nor a pack may set, enforced both ways by
`tokenAxes.test.ts`. The stacking ladder runs from `--z-base` to `--z-tooltip`, and three of its
orderings matter:

- `--z-picker` outranks `--z-modal`, because a picker opened from a dialog is portaled to `<body>` as
  a sibling of the backdrop, and would render behind it.
- `--z-drawer-menu` outranks `--z-drawer`, for the terminal drawer's own menu.
- `--z-toast` outranks `--z-modal`, so a toast confirming an action in a dialog stays visible.

`--z-tooltip` sits above everything. `calc(var(--z-x) ± 1)` is allowed, for a surface one step above a
rung. The same file holds `--brand-fg`, what sits on a brand color, and `--tabular`
(`tabular-nums`), for diff gutters, line counts, and timestamps.

## Runtime-set custom properties

A few custom properties are set from JavaScript, and `cssHygiene.test.ts`'s phantom-token check knows
each by name. The rule for this list: a component may hand CSS a measurement or a count, never a design
decision.

- `--meter-value` and `--meter-mark` are fill ratios, and `--kv-extra-cols` is a column count.
- `--diff-cols` is a diff canvas's width in columns, from `maxLineCols()`.
- `--dash-cell` and `--dash-pitch` are a dashboard grid's measured cell size and pitch, from
  `PanelGrid`'s `ResizeObserver`.
- `--term-drawer-h` is the terminal drawer's height, and `--left` is a reserved override hook.
- `--l` and `--r` are Shiki's per-token syntax colors. An `ansi` `CodeBlock` sets them on each colored
  run of terminal output, with `--lb` and `--rb` for a background.
- `--state-color`, `--label-color`, and `--chip-color` are live provider colors from an external API
  or a `Chip`'s `color` prop.

The stylesheet that reads each one still owns the shape. The arithmetic that turns a column count
into a width stays in `diff.css` or `dashboards.css`, where a style pack can reach it.

A second list, `locallyDeclared`, covers properties declared on a component's own block instead of
`:root`. These are local constants for one feature's arithmetic. `diff.css`'s `--diff-gutter-w`,
`--diff-marker-w`, `--diff-btn-w`, and `--diff-chrome-w` let a row canvas add up the same widths its
columns use. `primitives.css`'s `--row-field-w` is the track width `.ui-row`'s `meta` column reserves,
and `--row-owner-inset` places a nested row's ownership rule on its parent's text column.

## Border roles

Border tokens split by role, and four composite recipes cover about 380 declarations:

- `--divider` separates rows and list items.
- `--control-bw` is a control's own border, which a pack may zero.
- `--surface-border` is a card or popover edge.
- `--chrome-divider` is the border between two regions of one view, used by `ListDetail`.

So a pack such as Modern can drop row dividers with `--divider-w: 0` and keep the top bar rule, or
give inputs a filled background while surfaces swap their border for a shadow.
`cssHygiene.test.ts` refuses an all-four-sides border built from `--divider`, because Modern and Cute
set `--divider-w: 0`, and such a border would disappear in two of the four packs.

`--stripe-w` and `--marker-w` are a related pair. `--marker-w` says a row is selected, which a pack can
express as a background fill instead. `--stripe-w` carries information in its color, such as a
project's task-tab color or a review note's state, so a pack may zero `--marker-w` but never
`--stripe-w`.

## Style packs

Each pack, `style-cozy.css`, `style-cute.css`, and `style-modern.css`, is mostly a token block: a
`:root[data-style='x']` rule that restates shape, space, density, typography, chrome, and motion
tokens. `tokenAxes.test.ts` caps each pack at 25 selectors that reach past the token block into an
element, because each one is a gap in the token vocabulary. The fix for a 26th is a new token.

A collapsed left pane sets its grid column to zero width, but a zero-width column still emits its
`gap` (`shell.css`). So a pack that changes `--pane-gap` has to zero the gap again for the collapsed
state, and all three packs do.

A pack that removes a row's selection marker, `--marker-w: 0` in Cute and Modern, has to show
selection another way. Modern's filled-button override excludes the `bare` and `solid` variants,
because its selector is `(0,3,0)` and a variant's own rule is `(0,2,0)`, so it would repaint a solid
button and hide its label. Cozy's serif body needs a taller line height, so it sets `line-height` on
`.markdown`.

A pack that needs a CSS property nothing declares adds a null default to `base.css`, not an override
in the pack. Cute's springy hover and press come from a `transform` null default in `base.css`, so
"Cute has a springy press" is a one-line token change. `:where()` adds no specificity, but a selector
such as `:hover:not(:disabled)` still totals `(0,2,0)` and beats a plain class. An element that uses
`transform` for position while hovered should use `inset` or `margin`.
