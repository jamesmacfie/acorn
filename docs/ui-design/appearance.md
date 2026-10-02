# UI appearance

Part of [ui-design.md](../ui-design.md).

## Appearance

Themes provide semantic colors for backgrounds, text, borders, accents, diff states, notices, and
focus. Style packs provide typography, radius, spacing, density, chrome, and motion. The two choices
compose without feature components selecting literal colors. CSS variables are the runtime contract;
feature CSS is scoped to its plugin.

All 12 shipped themes and 4 style packs are registered literals and covered by parity tests. Device
preferences persist locally; they do not depend on which Node is active.

### Plugin themes

A plugin may contribute a **colour** theme, and only as data. `contributions.themes` in
`acorn-plugin.json` is a map of theme-token values; the host validates it and generates the
`:root[data-theme="plugin:<pluginId>:<themeId>"]` block itself
(`client-core/src/host/chrome/chromeThemes.ts`). **No plugin-authored CSS ever reaches the shell.** The
theme cannot break shape, density or layout because it cannot express anything but colour, which is
what makes this seam cheap: there is no stylesheet to parse and no selector to confine.

The token contract splits three ways, and only the first is declarable:

| Group | Count | Who writes it |
| --- | --- | --- |
| **Palette primitives** (`--bg`, `--text`, `--accent`, `--del-marker`, …) | 22 | The manifest, in full. `@acorn/protocol/themeTokens.ts` is the list, so the node can refuse an incomplete map at parse time without importing the client. |
| **Derived** (`--danger`, `--surface-sunken`, `--state-ok`, …) | 15 | `:root`, once, as `var()` references into the palette — so they follow every theme for free. A manifest naming one is refused: restating it in a theme block is what would break the derivation. |
| **Self-description** (`--is-dark`, `--color-scheme`) | 2 | The host, from the theme's one `dark` boolean. They are not colours, so they cannot go through the colour check, and a theme that could set them could tell the terminal it was dark while rendering a light palette. |

Validation is "every primitive present, no unknown key, every value a hex colour or a flat colour
function". Named colours, `var()` and nested functions (`url(…)`, `calc(…)`) are refused: the value
alphabet is the injection gate, so a value that passes cannot close a declaration, close the block or
open a tag. Both ends check — the node when it parses the manifest, the client again immediately
before generating CSS, because a roster row is bytes a node sent.

Ids are namespaced `plugin:<pluginId>:<themeId>`, so a plugin can never redefine a built-in and two
plugins can ship the same theme name. They appear in Settings → Appearance beside the built-in twelve,
labelled with their owner. **A stored preference naming a theme that is not registered right now falls
back to Light/Dark and is never rewritten** — a disabled plugin, an untrusted bundle and an unreachable
node all arrive as the same absence, and a preference erased on the third cannot be recovered when the
node comes back. The theme returns by itself when the plugin does.

### Plugin style packs

`contributions.styles` contains an id, label, optional description, and a partial `tokens` map. The
host gives each pack a `plugin:<pluginId>:<styleId>` id and generates a namespaced
`:root[data-style="…"]` block. The manifest parser and the client both call
`@acorn/protocol/styleValues.ts`: every supported token has a family and each family has a bounded
value alphabet. Unknown and host-derived tokens, CSS declaration syntax, `url()` and `expression()`
are refused. Shadows may name `var(--shadow-popover)` for their colour, never a literal colour.
Plugin CSS never enters the shell.

Packs are partial. Unset tokens retain the Terminal defaults, and a rejected value refuses the
whole pack. Settings lists accepted packs with their owner. A stored choice falls back to Terminal
while its plugin is absent or untrusted and returns when it becomes available; the preference is
never erased. The first-party packs retain their 25-selector escape hatch. Plugin packs have no
selector escape hatch and cannot change icons.

Feature-owned styles live beside the feature components that consume them. For example, the GitHub
pull list, pull detail, and checks panel import their own plugin styles; genuinely shared integration
settings remain in the client-core `integrations.css` role sheet. This keeps plugin presentation out
of the core aggregate without changing tokens or selector behavior.

### Token axes

`tokens-theme.css` holds the theme axis and `tokens-style.css` holds the style axis. `data-theme` on
`<html>` selects the theme file, `data-style` selects the pack file, and the two token sets are
disjoint: a theme sets colour only, a pack sets shape, typography, space, density, chrome, and
motion, and neither may set the other's kind. `styles/tokenAxes.test.ts` enforces both directions, so
source order between the two files never matters and a 4-pack by 12-theme matrix stays a non-issue
instead of 48 screenshot cells to check by hand.

Every style token has a value in `tokens-style.css` itself; packs only override it. That
completeness contract is what keeps a pack from leaving a `var()` undefined, a failure mode this
codebase had eight times over before the file existed (`--fs-xs` alone had 25 uses and no
definition anywhere). Terminal is the attribute-less default style, the same way light is the
default theme, so `tokens-style.css` doubles as the Terminal pack and there is no separate
`style-terminal.css`; a fresh install also needs no FOUC script for style, since the default paints
correctly before any JavaScript runs. A style may reach a colour only through indirection into a
theme slot, never a literal: `--card-bg: var(--bg-subtle)` is a style decision about which surface a
card sits on, while the theme still owns what that surface's colour is; `--card-bg: #fafafa` would
not be allowed.

Only the 21 primitive palette tokens (`--bg`, `--text`, `--accent`, and so on) are restated per
theme. Derived tokens such as `--danger`, `--success`, and `--surface-sunken` are declared once on
`:root` as `var()` references into the primitives, so they follow every theme automatically and
adding one is a one-line change rather than a 12-block edit. A theme block, including a
plugin-contributed one, is refused if it restates a derived token: the refusal is only correct while
these stay one-place references.

`--brand-legible` is the same idea for a mark's own colour: derived, because a palette primitive is
required of every plugin theme and adding one there would refuse every theme written before it.

The agent composer used to have three derived tokens of its own for the colours it draws `@file`,
`/command` and `$skill` in. It has none now: the field is `MentionTextarea`, a caller hands it
`segments` with a role token per run, and the kit maps `accent`, `warn` and `ok` to the theme the same
way it does everywhere else. That is the closed kit's rule arriving where a plugin's stylesheet used
to be — a plugin names a meaning, never a colour.

Three more tokens are colour but fit neither category: `--viz-series-1`, `--viz-series-2`, and
`--viz-series-3` identify "which one" on a chart rather than describing status, so they are real
values on `:root`, not primitives (adding them there would reject every theme already in the wild
for omitting them) and not derived (none of the twenty-one primitives says "series two"). They are
one set, not a light/dark pair: the defaults sit at a lightness that clears 3:1 contrast on both
grounds, since a `--dark-*` flip would only reach the two default paths and leave every named dark
theme on the light values. A pack may restate them; a plugin theme may not, for the same reason it
may not restate a derived token. See `docs/dashboards.md` § Views are derived, not chosen from a
menu for how a chart mark uses them.

Two tokens describe the theme rather than colour it: `--is-dark` and `--color-scheme`. The host sets
both from the theme's one `dark` boolean. The previous approach derived dark/light from parsing
`--bg` as a hex colour (`plugins/terminal/src/client/theme.ts`), which required `--bg` to stay a
literal 6-digit hex and silently classified every other colour syntax as light.

A third token, `--syntax-fg`, used to sit beside them, declared on `:root` as `var(--l)` and flipped
to `var(--r)` by every dark block, and it never worked. A custom property has its `var()` references
substituted where it is declared, not where it is read, and `--l` and `--r` exist only on the
individual Shiki token spans, so `--syntax-fg` computed to nothing on `:root` and inherited as
nothing. Both rules that read it fell back to plain body text. What the two syntax rules do instead is
spell the choice out on the span itself, with `light-dark(var(--l), var(--r))`, which follows
`color-scheme` and so follows `--color-scheme`. The rule of thumb the token broke: a `:root` token may
reference another `:root` token, never a token an element sets on itself.

The manual toggle (`data-theme="dark"` on `<html>`) wins over the OS preference
(`prefers-color-scheme: dark`), and both apply the same `--dark-*` values through one-line `var()`
indirections, so a dark-mode adjustment is made in one place. The OS-preference block also has to
work before any JavaScript runs: preferences load asynchronously, so until `applyTheme()` writes an
explicit `data-theme`, the OS preference is the only signal available, and skipping this block would
show a dark-mode user a white flash on boot.

Some tokens are read from JavaScript instead of CSS, because a canvas cannot read a stylesheet.
`--bg`, `--bg-subtle`, `--bg-hover`, `--bg-selected`, `--text`, `--text-muted`, and `--text-faint` are
read with `getComputedStyle` by the xterm and CodeMirror bridges; `--term-fs` is read the same way by
`TerminalSurface`, because xterm measures its cell width from the font. These are `BRIDGE_TOKENS` in
`kit/tokens/tokenAxes.ts`, and the test asserts they exist, because renaming one breaks the terminal or the
editor with no type error anywhere. `--font-mono` cannot be repointed by a style pack for the same
reason on the type side: code, diffs, the terminal, and the SQL grid stay monospace in every pack
because xterm measures cell width from the font. `--font-glyph` keeps the same protection for the
inline Unicode glyphs that still render as text (see Icons, below), because those characters only
line up on a mono stack even when a pack takes the surrounding chrome sans.

A few tokens sit outside both axes, in `tokens-invariant.css`: neither a theme nor a style pack may
set them, in both directions enforced by `tokenAxes.test.ts`. The stacking ladder (`--z-base` through
`--z-tooltip`) collapsed what used to be 28 raw `z-index` declarations spanning 18 distinct values,
and three of its orderings are load-bearing rather than cosmetic: `--z-picker` outranks `--z-modal`
because a picker opened from inside a modal (the Database pane's multi-select, for example) is
portalled to `<body>` as a sibling of the backdrop rather than its descendant, and renders behind it
otherwise; `--z-drawer-menu` outranks `--z-drawer` for the terminal drawer's own menu; and
`--z-toast` outranks `--z-modal` so a toast confirming an action taken inside a modal stays visible
from inside it. `--z-tooltip` sits far above everything, because the tooltip portal must never be
occluded and has no interactive children that could trap focus against it. `calc(var(--z-x) ± 1)` is
allowed on top of a rung, for a surface that stacks one step above it. The same file holds
`--brand-fg`, what sits on top of a brand colour, and `--tabular` (`tabular-nums`), which every pack needs for diff gutters, line counts, and timestamps.

`match` is the one text role that describes a run inside a line rather than the line. It means "this
is what you searched for", and it is here because the diff's find bar and the editor's find-in-files
both highlight a hit, and both used to spell the host class `.ui-find-mark` directly. On a terminal it
is reverse video.

### Roles, and what each host makes of them

The role tokens are the plugin-facing half of the same system. A plugin picks a role, and the host
maps it: on the DOM to a custom property from the two axes above, on a terminal to a cell, a colour,
or nothing. `kit/tokens/roles.ts` holds both columns and `kit/tokens/roles.test.ts` holds them to it.

A space role answers both axes, because the same token spaces a column of rows and a line of words.
`row` and `stack` are 0 lines vertically and one cell horizontally: two runs of text with nothing
between them are one word, which is what an `Inline gap="row"` drew before the terminal read it.

| Role | DOM token | Terminal |
| --- | --- | --- |
| `space` | `--space-0`, `--gap-inline`, `--gap-row`, `--gap-stack`, `--gap-section` | nothing; one cell; 0 lines and one cell; 0 lines and one cell; one blank line and one cell |
| `size` | `--control-h-xs`, `--control-h-sm`, `--control-h`, `--pad-control-lg` | one line either way; padding ignored |
| `tone` | `--text`, `--text-muted`, `--accent`, `--state-ok`, `--state-warn`, `--state-bad` | default, and the palette's grey, accent, green, yellow and red |
| `text` | `--fs`, `--fw-semibold`, `--text-muted`, `--font-mono`, `--label-size`, `--heading-weight` | plain, bold, grey, ignored, grey uppercase, bold |
| `border` | `--bw-0`, `--divider`, `--control-border`, `--surface-border`, `--stripe-w` | nothing, a rule, an underline, box corners, a stripe |
| `radius` | `--radius-control`, `--radius-surface`, `--radius-chip`, `--radius-pill` | ignored |

`muted` is a palette slot rather than the `dim` attribute, and the difference matters on a light
terminal: dim tells the emulator to blend a run toward the background, which on white paper is white
on white. Slot 8 is the palette's own grey, so the colour still comes from the theme the person
chose.

So a theme stays 40-odd colours, and on a terminal it is 16 of them plus bold. Most of a
style pack is shape and padding a terminal has no answer for, which is honest: density is the one
style axis it keeps.

### Runtime-set custom properties

A handful of custom properties are set from JavaScript rather than declared in any stylesheet, and
`cssHygiene.test.ts`'s `no phantom tokens` check has to know each one by name or it reads as an
undeclared reference. The rule for what is allowed onto this list: a component may hand CSS a
measurement or a count, never a design decision. `--meter-value`, `--meter-mark` and
`--kv-extra-cols` are a fill ratio, a second ratio on the same scale, and a column count;
`--diff-cols` is a diff canvas's width in columns, from `maxLineCols()`;
`--dash-cell` and `--dash-pitch` are a dashboard grid's measured cell size and pitch, from
`PanelGrid`'s `ResizeObserver`. In every case the number crosses the JS/CSS boundary, but the
stylesheet that reads it still owns the shape: the arithmetic that turns a column count into a width,
or a cell size into a twelve-column grid with a gap, stays in `diff.css` or `dashboards.css`, so a
style pack can still reach it. `--term-drawer-h` (the terminal drawer's own height), `--left` (a
reserved override hook), `--l`/`--r` (Shiki's per-token syntax colours), and `--state-color` /
`--label-color` / `--chip-color` (a live provider colour from an external API or a `Chip`'s `color`
prop) round out the list; none of them describe a layout decision either.

A second, smaller list (`locallyDeclared`) covers custom properties that are declared in a
stylesheet, but on a component's own block rather than on `:root`, the only place the phantom-token
scan reads. These are local constants shared by one feature's own arithmetic, not tokens, and have no
business on `:root`: `diff.css`'s `--diff-gutter-w`, `--diff-marker-w`, `--diff-btn-w`, and
`--diff-chrome-w` let a row canvas's minimum width add up the same gutter and marker widths the
columns themselves use, so the two cannot drift apart and clip the last character off a long line;
`primitives.css`'s `--row-field-w` is the track width `.ui-row`'s `meta` column reserves, shared by
the row and its own grid and meaningless to anything else; `--row-owner-inset` places a nested row's
one-pixel ownership rule on its parent's text column and keeps the row width inside the pane.

### Border roles

Border tokens split by role, not by a single width: four composite recipes cover about 380
declarations between them. `--divider` is the row and list separator
recipe; `--control-bw` is a control's own border, which a pack is free to zero; `--surface-border` is
a card or popover edge; `--chrome-divider` is the border between two regions of one surface, used by
`ListDetail` rather than `--control-bw` because two of its four predecessor panes used the control
role and lost their divider entirely once a pack zeroed it. Splitting by role is what lets a pack such
as Modern drop row dividers (`--divider-w: 0`) while keeping the topbar rule, and give inputs a
filled background while surfaces lose their border for a shadow instead. `cssHygiene.test.ts` refuses
an all-four-sides border shorthand built from `--divider`: Modern and Cute both set `--divider-w: 0`,
so a site using `--divider` for anything other than a row separator silently lost its border in two of
the four packs, which is how the Database pane ended up borderless everywhere but Terminal.

`--stripe-w` and `--marker-w` are a related pair with the same kind of trap. `--marker-w` says "this
row is selected," which a pack may legitimately express as a background fill instead of a bar. `--stripe-w`
carries information in its colour instead (a project's task-tab colour, warn-versus-sent on a review
note), so a pack may zero `--marker-w` but must never zero `--stripe-w`: doing so deletes state rather
than restyling it.

### Style packs

Each pack (`style-cozy.css`, `style-cute.css`, `style-modern.css`) is mostly a token block: a
`:root[data-style='x']` rule restating shape, space, density, typography, chrome, and motion tokens,
and nothing else. `tokenAxes.test.ts` caps every pack at 25 selectors that reach past that token block
into an actual element, because each such override is a bug report against the token vocabulary; the
fix for a 26th override is a new token, never a 26th selector, or the token layer stops being the seam
that keeps packs from fighting each other. Cozy and Cute are at 2 selectors today, Modern at 3.

A collapsed left pane sets its grid column to zero width, but a zero-width grid column still emits
its `gap` (`shell.css`), so a pack that changes `--pane-gap` has to zero the gap again for the
collapsed state, or a sliver of the old gap appears where the pane was. All three packs carry this
override for exactly that reason.

A pack that removes a row's accent marker (`--marker-w: 0`, in Cute and Modern) has to give selection
another way to read, since a plain `--bg-selected` alone is too quiet once rows read as inset cards
rather than a flat list. Modern's filled-button override also has to exclude both the `bare` and
`solid` variants: the override selector is `(0,3,0)` and a variant's own `background` rule is
`(0,2,0)`, so without the exclusion Modern would repaint an already-solid button (the Database pane's
**Run** button, for example) in `--bg-subtle` and leave its `--accent-fg` label
invisible against it. Cozy's serif body copy needs a taller line height than the fixed `--pane-pad`
gives a nested prose block, so it sets `line-height` on `.markdown` directly, one of the few pack
overrides that reaches a class outside its own token block.

A pack that needs a CSS property nobody currently declares adds a null default to `base.css` instead
of an override rule inside the pack. Cute's springy hover and press, for instance, come from a
`transform` null default in `base.css`, not from anything in `style-cute.css`: nothing in the app sets
`transform` on hover, so a token alone could not add one, and declaring the property once at `none`
(free, since `transform: none` creates no compositing layer) turns "Cute has a springy press" into a
one-line token change instead of an override rule per selector. `:where()` contributes no specificity
of its own, but a selector such as `:hover:not(:disabled)` still totals `(0,2,0)`, enough to beat a
plain `.some-button { transform: … }` at `(0,1,0)`; an element that relies on `transform` for
positioning while hovered should use `inset` or `margin` instead, to avoid snapping back to `none` on
hover.
