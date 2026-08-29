# UI design

acorn's UI is a dense keyboard-driven workspace. The visual system separates semantic theme tokens
from style-pack geometry so a user can choose color and shape/density independently.

## Shell hierarchy

```text
Topbar: Node/workspace context, repo/PR controls, global actions
TabRail: sources → workspaces → tasks
Main: Home, Fleet overview, source browse, or active task
Task: ordered pane row
Bottom drawer: terminals and raw provider sessions
Overlays: palette, settings, onboarding, notices, confirmations
```

The shell owns navigation chrome and modal prompts. Plugins supply feature content through registries
and slots. A child webview is positioned over a pane host by the shell; page content never
owns the surrounding chrome.

Both vertical rails, the TabRail on the left and the task pane switcher on the right, are built from
one component: `tabs/RailTab.tsx`, a square 52px control styled by `.tabrail-tab`. Every control in
both rails goes through it, including the bottom-pinned "+" on the left and "close task" on the
right, which share the `.tabrail-bottom` modifier and therefore the same box. It is not a Button. A
rail control hovers by changing its icon and background only, and `.ui-btn:hover` also moves
`border-color`, which lit the right rail's own dividers on hover and made the two sides look
unrelated. `.pane-switcher` restates only what genuinely differs on the right: the glyph font and an
active accent on the right edge instead of the left.

### Rail controls and status markers

`RailTab` is presentation only. It takes a `label` (which becomes both the tooltip title and the
accessible name), a `glyph` resolved through `ui/Icon.tsx`, and explicit `active`, `tone`, `accent`,
`busy`, `sublabel`, and `markers` props. It never reads task state, asks a registry anything, or
knows which rail it is in. `children` stays as an escape hatch for a genuinely compound centre;
prefer `glyph` plus `sublabel`.

Two states are worth spelling out. `active` sets the visual class only — the call site still supplies
`aria-current`, `aria-pressed`, or `aria-expanded`, because source navigation, a multi-open pane, a
running process, and an open drawer are four different things to say. `busy` swaps the glyph for the
shared spinner, sets `aria-busy`, switches the tooltip to `busyLabel`, and refuses activation without
applying native `disabled`, which would swallow the mouseover the tooltip needs.

A **marker** is a small non-interactive status icon around the outside edge of a control: CI checks,
an unread agent, a dirty worktree, a plugin's own state. A marker is data, not markup. It carries an
id, a label in words, exactly one of an icon name or a `StatusDot` tone, an optional semantic tone,
an optional `busy` spin, and an ordered list of the positions it would like:

```
top-start   top-end
     bottom-center
bottom-start   bottom-end
```

`tabs/railMarkers.ts` owns the rest, and the host owns it, not the caller and not a plugin
stylesheet. It orders markers by priority (then id, so activation order never shows), gives each one
the first position on its list that is still free, renders at most one marker per position, and keeps
everything that missed out in the tooltip legend and the control's accessible description. Compact
chrome may hide an icon; it must never hide a state. `bottom-center` is reserved for host lifecycle
and activity, because it sits under the main glyph rather than in a corner.

Core's markers come from `tasks/railStatus.ts`. Plugins publish theirs through
`registries/railMarkers.ts` ([plugins.md § Rail markers](./plugins.md)); contributed priorities are
clamped below core's, so a plugin can order its own markers among themselves but can never push a
core lifecycle state out of its corner. Placement requests are preferences, never guarantees.

A CSS selector in a feature or plugin stylesheet that positions a rail marker is the regression
signal that placement escaped the host.

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
(`client-core/src/plugins/chrome/themes.ts`). **No plugin-authored CSS ever reaches the shell.** The
theme cannot break shape, density or layout because it cannot express anything but colour, which is
what makes this seam cheap: there is no stylesheet to parse and no selector to confine.

The token contract splits three ways, and only the first is declarable:

| Group | Count | Who writes it |
| --- | --- | --- |
| **Palette primitives** (`--bg`, `--text`, `--accent`, `--del-marker`, …) | 22 | The manifest, in full. `@acorn/protocol/themeTokens.ts` is the list, so the node can refuse an incomplete map at parse time without importing the client. |
| **Derived** (`--danger`, `--surface-sunken`, `--state-ok`, …) | 15 | `:root`, once, as `var()` references into the palette — so they follow every theme for free. A manifest naming one is refused: restating it in a theme block is what would break the derivation. |
| **Self-description** (`--is-dark`, `--color-scheme`, `--syntax-fg`) | 3 | The host, from the theme's one `dark` boolean. They are not colours, so they cannot go through the colour check, and a theme that could set them could tell the terminal it was dark while rendering a light palette. |

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

**Style packs are deliberately not contributable.** Style tokens touch layout and density, where
"cannot break the app" is a much weaker promise than it is for colour. The mechanism would be the same;
the judgement is not, and one contribution never spans both axes.

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

`--mention-file`, `--mention-command` and `--mention-skill` are the colours the agent composer draws
its three kinds of token in: `var(--accent)`, `var(--warn)` and `var(--add-marker)`. They are derived
for a second reason: a palette primitive is required of every plugin theme, so adding three there
would refuse every theme written before them. Each borrows a palette colour rather than naming a hue
of its own, so a theme lends its own — Dracula's yellow, Nord's cyan. `--del-marker` is deliberately
unused: a skill nobody is worried about should not read as an error. A file mention takes the accent,
which means it reads as weight rather than colour under the two monochrome default themes, where
`--accent` is `--text`; that is what every other accent-coloured surface does there too. Promote them
to primitives when a theme wants mention colours separate from its accent and status colours, and
expect that to be a breaking manifest change.

Three more tokens are colour but fit neither category: `--viz-series-1`, `--viz-series-2`, and
`--viz-series-3` identify "which one" on a chart rather than describing status, so they are real
values on `:root`, not primitives (adding them there would reject every theme already in the wild
for omitting them) and not derived (none of the twenty-one primitives says "series two"). They are
one set, not a light/dark pair: the defaults sit at a lightness that clears 3:1 contrast on both
grounds, since a `--dark-*` flip would only reach the two default paths and leave every named dark
theme on the light values. A pack may restate them; a plugin theme may not, for the same reason it
may not restate a derived token. See `docs/dashboards.md` § Views are derived, not chosen from a
menu for how a chart mark uses them.

Three tokens describe the theme rather than colour it: `--is-dark`, `--color-scheme`, and
`--syntax-fg`. The host sets all three from the theme's one `dark` boolean. The previous approach
derived dark/light from parsing `--bg` as a hex colour (`plugins/terminal/src/client/theme.ts`), which
required `--bg` to stay a literal 6-digit hex and silently classified every other colour syntax as
light; `--syntax-fg` replaces two hardcoded lists of dark theme names that lived in `diff.css` and
`checks-panel.css` and both needed editing by hand every time a dark theme shipped.

The manual toggle (`data-theme="dark"` on `<html>`) wins over the OS preference
(`prefers-color-scheme: dark`), and both apply the same `--dark-*` values through one-line `var()`
indirections, so a dark-mode adjustment is made in one place. The OS-preference block also has to
work before any JavaScript runs: preferences load asynchronously, so until `applyTheme()` writes an
explicit `data-theme`, the OS preference is the only signal available, and skipping this block would
show a dark-mode user a white flash on boot.

Some tokens are read from JavaScript instead of CSS, because a canvas cannot read a stylesheet.
`--bg`, `--bg-subtle`, `--bg-hover`, `--bg-selected`, `--text`, `--text-muted`, and `--text-faint` are
read with `getComputedStyle` by the xterm and Monaco bridges; `--term-fs` is read the same way by
`TerminalSurface`, because xterm measures its cell width from the font. These are `BRIDGE_TOKENS` in
`ui/tokenAxes.ts`, and the test asserts they exist, because renaming one breaks the terminal or the
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

### Roles, and what each host makes of them

The role tokens are the plugin-facing half of the same system. A plugin picks a role, and the host
maps it: on the DOM to a custom property from the two axes above, on a terminal to a cell, a colour,
or nothing. `ui/kit/roles.ts` holds both columns and `ui/kit/roles.test.ts` holds them to it.

| Role | DOM token | Terminal |
| --- | --- | --- |
| `space` | `--space-0`, `--gap-inline`, `--gap-row`, `--gap-stack`, `--gap-section` | 0 lines, one cell, 0, 0, one blank line |
| `size` | `--control-h-xs`, `--control-h-sm`, `--control-h`, `--pad-control-lg` | one line either way; padding ignored |
| `tone` | `--text`, `--text-muted`, `--accent`, `--state-ok`, `--state-warn`, `--state-bad` | default, dim, and the palette's accent, green, yellow and red |
| `text` | `--fs`, `--fw-semibold`, `--text-muted`, `--font-mono`, `--label-size`, `--heading-weight` | plain, bold, dim, ignored, dim uppercase, bold |
| `border` | `--bw-0`, `--divider`, `--control-border`, `--surface-border`, `--stripe-w` | nothing, a rule, an underline, box corners, a stripe |
| `radius` | `--radius-control`, `--radius-surface`, `--radius-chip`, `--radius-pill` | ignored |

So a theme stays 40-odd colours, and on a terminal it is 16 of them plus dim and bold. Most of a
style pack is shape and padding a terminal has no answer for, which is honest: density is the one
style axis it keeps.

### Runtime-set custom properties

A handful of custom properties are set from JavaScript rather than declared in any stylesheet, and
`cssHygiene.test.ts`'s `no phantom tokens` check has to know each one by name or it reads as an
undeclared reference. The rule for what is allowed onto this list: a component may hand CSS a
measurement or a count, never a design decision. `--meter-value` and `--kv-extra-cols` are a fill
ratio and a column count; `--diff-cols` is a diff canvas's width in columns, from `maxLineCols()`;
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
the row and its own grid and meaningless to anything else.

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
Save, Generate, and Execute buttons, for example) in `--bg-subtle` and leave its `--accent-fg` label
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

## The closed kit

Every component a plugin may draw with is in one list, in `packages/client-core/src/ui/`, reaching
plugins through `@acorn/plugin-api/ui`. The list is closed: a component's props are role tokens,
content, counts, booleans, and handlers, and never `class`, `className`, `style`, or a DOM attribute
passed through. `@acorn/plugin-api/ui/tokens` carries the role enums and the support matrix as data,
with no components on it, so a node-environment test can read them.

Three things follow from closing it, and each has a test.

**A node takes a meaning, not a value.** `tone="danger"`, `gap="section"`, `size="sm"`. A plugin
never names a pixel, a colour, or a class, so the same tree can be drawn by a host with no pixels.
`ui/kit/tokens.ts` declares the six enums and `ui/kit/roles.ts` maps each role to a CSS custom
property and to a terminal value. That mapping is the only place outside a stylesheet that names a
custom property.

**A node says which hosts can draw it.** `ui/kit/support.ts` holds a row per node with a `dom`
column and a `tui` column, at one of four levels: `full` draws it natively, `reduced` draws it with
named things missing, `fallback` draws a stated substitute, and `absent` draws nothing unless the
node has a `<Fallback>` child. Only `dom` is implemented. The `tui` column is documentation with a
test that it is filled in, so nobody adds a node without deciding what it does on a terminal.
`docs/future/layout/04-kit.md` holds the 80-column sentence for each one.

**The classes moved inward.** A kit component keeps its `ui-*` classes and styles its own children
by position, as in `.ui-code-wrap > .ui-btn`. Nothing exported accepts a class, `cx.ts` is internal,
and a pane that wants a control to look different asks for that in the kit rather than in its own
stylesheet.

`Only` and `Fallback` are the two host wrappers. `Only hosts={['dom']}` draws its children on the
named hosts and nowhere else. `Fallback forNode="Grid"` draws its children where the matrix says
this host cannot draw that node. Both are here before there is a second host, so a plugin can be
written against one before it arrives.

### The three kit invariants

Modelled on `styles/tokenAxes.test.ts`, which reads the stylesheets and asserts they agree with the
declared axes:

- `ui/kit/support.test.ts` reads the `/ui` barrel and asserts that the nodes it exports and the rows
  in `NODE_SUPPORT` are the same list, with a `tui` level on every row.
- `ui/kit/roles.test.ts` asserts that every role in every enum has a DOM value and a terminal value,
  and that each DOM value names a token `tokenAxes.ts` declares.
- `ui/kit/props.test-d.ts` is a type-level test: no exported node's props accept `class`,
  `className`, `style`, or `classList`, and no role-typed prop accepts an arbitrary string. It has
  nothing to run. `tsc --noEmit` across every package is the check, which `pnpm lint` already makes.

### How the kit is built

`primitives.css` holds the shared CSS for the components in `ui/primitives.tsx` and the component
files beside it. Specificity is layered by convention: a node's base rule is a bare class, `(0,1,0)`;
a variant selector adds an attribute, `(0,2,0)`; a style pack's override adds a
`:root[data-style="x"]` prefix, `(0,3,0)`. A pack wins because it is more specific, never because its
stylesheet loads last.

`ui/adoption.test.ts` is what remains of the migration ledger that ran before the kit closed. Its
`CONVERTED` list may only grow, and every file on it avoids raw buttons, selects, textareas, and the
retired shared classes. The two checks around raw `div`s in a plugin's tree stay until phase 9 of the
layout programme inverts them; see [layout](./future/layout/README.md).

## Icons

`ui/Icon.tsx` takes a **name string** and resolves it against two families, in this order:

1. A **`brand:`-prefixed name** is a brand mark from `ui/brandMarks.ts`: one SVG path's `d`
   attribute in a 24 box, drawn as a single `<path fill="currentColor">`.
2. Any **other name** is a Lucide glyph from `lucide-static/icon-nodes.json`, drawn stroked and
   unfilled in the same box, node by node through `<Dynamic>` and never `innerHTML`.
3. An **unmatched name renders as text** in a `span.glyph`. That fallback is load-bearing rather
   than a nicety — the remaining inline literals (◆/◇ pin state, ⊘/◉ hidden) ride it, which is also
   why `--font-glyph` survives the brand marks leaving.

The `brand:` prefix exists so the two families can never collide (Lucide has grown brand-shaped
names before and will again) and so brand marks stay out of `ICON_NAMES`, which `ui/IconPicker.tsx`
enumerates for user-chosen task icons. Putting them in that picker is then a
deliberate one-line decision rather than something that happens by accident.

**A mark belongs in core if and only if a core surface renders it.** Otherwise it belongs to the
plugin that draws it. The reason is the text fallback: if core names `brand:x` and no plugin has
registered it — disabled, uninstalled, bundle untrusted — the literal string `brand:x` appears in
the UI. Core's list is currently one entry, GitHub, because `project.github` is a first-class field
on the project row and core draws it. The mark follows the data model, not the plugin boundary.

A plugin supplies its own mark through one of two feeders, and they produce identical results:

- **compiled in** — call `brandMarkRegistry.register()` from the plugin's `init`
  (`@acorn/plugin-api/client`); see `plugins/docker/src/client/index.ts`.
- **loaded** — declare `icon` (or `icons`, for a package hosting several brands) at the top level
  of `acorn-plugin.json`; the host registers it under a name it stamps from the roster row, so a
  package cannot claim another's mark. See `plugins/linear/acorn-plugin.config.mjs`.

Because both feeders end at the same registry, a plugin moving from compiled-in to loaded changes
no glyph string anywhere. Path data rather than a component is what makes that true: a loaded
plugin's client bundle runs in a sandboxed iframe on its own origin, and a function cannot cross a
MessagePort — and a rail source's logo has to draw whether or not that plugin's frame is mounted.
The retired design note (`docs/future/icons.md`, in git history) records the alternatives this
rules out.

### Brand colour

A mark can carry `color`, the brand's own six-digit hex, and that is where a third-party colour lives.
The alternative, a `--brand-<name>` token in `tokens-invariant.css` paired with a
`[data-provider='<name>']` rule in `integrations.css`, is closed to plugins: core has to know the name
to write the rule, so a fourth provider needs a core change, and any surface without a matching rule
falls back to `--accent` whoever the provider is.

`brandStyle(name)` in `ui/brandMarks.ts` turns an icon name into two custom properties on the element
that renders the mark: `--brand` for the fill, and `--brand-on` for whatever sits on top of it, which
is `--brand-fg`. A surface reads them with a fallback, so a mark with no colour and a plain Lucide name
both keep the surface's own look:

```css
.integration-logo { background: var(--brand, var(--bg-hover)); color: var(--brand-on, var(--text)); }
```

Two rules govern where a brand colour may go.

**It must not be the only thing carrying contrast.** A hex authored by a third party cannot know your
theme, and GitHub's `#24292f` on a dark pane is black on near-black. Fill a shape with it and put
`--brand-fg` on top, the way the integrations logo does, or tint with it, the way Agent Center's
session icon does at 8%. Colouring a bare glyph on the pane background is the one that breaks, and the
fix if a mark ever does disappear is a light and dark pair on the mark, not a rule in core.

**It is validated as a hex, not as a CSS colour.** The string reaches a `style` attribute, and a
colour slot accepts `url()`, so any-CSS-colour would let a manifest make an outbound request.
`pluginContract.ts` checks `/^#[0-9a-f]{6}$/i`.

A frame is the exception to all of this, because it is a separate origin and a separate JS realm with
no reach into the registry. It draws its own copy of the mark, so it sets its own `--brand` inline;
see `plugins/linear/src/frame/app.tsx`.

A mark is one SVG path's `d` attribute in a 24x24 box, not a full SVG document. A document would
allow `<script>`, `<use href>`, `<image href>`, `<foreignObject>`, `on*` handlers, and CSS
`@import`, which would need an allowlist parser and a new trust boundary for what is only a logo.
There is nothing in `d`'s grammar to sanitise, so a manifest-supplied mark needs only a
character-class check (`node-core/main/pluginManifest.ts`) and renders through the same `<path>`
machinery `Icon.tsx` already had. `Icon` fills it with `currentColor`, so a plugin's mark themes
across every theme exactly as a first-party one does, which a data-URI `<img>` could not, since CSS
does not cross into its document.

## Two-column panes

A pane that puts a list beside a detail uses the `ListDetail` primitive, not a hand-rolled grid. It
owns the split, the two column widths (`narrow` for an identifier switcher, the default for a browse
list), the `--chrome-divider` between them, and each column's flex/overflow behaviour. Its consumers
are the Rollbar, Linear, API and Database panes plus the Editor, Notes, Agents and Changes task
panes, and Rollbar's occurrence workbench nests one inside another; before it existed those eight had
eight column widths and two different border roles, which is why they read as variations on a pane
rather than the same pane.

**The list column is flat — no tint.** The four task panes each gave it `--bg-subtle` and the four
rail/frame panes did not, so the split read differently depending on which rail you reached it from.
One surface divided by a rule, not two shaded regions. There is no opt-out prop, because a per-pane
choice is the thing this replaced.

A list column that can be collapsed passes `list={undefined}` rather than hiding a column that is
still in the grid — `ListDetail` then has one track instead of a zero-width first one. Notes' library
toggle works this way.

It is deliberately not the layout for two separate surfaces. Docker's browse and the GitHub PR pane
are `.panes` + `.pane` from `styles/shell.css` — inset surfaces with a gap between them, and in the
PR pane's case a `SplitHandle` that makes the divide draggable. That layout stays the shell's. The
test is whether the two columns are one surface split by a divider or two surfaces side by side.

**A Source with fewer than three columns spans the shell grid; it never redefines it.** `grid-column:
2 / -1` on the last pane is how GitHub's empty state, the editor pane and Docker's browse all say it.
A plugin that writes its own `grid-template-columns` for `.panes` gets a column width that only
resembles the shell's — Docker's was `clamp(320px, 30vw, 460px)` against the shell's
`clamp(320px, 28vw, 420px)` — and a rule that has to out-specify every style pack's own
`.app.left-collapsed .panes`. Spanning has neither problem and needs no CSS at all.

`ListDetail` sets no narrow-width behaviour. Stacking the columns needs a container query rather
than a media query, and `container-type` would make the element a containing block for
`position: fixed` descendants, which silently mispositions any `Modal` rendered inside it. A pane
that wants to stack declares it on its own class.

## Chrome and overlays

A loaded plugin's `overlay` frame surface (`docs/plugins.md`) gets an explicit height from the host,
not a `max-height`: the iframe inside sizes to 100% of its container, so a container sized by its own
content would size to nothing. The same reasoning applies to a `refPanel` frame's iframe inside its
fixed-height drawer column: asking for `height: 100%` there would mean 100% of the whole drawer and
overflow past the header, so the frame takes the drawer's remaining space instead, matching what the
enclosing flex column already implies.

The toast stack sits above `--term-drawer-h`, the terminal drawer's published height (set on
`documentElement` by the terminal plugin, with a fallback for a window where that plugin is not
mounted), so a toast never renders behind the drawer. The stack itself ignores pointer events so it
never swallows a click on the app behind it, and each toast re-enables its own.

The command palette and the file finder share one surface, `PaletteSurface`, rather than the
near-duplicate `.palette-*` and `.finder-*` rule sets that used to exist side by side.

Modal dismissal (Escape, backdrop click, Tab focus containment) is `ui/dismissable.ts`, a hook
returning handlers rather than a component; markup stays at the call site. Nine call sites
hand-wrote this before it existed, five of them with only a backdrop click and nothing else, so Tab
walked straight out of the dialog into the page behind it and Escape did nothing. `Modal` and
`Drawer` both use it verbatim, which is what keeps them purely cosmetic and safely reviewable.

Escape is handled twice on purpose: once on the dialog element, and once on the document. The
element handler alone only fires while focus sits inside the dialog, and focus drops back to the
body as soon as the focused child unmounts, so a modal could end up ignoring Escape entirely. The
document handler answers for the topmost dialog that is still in the page, which lets a stack of
them unwind one press at a time, and it stands down when the element handler has already claimed
the key. The overlay palettes (command palette, file finder, workspace switcher) do not use it:
`createOverlayPalette` already owns their dismissal, focus restore, and single-active-overlay
coordination.

## Tooltips

A tooltip is four data attributes, honoured on any element anywhere, not a `<Tooltip>` wrapper
component:

| Attribute | Meaning |
| --- | --- |
| `data-tip` | The tip text. Required; no attribute, no tip. |
| `data-tip-sub` | A second, muted line. |
| `data-tip-key` | A keyboard chord, rendered as a key cap. |
| `data-tip-legend` | A JSON array of status markers (icon name, `StatusDot` tone, colour tone, meaning). `RailTab` serialises this from its own markers; call sites never build it. |

A wrapper component adds an element around every trigger, which changes layout; attributes work on
plugin-contributed markup, need no per-site listener, and cost one delegated listener for the whole
document. This outgrew the task rail long ago: it was `tooltip/RailTips.tsx`, used by four core
surfaces and exactly one plugin, while about fifty other sites fell back to native `title=`, which
is slow, unstyled, and invisible to keyboard users on some platforms. Native `title` stays
acceptable only where the styled tip cannot reach, inside xterm's canvas, for instance.

The tip is a singleton, positioned `fixed` so it escapes a scrolling list that clips absolutely
positioned children. Side is automatic: the right rail (`.pane-switcher`) flies left, everything
else flies right, and the CSS offset anchors to whichever side the bubble is pinned to, with `right`
rather than `left` plus a transform so the bubble keeps real layout width instead of squeezing to
the edge. A legend entry mirrors one active rail status marker, placed or crowded out, so the tooltip
both reports current state and teaches what each glyph on the rail means.

A sandboxed plugin frame has its own document, so the shell's tooltip singleton cannot see elements
inside it and `data-tip` would otherwise be silently inert there. `ui/frameTips.ts` mounts the same
delegated listener and bubble markup into a frame's document, the way frames already mount their
own copy of the shared CSS. It stays framework-free and importless on purpose: it is reached from
`@acorn/plugin-api/ui/sdk`, which bundles into a plugin's frame and must not drag a slice of the
shell, or a second copy of Solid, across that boundary.

## Drag-to-resize

`ui/split.ts`'s `createSplitDrag` is the drag-resize hook behind the pane row divider, the terminal
drawer's height handle, and the document surface's split. Three hand-rolled splitters existed
before it, and none had a keyboard contract.

It reports a pixel delta, not a value, because the three call sites model size differently: the
pane row resizes two adjacent panes against each other by a delta, the drawer owns one absolute
height, and the document surface owns a fraction. A delta is the one thing all three can turn into
their own units; a `value`/`onChange` hook would have fit only one of them. It owns pointer
capture, rAF coalescing, text-selection suppression during the drag, and `role="separator"` with
arrow/Home/End keys. Persistence stays with the caller, since only the caller knows what it is
persisting: a preference, a layout weight, a fraction. It is the same idiom as `dismissable.ts`:
behaviour as a hook, markup at the call site.

A drag that outlives its component would keep moving panes that no longer exist, so cleanup runs on
unmount. Clearing `document.body.style.userSelect` removes the property rather than restoring a
snapshot, because a snapshot taken while an earlier drag was still stuck would preserve `none`
forever; removal heals a document that already leaked one. Both `pointerup` and `pointercancel` are
handled, since an interrupted gesture fires `pointercancel` instead and losing pointer capture
mid-drag fires neither; missing either path once left the whole document unselectable for the rest
of the session.

## Interaction rules

- Command palette opens with `⌘K` and uses contributed actions and rows.
- `⌘1`–`⌘9` activates the corresponding visible task.
- `⌘⇧T` toggles the terminal drawer; `⌘⇧N` creates a task; `⌘P` opens the file finder.
- Pane chords are contribution-owned and user-overridable through Settings → Shortcuts.
- Typing fields, editors, terminals, and contenteditable elements stop global shortcuts unless the
  action is explicitly text-safe.
- Destructive actions and approvals use shell-owned confirmation chrome.

### Menus and right-click

There is one menu. `ui/Menu.tsx` owns the surface — `role="menu"`/`menuitem`, arrow-key roving with
Home/End, close-on-select, Escape, outside-click, and focus returning to where it came from — and both
ways of opening it mount that same surface (`MenuSurface`) over the same hook (`ui/anchor.ts`). A
button anchors it to a rect; a right-click anchors it to a point, which is the only difference. A
right-click menu with its own markup would be a second place for the accessibility to be wrong.

**Right-click is never the only door.** The rows come from the context-menu registry
(`registries/contextMenus.ts`), and the button menu on the same row renders the identical list, so
nothing is mouse-only. It is also keyboard-reachable directly: `contextmenu` is what the platform
dispatches for Shift+F10 and the menu key as well as for the right button, and the surface focuses its
first item on mount, so the menu is operable the moment it appears rather than something to Tab into.
Point-anchored menus clamp to the viewport rather than flipping — the pointer really can be a pixel
from the bottom edge, and there is no trigger rect to fall back to.

A contribution is a label, an optional icon, an order, a predicate over the host-defined target, and
one action. Core's own rows fit that shape — the tab rail's Pin/Unpin/Rename/Archive are registrations,
not inline JSX — which is what makes the contract real before a plugin uses it. Plugins declare the
same thing from a manifest (`docs/plugins.md § Context menus`); the host binds the owner into the id
and evaluates the declared predicate itself.

`RowActions` is the button half of that shape as a component: an ellipsis `Button` wrapping a `Menu`,
placed `bottom-end`, that swallows the click so the row underneath it does not activate. Every list
row that offers an action uses it, so the affordance sits in the same corner and reads the same way
in a plugin's list as in the shell's own. Today it holds one item in three lists, `Create task` in
the GitHub pull list and in the rail list every descriptor source renders through. The agent session
sidebar, which is where the pattern came from, keeps its stop, rename, and archive rows.

It carries its own reveal rather than taking `Row`'s `reveal`, and the difference matters. `Row`
hides the whole trailing slot, which is right when actions are all that slot holds. A rail row also
puts a badge there, and a badge that disappears until you point at it is a badge nobody reads. So the
CSS hangs off `.ui-row-actions` and keys on the row's `:hover`, `:focus-within`, and `[data-selected]`
plus the button's own `aria-expanded`. The last one is not redundant: the surface is portalled, so
while the menu is open, `:focus-within` on the row is false and the trigger would otherwise fade out
from under the menu it opened.

Both `Menu.tsx` and its anchoring hook (`ui/anchor.ts`) replaced hand-rolled implementations that
had each solved less of the problem: TabRail's task menu had neither outside-click nor Escape nor
roles, terminal's profile menu had no portal at all so an overflow ancestor clipped it, and
AccountMenu and NotificationBell each hand-rolled their own outside-click listener. `anchor.ts` owns
dismissal and geometry only; list semantics come from `focus.ts`, markup from the call site. It
takes no flip/collision middleware beyond a `placement` flag and a re-measure on reflow, extended
only when a real collision case turns up.

The portal is why an overflow-clipped pane no longer cuts a menu off at its edge: an absolutely
positioned child cannot escape an ancestor that sets `overflow`, so it renders through a portal
instead and is fixed-positioned to the trigger's rect. That positioning works unchanged inside a
sandboxed plugin frame, where the "viewport" is just the frame.

`Menu.tsx` layers menu semantics on the same hook: items are buttons, not Rows, because menus have
their own semantics and forcing every clickable through one shared component would blur that.
`Menu.Item`'s `onSelect` closes the menu, with one exception: `closeOnSelect={false}` exists for
arm-to-confirm items, whose first press has to survive to show its armed label
(`createArmedConfirm`, `ui/confirm.ts`) rather than close under it.

An `AnchorTarget` can be a point as well as an element; a point is a zero-size rect, so everything
downstream of the positioning math already works unchanged, which is what lets `ContextMenu` reuse
`MenuSurface` for a right-click instead of building a second menu. Visibility is the caller's state,
since a right-click menu belongs to whichever row was clicked; the surface remounts, keyed on the
`at` point, so right-clicking a second row does not leave the first row's items registered on it.

## States

Every Node-backed surface can show live, refreshing, stale, offline, disabled, or error. Stale data
retains its last value and names the Node. Offline mutations fail fast and keep typed input. Empty
states explain whether a feature is unconfigured, provider-gated, disabled, or simply has no data.

`disabled` (the plugin is off) takes precedence over everything else, because it is not a data state.
After that, an unreachable Node outranks `refreshing`: a fetch against an offline Node is going to
fail, and calling it "refreshing" would be an infinite spinner. `degraded` (the WebSocket is down but
HTTP still answers) counts as `stale`, since reads keep working but nothing on screen is being updated
by live events. No surface may show a spinner with no deadline: past that deadline it resolves to
`stale`, `offline`, or `error`, never keeps spinning. `error` means there is no data and a retry is the
useful next action; a row served from cache uses `stale` or `offline` instead, because it does have
data. Ages shown next to `stale`/`offline` read "never" rather than a fabricated `0` when the Node has
not answered once this session.

## Accessibility and density

Focus rings, keyboard traversal, text labels, tooltip delays, and reduced-motion tokens are shared by
client-core primitives. Dense layouts must preserve readable line height and a visible focus target;
style packs may compress spacing but must not hide status or action affordances.
