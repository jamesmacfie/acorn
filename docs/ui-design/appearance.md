# UI appearance

This page covers themes and style packs, what a plugin can contribute to each, and how each role maps
to the desktop and the terminal. Read it before you add a theme, a pack, or a role. It's part of
[UI design](../ui-design.md). [Design tokens](./tokens.md) covers the token files themselves.

## Appearance

Themes set semantic colors for backgrounds, text, borders, accents, diff states, notices, and focus.
Style packs set typography, radius, spacing, density, chrome, and motion. You pick each separately,
and feature components never choose literal colors. CSS custom properties are the runtime contract,
and feature CSS is scoped to its plugin.

The 12 built-in themes and 4 style packs are registered literals, covered by parity tests
(`apps/desktop/test/client/parity.test.ts`). Appearance is a device preference, so it doesn't depend
on the active Node.

Feature styles live beside the components that use them. For example, the GitHub pull list, pull
detail, and checks panel import their own plugin styles, and shared integration settings stay in
client-core's `integrations.css`.

### Plugin themes

A plugin can contribute a color theme, as data only. `contributions.themes` in `acorn-plugin.json` is
a map of theme-token values. The host validates it and generates the
`:root[data-theme="plugin:<pluginId>:<themeId>"]` block itself
(`packages/client-core/src/host/chrome/chromeThemes.ts`). No plugin-written CSS reaches the shell, so a
theme can express only color and can't break shape, density, or layout.

The token contract splits three ways, and only the first is declarable:

| Group | Count | Who writes it |
| --- | --- | --- |
| Palette primitives (`--bg`, `--text`, `--accent`, `--del-marker`, and so on) | 22 | The manifest, in full. `THEME_PALETTE_TOKENS` in `packages/protocol/src/appearance/themeTokens.ts` is the list, so the Node can refuse an incomplete map without importing the client. |
| Derived (`--danger`, `--surface-sunken`, `--state-ok`, and so on) | 15 | `:root`, once, as `var()` references into the palette, so they follow every theme. A manifest naming one is refused, because restating it would break the derivation. |
| Self-description (`--is-dark`, `--color-scheme`) | 2 | The host, from the theme's `dark` boolean. They aren't colors, and a theme that could set them could tell the terminal it was dark while drawing a light palette. |

Validation requires every primitive, no unknown key, and every value a hex color or a color function
with a flat argument list. Named colors, `var()`, and nested functions such as `url(…)` and `calc(…)`
are refused. The value alphabet is the injection gate: a value that passes can't close a declaration,
close the block, or open a tag. The Node checks when it parses the manifest, and the client checks
again before generating CSS, because a plugin list is bytes a Node sent.

IDs are namespaced `plugin:<pluginId>:<themeId>`, so a plugin can't redefine a built-in theme, and two
plugins can use the same theme name. They appear in Settings → Appearance beside the built-in 12, with
their owner. A stored preference naming a theme that isn't registered falls back to Light or Dark and
is never rewritten. A disabled plugin, an untrusted bundle, and an unreachable Node all look like the
same absence, and the theme returns when the plugin does.

### Plugin style packs

`contributions.styles` holds an ID, a label, an optional description, and a partial `tokens` map. The
host gives each pack a `plugin:<pluginId>:<styleId>` ID and generates a namespaced
`:root[data-style="…"]` block. The manifest parser and the client both use
`packages/protocol/src/appearance/styleValues.ts`: every supported token has a family, and each family
has a bounded value alphabet. Unknown tokens, host-derived tokens, CSS declaration syntax, `url()`, and
`expression()` are refused. Shadows may name `var(--shadow-popover)` for their color, never a literal.

A plugin pack can set the role aliases a built-in pack sets: `--radius-surface`, `--font-ui`,
`--divider-w`, `--elev-card`, `--card-bg`, `--ease-interactive`, and the rest. Each takes a literal
from its family's alphabet or a `var()` naming a token of the same kind, such as
`--radius-surface: var(--radius-lg)` or `--elev-card: var(--shadow-2)`. A surface slot such as
`--card-bg` may name only `--bg`, `--bg-subtle`, `--bg-hover`, or `--bg-selected`. Host recipes stay
refused: the four border recipes, `--stripe-w`, `--radius` and `--radius-pill-fixed`, `--font-glyph`,
`--ring`, `--ring-highlight`, `--scrim`, `--tabrail-w`, and `--transition-color`. These are
`DERIVED_STYLE_TOKENS`. A pack that wants stitched floating surfaces sets `--surface-border-style` to
`dashed` or `dotted`.

Packs are partial. Unset tokens keep the Terminal defaults, and one rejected value refuses the whole
pack. Settings lists accepted packs with their owner. A stored choice falls back to Terminal while its
plugin is absent or untrusted, and returns with it. First-party packs keep their 25-selector escape
hatch ([style packs](./tokens.md#style-packs)). Plugin packs have none and can't change icons.

### Roles, and what each host makes of them

Role tokens are the plugin-facing half of the same system. A plugin picks a role, and the host maps
it: on the desktop to a custom property from the two axes, and in a terminal to a cell, a color, or
nothing. `kit/tokens/roles.ts` holds both columns, and `kit/tokens/roles.test.ts` checks them.

A space role answers both axes, because the same token spaces a column of rows and a line of words.
`row` and `stack` are zero lines vertically and one cell horizontally, because two runs of text with
nothing between them read as one word.

| Role | Desktop token | Terminal |
| --- | --- | --- |
| `space` | `--space-0`, `--gap-inline`, `--gap-row`, `--gap-stack`, `--gap-section` | nothing; one cell; 0 lines and one cell; 0 lines and one cell; one blank line and one cell |
| `size` | `--control-h-xs`, `--control-h-sm`, `--control-h`, `--pad-control-lg` | one line either way; padding ignored |
| `tone` | `--text`, `--text-muted`, `--accent`, `--state-ok`, `--state-warn`, `--state-bad` | default, and the palette's gray, accent, green, yellow, and red |
| `text` | `--fs`, `--fw-semibold`, `--text-muted`, `--font-mono`, `--label-size`, `--heading-weight` | plain, bold, gray, ignored, gray uppercase, bold |
| `border` | `--bw-0`, `--divider`, `--control-border`, `--surface-border`, `--stripe-w` | nothing, a rule, an underline, box corners, a stripe |
| `radius` | `--radius-control`, `--radius-surface`, `--radius-chip`, `--radius-pill` | ignored |

`muted` is a palette slot, not the `dim` attribute. Dim blends a run toward the background, which on a
light terminal is white on white. Slot 8 is the palette's own gray, so the color still comes from your
theme.

`match` is the one text role for a run inside a line. It means "this is what you searched for", for
the diff's find bar and the editor's find in files. In a terminal it's reverse video.

So a theme is about 40 colors, and in a terminal it's 16 plus bold. Most of a style pack is shape and
padding a terminal has no answer for, and density is the one style axis it keeps.
