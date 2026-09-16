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

The terminal draws the same hierarchy at a quarter of the size, and where it differs it differs
because there are no pixels to spend (`apps/tui/src/chrome/`):

```text
Topbar:   one line. Workspace, task count, the open branch, the node's state as a dot
Rail:     a column of tasks, browse sources under a rule; two cells of marks below 100 columns
Main:     one pane, with a strip of pane labels above it
Overlays: the palette, the cheat sheet and a quit confirmation, drawn where the pane is
Footer:   one line. What the keyboard will do, and the node's state when it needs a sentence
```

Three differences are worth naming. There is one pane rather than a row of them, because two panes at
80 columns are two 40-column panes and the kit's own floor is 80, so `nextPane` switches which pane is
drawn instead of walking to the next one. The region cycle is the whole screen rather than the focused
pane, for the same reason: rail, pane strip, the pane's own regions, and back. And an overlay hides the
pane rather than replacing it, so opening the palette does not tear down the pane's queries and its
model.

The rail's task list goes through the same `rail.taskList` exclusive slot the desktop's does, so a
plugin that offers to replace it replaces it on both hosts. The topbar and the pane strip are bespoke
on both until `docs/future/client-plugins/04-replaceable-surfaces.md` gives them contracts.

The topbar spans the window. The rails and the panes all begin under its bottom border, so that
border is one unbroken line across the app: the left TabRail is the first thing in `.shell-body`, the
right pane switcher is fixed at `top: var(--topbar-h)`, and the two meet the same pixel because the
bar's height is stated rather than left to its content.

Both vertical rails, the TabRail on the left and the task pane switcher on the right, are built from
one component: `tabs/RailTab.tsx`, a square control styled by `.tabrail-tab`. Its side is
`--pane-head-h`, the height of the pane header it runs beside, so a rail button, a pane header and
the top bar read as one row height and a style pack that moves the header moves the rails with it. Every control in
both rails goes through it, including the bottom-pinned "+" on the left and "close task" on the
right, which share the `.tabrail-bottom` modifier and therefore the same box. It is not a Button. A
rail control hovers by changing its icon and background only, and `.ui-btn:hover` also moves
`border-color`, which lit the right rail's own dividers on hover and made the two sides look
unrelated. `.pane-switcher` restates only what genuinely differs on the right: the glyph font and an
active accent on the right edge instead of the left.

### Rail controls and status markers

`RailTab` is presentation only. It takes a `label` (which becomes both the tooltip title and the
accessible name), a `glyph` resolved through `kit/components/content/Icon.tsx`, and explicit `active`, `tone`, `accent`,
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
an optional `busy` flag, and an ordered list of the positions it would like. `busy` means "this state
is live": it spins an icon marker and pulses a dot one.

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
and activity, because it sits under the main glyph rather than in a corner. Two states use it, at
opposite ends of a task's life: a pulsing dot while its setup script prepares the new worktree, and a
spinner while teardown removes it.

Core's markers come from `tasks/railStatus.ts`. Plugins publish theirs through
`features/tabs/railMarkers.ts` ([plugins.md § Rail markers](./plugins.md)); contributed priorities are
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

Every component a plugin may draw with is in one list, in `packages/client-core/src/kit/`, reaching
plugins through `@acorn/plugin-api/ui`. The list is closed: a component's props are role tokens,
content, counts, booleans, and handlers, and never `class`, `className`, `style`, or a DOM attribute
passed through. `@acorn/plugin-api/ui/tokens` carries the role enums and the support matrix as data,
with no components on it, so a node-environment test can read them.

**A node earns its place only if all four of these hold.** The list is closed, so the interesting
question is what gets in, and this is the answer that keeps it small:

1. Two or more plugins need it, or one first-party pane cannot be expressed without it.
2. It has a written rendering at 80 columns by 24 rows in monochrome, and a component on the terminal
   host that draws it. If that sentence cannot be written, the thing is a rectangle, not a node.
3. Its props are semantic: tone, emphasis, size in three steps, grouping. Never a pixel, a colour, a
   class, or a style.
4. If it is an extension kind, one host-owned sentence describes it in the trust prompt, and a person
   would knowingly accept that sentence.

The same rule with the same four conditions applies to layouts, in
[docs/panes.md § Layout model](./panes.md#layout-model), where condition 2 is a written narrow and
terminal projection rather than one sentence.

Three things follow from closing it, and each has a test.

**A node takes a meaning, not a value.** `tone="danger"`, `gap="section"`, `size="sm"`. A plugin
never names a pixel, a colour, or a class, so the same tree can be drawn by a host with no pixels.
`kit/tokens/tokens.ts` declares the six enums and `kit/tokens/roles.ts` maps each role to a CSS custom
property and to a terminal value. That mapping is the only place outside a stylesheet that names a
custom property.

**A node says which hosts can draw it.** `kit/tokens/support.ts` holds a row per node with a `dom`
column and a `tui` column, at one of four levels: `full` draws it natively, `reduced` draws it with
named things missing, `fallback` draws a stated substitute, and `absent` draws nothing unless the
node has a `<Fallback>` child. A `reduced` row names what is missing in a `loss` beside its level,
because "named things" is the load-bearing half of that word and an author predicting a host should
not have to open a second file. The 80-column sentence for each one is in
[Every node at 80 by 24](#every-node-at-80-by-24) at the end of this page.

Which host a build draws to is `HOST` in the same file, supplied by the host package at build time,
because it is a fact about the bundle rather than about the run: `apps/desktop`'s Vite config defines
it `dom` and `apps/tui`'s defines it `tui`. Where nothing defines it — a test, a plain browser served
by a node — it is `dom`. `Only` and `Fallback` are the only things that read it, and that is the rule:
a node that wants to know which host it is on is a node about to draw something host-specific, and the
answer to that is a `<Fallback>` child, not a branch.

Two hosts exist, and both draw the whole kit. `dom` is the desktop and the browser, from
`client-core/host/tree/components.ts`. `tui` is the terminal, from `apps/tui/src/kit/components.tsx`,
since 2026-08-31 (`docs/tui.md`). The two tables have the same
keys as each other and as this matrix, held by `tools/arch/kitTable.test.ts`, so a node cannot be
added to one host and forgotten on the other, and nobody adds a node at all without deciding what it
does on a host with no pixels.

**The classes moved inward.** A kit component keeps its `ui-*` classes and styles its own children
by position, as in `.ui-code-wrap > .ui-btn`. Nothing exported accepts a class, `cx.ts` is internal,
and a pane that wants a control to look different asks for that in the kit rather than in its own
stylesheet.

**One node is a picture, and it is still a list.** `Graph` draws cards on a grid with the edges as
curves: the workflows editor authors a definition on it and the run pane watches a run on it. It is in
the kit rather than in the plugin because plugin client code may not emit raw DOM or SVG, and a canvas
is the one thing a terminal cannot draw — so admitting it meant writing both projections first. In
cells it is the indented list the editor already drew: the same cards, the same order, the same
selection, indented by rank instead of placed by coordinate. `kit/lib/graphLayout.ts` is the geometry,
shared by both hosts, so the two cannot disagree about which card sits under which. Where a card goes
is a device preference the caller holds, never part of what it is drawing.

**One node is a box, and admits it.** `Rectangle kind="pty" | "webview" | "frame" | "editor"` is what
the kit offers a surface that owns its own pixels: a PTY, a webview, a plugin's iframe, a code editor.
The node owns the box and the keyboard contract, one tab stop from outside, Enter to hand the keys to
whatever is inside and Escape to take them back. What draws inside it is not the kit's business. Four
kinds and no fifth, because the name says what is in there and a kind a host does not know is a
rectangle nobody can project: on a terminal `pty` and `editor` are native and the other two draw their
`<Fallback>` child.

`mount` is how the thing inside gets its element. Everything a rectangle holds wants a DOM node of its
own, and each of the five sites used to write its own `<div ref={host}>` beside a stylesheet giving it
a size. The host draws the element and hands it over, which is why the terminal drawer, Docker's exec
tab, the browser preview, the editor pane and the host's document surface now spell no element and
ship no CSS between them.

`Only` and `Fallback` are the two host wrappers. `Only hosts={['dom']}` draws its children on the
named hosts and nowhere else. `Fallback forNode="Grid"` draws its children where the matrix says
this host cannot draw that node. Both are here before there is a second host, so a plugin can be
written against one before it arrives.

**A node has one name, and a handler has one of eleven.** Both fell out of the remote path, where a
node is a type string on a message port and a prop is JSON. A compound spelling has nowhere to put its
dot, so `Modal.Body`, `Modal.Actions`, `Tabs.Panel` and `Toolbar.Spacer` are also exported as
`ModalBody`, `ModalActions`, `TabPanel` and `ToolbarSpacer`; the dotted names stay as aliases because
they read better beside the node they belong to. And a callback prop is only sendable under one of the
kit's eleven semantic events, which is why `Modal` takes `onDismiss` rather than `onClose`, `Input` and
`Textarea` take `onChange` for the committed value rather than `onCommit`, and `Grid` takes `onSelect`
rather than `onSelectRow`. A name outside the eleven — `onInput`, `onKeyDown`, `onPaste` — still works
in the shell and is dropped on the way to a sandbox, which is the honest answer: a terminal host has
no paste event to deliver.

**Behaviour a pane keeps redoing becomes a node's prop.** Three arrived with the agents pane, and each
replaced a copy of the same machinery in a plugin. `Timeline follow` makes the timeline the scroller
and keeps it on the newest turn until the reader scrolls away, with the place they left held per
`viewKey`; the transcript had 80 lines of that and github's conversation will want it too. Both hosts
put the scroller on the timeline and let the region around it clip, which is what keeps a pane's
header and composer pinned where the reader can reach them ([tui.md](./tui.md) § Scrolling viewports). `Card focus`
puts the reader on one card, which is the same argument that made collection state the host's: a pane
told "show this item" holds a key and nothing else, and the kit gives it no class and no id to select
on. `Rows` hands back the same item object for an unchanged key, so a list rebuilt from a live store
reconciles instead of remounting, which is what used to replace a row several times a second while an
agent was fanning out.

Both of those props answer to the same rule: **a background change never moves the reader.** For
`Card focus` it means the reveal is dropped outright when the caret is in a text box: some callers hold
`focus` as state rather than issuing it as a command, so a list that refetches rebuilds its rows and
re-issues a reveal nobody gave, and the person who finds out is the one whose sentence lost the caret.

For `Timeline follow` it means **a place is a turn, not a pixel.** "Two thousand pixels down" only
means something while everything above those two thousand pixels keeps its height, and in a live
transcript nothing does: a message keeps streaming, a code fence grows, an image loads, highlighting
lands a frame or two after the paint. So the reader's place is the turn the viewport starts in and how
far into it, which is `ReadingPlace` in `kit/lib/readingPlace.ts`, and putting them back is a
correction measured against that turn's current position rather than an offset replayed. Following is
the same value's other case, not a flag beside it, because the two used to be kept in agreement by
hand and every defect found in that code was them disagreeing.

The place only changes on the reader's own gesture, and a gesture lasts a second. A list that shrinks
makes the browser clamp the scroll offset and fire a scroll event that by position is
indistinguishable from someone scrolling, so a scroll with no gesture behind it changes nothing and
the next frame puts the reader back: on their turn, or on the foot if they were following. The second
counts for as much as the gesture does. Most input scrolls nothing at all, a click into a card or a
drag across a line, so the gesture it armed used to sit there until something else moved the view, and
that move was then filed as the place the reader chose. Focus counts as a gesture when it lands on a
turn in this list, because revealing a card scrolls it into view and then focuses it.

A list that the reader has no place in opens at the foot, and so does a list they were following.
Those two are the same value, `{ at: 'live' }`, which is also why the timeline acts on a place equal
to the one it already holds: the caller only reads its store again when the view has changed, so two
live places in a row are the feet of two different lists. Treating that as nothing to do left a reader
who switched sessions sitting at the old transcript's offset, partway down one they had never seen.

One move has no signal of its own: the page taking the list away and putting it back. A scroller that
was detached comes back at the top, and the browser reports neither a scroll event nor a resize for
it, so the timeline watches its parent's children for that and runs the same correction it runs for
every other move nobody asked for.

What produced it was the `Suspense` around every pane region ([panes.md](./panes.md)). A query in the
region reading an empty cache suspends that boundary *after* it has drawn, so every child left the
document for the length of the fetch, and a reader who created a task from a pull request watched the
diff appear and then go. Solid is patched so a boundary that has drawn never swaps back to its
fallback (`patches/README.md`), which leaves the boundary covering the module it was put there for and
nothing else. The timeline keeps its observer, because re-parenting is not only that boundary's to
do.

The timeline does not keep the places. `place` and `onChange` hand them to the caller, because
navigation disposes a task's panes on purpose ([panes.md](./panes.md)), so a place kept in the
component is a place lost on every workspace switch, and a map hidden inside a kit node has no owner to
scope or clear it. The agents plugin owns them, beside the drafts, in
`plugins/agents/src/client/sessions/readingPlaceStore.ts`.

**A prop that has to hold an element has a data form beside it.** `ListDetail`'s `list` prop cannot
cross, so `ListColumn` and `DetailColumn` are children; `Picker`'s `results(query)` callback cannot, so
`items` is a list it filters itself; `DescriptionList.Item` children cannot, so `Facts` takes
`{ label, value }` pairs. The callback forms stay for shell code, which is where the extra power is
actually used.

### The three kit invariants

Modelled on `styles/tokenAxes.test.ts`, which reads the stylesheets and asserts they agree with the
declared axes:

- `kit/tokens/support.test.ts` reads the `/ui` barrel and asserts that the nodes it exports and the rows
  in `NODE_SUPPORT` are the same list, with a `tui` level on every row.
- `kit/tokens/roles.test.ts` asserts that every role in every enum has a DOM value and a terminal value,
  and that each DOM value names a token `tokenAxes.ts` declares.
- `kit/tokens/props.test-d.ts` is a type-level test: no exported node's props accept `class`,
  `className`, `style`, or `classList`, and no role-typed prop accepts an arbitrary string. It has
  nothing to run. `tsc --noEmit` across every package is the check, which `pnpm lint` already makes.

### How the kit is built

`primitives.css` holds the shared CSS for the components in `kit/components/primitives.tsx` and the component
files beside it. Specificity is layered by convention: a node's base rule is a bare class, `(0,1,0)`;
a variant selector adds an attribute, `(0,2,0)`; a style pack's override adds a
`:root[data-style="x"]` prefix, `(0,3,0)`. A pack wins because it is more specific, never because its
stylesheet loads last.

`kit/lib/adoption.test.ts` was a migration ledger: a list of files someone had converted, each checked for
raw controls. Phase 9 of the layout programme finished the conversion and inverted it, so what is left
are rules rather than a list. **No plugin draws a raw `div` or `span`.** A plugin's tree is kit nodes,
and a raw element is how a plugin used to reach a class in the host's stylesheet. It is also the one
thing that cannot cross to a worker, so a plugin that emits one has written something a loaded plugin
could not. The rule names those two tags and not `section`, `table` or `input`, which are markup with
meaning rather than markup with a class. Two arch rules in `tools/arch/boundaries.test.ts` hold the
rest: **no plugin ships a stylesheet**, and **no plugin mounts a Solid root of its own**, because a
root the host does not know about sits outside every focus group and no intent reaches it.

The CSS clash and Checkbox checks stay, for the host's own code. Core still writes elements and
stylesheets and can still lose a rule to a primitive's own attribute selector.

**`Markdown` renders block by block, and that is a contract rather than an optimisation.**
`kit/lib/markdown.ts` exposes `renderBlocks(text)`, which returns one `{ key, html }` per block with
the key hashed over that block's own source, and `renderMarkdown` is now that list joined. The
component keeps the element it rendered for each key, so an update replaces only the blocks whose
source moved: appending to a message changes exactly one key, its last. Three things follow, and every
caller depends on at least one of them.

- **A reader's text selection survives an update.** Rewriting `innerHTML` replaces every text node
  underneath it, and the agent transcript updates a streaming message about 25 times a second. Only
  the growing block's node is now replaced.
- **A copy button lives on its block**, so it is mounted once rather than disposed and re-created on
  every tick.
- **A closed code fence is highlighted once.** Its block keeps its element, so nothing asks the
  highlighter again. Behind that, `infra/highlight/shiki.ts`'s `highlightToHtml` keeps a small
  first-in-first-out cache of fence html keyed by the exact text and language, which catches the same
  fence coming back after a scroll or a remount.

The `images` option decides what an image in the source becomes, and the flavour is part of the block
key, so two surfaces sharing the cache cannot share a block. `inline` renders an `<img>`, for text a person
wrote. `placeholder` renders the alt text and never issues the request, for text a model produced,
where a remote image is a tracking pixel carrying the reader's IP. `thumb` is `inline` drawn as a short
band across whatever holds it and cropped to fill, for a picture that stands in for a file rather than
being the content: an attachment above its filename, where full size would push the rest of the card off
screen.

A fence takes its colour from the theme rather than from Shiki. `highlightToHtml` asks for the
dual-theme html with `defaultColor: false`, so each token leaves carrying both colours as `--l` and
`--r` and none of them leaves carrying a fixed one, and `.ui-markdown .shiki` picks a side with
`light-dark()` the way `.diff-code span` does. Shiki's default writes the light colour into `color`
and hides the dark one in a `--shiki-dark` that no stylesheet here reads, which is how a fence under a
dark theme came to draw github-light on a white background.

The one rule a caller has to keep is the one the component already had: `text` is read in an effect,
and a prop is a getter rather than a memo, so the effect re-runs whenever anything upstream ticks. The
guard on the last rendered string is what stops an identical value from touching the DOM at all.

### What the kit refuses

Each of these will be asked for again and the request will sound reasonable, so the argument is
written down once. The security-shaped refusals — an iframe inside an iframe, free `postMessage`
between plugin origins, nested slots, reopening `frame-src` — are in
[docs/security.md](./security.md), and the plugin-shaped ones in
[docs/plugins.md](./plugins.md).

**Styling props on kit nodes.** No `class`, `className`, or `style`, including "just for desktop" and
"just for first-party". The moment a plugin can name a pixel or a colour, the kit stops being portable
and a terminal host has to guess what was meant. Desktop visual tuning moves into the kit's own CSS,
once per component. A plugin that needs its brand purple has a rectangle, priced honestly as
DOM-only.

**Raw scale values in a plugin-facing enum.** `space.row`, never `space.3` or `gap: 8`. A scale step
is a value; a role is a meaning. Each host maps roles to its own values, and a terminal has no value
for `8`.

**Plugin-positioned layout.** A plugin picks a layout and fills regions. It never says where a region
goes, how wide it is, or which way things flow. `orientation`, `columns` and `width` knobs are
refused; a new named layout is the answer when eight is not enough. Position is in the name, which is
the rule templates set before there were layouts.

**Anything that depends on hover.** Hover exists on a DOM host with a pointer and nowhere else. The
kit uses it for affordance only, and everything reachable on hover is reachable by focus.
`kit/tokens/hover.test.ts` reads the stylesheets and fails if a `:hover` rule reveals something no
`:focus-within` rule reveals. A `RowActions` that appears only on hover is a bug, not a style.

**Controlled and uncontrolled selection mixed on one node.** The host owns `selected` by default; a
node that declares controlled mode is controlled for every operation. Never half. Supporting both on
one node is a steady source of bugs in every library that has tried it.

## Icons

`kit/components/content/Icon.tsx` takes a **name string** and resolves it against two families, in this order:

1. A **`brand:`-prefixed name** is a brand mark from `kit/tokens/brandMarks.ts`: one SVG path's `d`
   attribute in a 24 box, drawn as a single `<path fill="currentColor">`.
2. Any **other name** is a Lucide glyph from `lucide-static/icon-nodes.json`, drawn stroked and
   unfilled in the same box, node by node through `<Dynamic>` and never `innerHTML`.
3. An **unmatched name renders as text** in a `span.glyph`. That fallback is load-bearing rather
   than a nicety — the remaining inline literals (◆/◇ pin state, ⊘/◉ hidden) ride it, which is also
   why `--font-glyph` survives the brand marks leaving.

`Icon` takes two more props, and both are things a call site could not say without a class. `tone`
is a role token, so a state mark is coloured the way every other kit node is coloured;
`tone="brand"` asks the registry for the mark's own colour and holds it to the theme's contrast
through `--brand-legible`, which is how a provider's mark is drawn wherever a surface names the
provider. `spin` turns the mark, for a state that is in flight. It carries no reduced-motion guard,
unlike `.spin`: on a state icon the turn is the whole signal that something is running, and a 12px
rotation is not the motion that setting exists to stop.

The `brand:` prefix exists so the two families can never collide (Lucide has grown brand-shaped
names before and will again) and so brand marks stay out of the Lucide name list
`kit/components/inputs/IconPicker.tsx` enumerates for user-chosen task icons. Putting them in that
picker is then a deliberate one-line decision rather than something that happens by accident.

### Which names are drawn without waiting

Lucide ships 1,756 icons and 706 KB of geometry, and step 2 above resolves a name at render time, so a
bundler cannot see which names are reachable and used to put all of it in a chunk the window loads
before it draws. The set is split in `kit/tokens/iconNodes.ts`:

- **The eager half** is every Lucide name spelled as a literal in this repository's product code —
  77 of them, about 14 KB — written to `iconNodes.eager.json` and carried by the chunk that holds
  `Icon`. Those draw on the first pass with nothing awaited.
- **The lazy half** is the rest, behind `() => import('lucide-static/icon-nodes.json')`. A name only
  that half has takes the text fallback for one frame, then becomes an SVG when the map lands.

The eager half is **generated, never hand-kept**. `packages/client-core/scripts/icon-census.mjs`
scans `packages/`, `plugins/` and `apps/` for `name="…"`, `icon: '…'` and `glyph: '…'` literals that
are Lucide names, and client-core's `lint` re-runs it in `--check` mode. Spell a new icon in the tree
without regenerating the file and lint fails, naming the icon, because the alternative is that the
icon ships in the lazy half and flashes as its own text. Run
`pnpm --filter @acorn/client-core icons` and commit the result.

Nothing is dropped. A person can assign any of the 1,756 to a task and a plugin manifest can name any
one, and both choices are persisted, so a build-time census of what is reachable would break stored
data. The split moves the bytes; it does not lose the names.

Two consumers must never show that one frame, so they ask for the full map up front: `IconPicker`,
whose whole purpose is the other 1,679, and `features/tabs/TabRail.tsx`, whose rows draw whatever
icon the owner picked. The rest of the chrome only ever names an eager icon, so it never sees the
miss. A new surface that draws a **stored** icon name should call `loadIconNodes()` when it mounts.

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

`brandStyle(name)` in `kit/tokens/brandMarks.ts` turns an icon name into two custom properties on the element
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
`plugin/contract.ts` checks `/^#[0-9a-f]{6}$/i`.

A frame is the exception to all of this, because it is a separate origin and a separate JS realm with
no reach into the registry. It draws its own copy of the mark and sets its own `--brand` inline. That
is one of the things the tree path takes back: a plugin that draws a tree names `glyph: 'brand:linear'`
like anyone else, because the component that resolves it is the host's. Linear and Rollbar each deleted
an inlined SVG when they moved (phase 5 of the layout programme).

A mark is one SVG path's `d` attribute in a 24x24 box, not a full SVG document. A document would
allow `<script>`, `<use href>`, `<image href>`, `<foreignObject>`, `on*` handlers, and CSS
`@import`, which would need an allowlist parser and a new trust boundary for what is only a logo.
There is nothing in `d`'s grammar to sanitise, so a manifest-supplied mark needs only a
character-class check (`node-core/server/plugins/manifest.ts`) and renders through the same `<path>`
machinery `Icon.tsx` already had. `Icon` fills it with `currentColor`, so a plugin's mark themes
across every theme exactly as a first-party one does, which a data-URI `<img>` could not, since CSS
does not cross into its document.

## Two-column panes

`ListDetail` is a kit node, and it is not the same object as the `list-detail` *layout*. A pane's
regions are its outer arrangement and the host draws them
([docs/panes.md § Layout model](./panes.md#layout-model)); a split drawn *inside* one region is the
pane's own, and this node is how it draws it. The PR pane is both at once: a `single` layout whose one
region holds a `ListDetail`, because its two columns are one surface over one model rather than two
regions the host mounts apart.

A pane or a region that puts a list beside a detail uses that node, not a hand-rolled grid. It
owns the split, the three column widths (`narrow` for an identifier switcher, the default for a browse
list, `wide` for a column that holds a document rather than a picker), the `--chrome-divider` between
them, and each column's flex/overflow behaviour. Its consumers are the Rollbar, Linear, API and
Database panes plus the Editor, Notes, Agents and Changes task panes, and Rollbar's occurrence
workbench and GitHub's browse each nest one inside another; before it existed those eight had eight
column widths and two different border roles, which is why they read as variations on a pane rather
than the same pane.

A list column is flush and scrolls its own rows. A column holding a document instead says so with
`scroll`, and then it scrolls as one region and takes the pane's inline padding, the same rule
`single` and `header-body-footer` apply to their bodies. GitHub's browse is the case: its middle
column is a pull request, not a picker.

**The list column is flat — no tint.** The four task panes each gave it `--bg-subtle` and the four
rail/frame panes did not, so the split read differently depending on which rail you reached it from.
One surface divided by a rule, not two shaded regions. There is no opt-out prop, because a per-pane
choice is the thing this replaced.

A list column that can be collapsed passes `list={undefined}` rather than hiding a column that is
still in the grid — `ListDetail` then has one track instead of a zero-width first one. Notes' library
toggle works this way.

It is deliberately not the layout for two separate surfaces. The test is whether the two columns are
one surface split by a divider or two surfaces side by side; `.panes` + `.pane` from
`styles/shell.css` is the second case, inset surfaces with a gap between them.

**A Source with fewer than three columns spans the shell grid; it never redefines it.** `grid-column:
2 / -1` on the last pane is how the chrome source panel says it. A plugin that writes its own
`grid-template-columns` for `.panes` gets a column width that only resembles the shell's — Docker's
was `clamp(320px, 30vw, 460px)` against the shell's `clamp(320px, 28vw, 420px)` — and a rule that has
to out-specify every style pack's own `.panes` override. Spanning has neither problem and needs no
CSS at all.

`ListDetail` sets no narrow-width behaviour. Stacking the columns needs a container query rather
than a media query, and `container-type` would make the element a containing block for
`position: fixed` descendants, which silently mispositions any `Modal` rendered inside it. Narrowing
is the layout's job, not a node's: the `list-detail` layout carries the narrow projection, and a pane
that wants one names that layout instead of nesting this node.

## Chrome and overlays

A loaded plugin's `overlay` frame surface (`docs/plugins.md`) gets an explicit height from the host,
not a `max-height`: the iframe inside sizes to 100% of its container, so a container sized by its own
content would size to nothing. The same reasoning applies to a `refPanel` frame's iframe inside its
fixed-height drawer column: asking for `height: 100%` there would mean 100% of the whole drawer and
overflow past the header, so the frame takes the drawer's remaining space instead, matching what the
enclosing flex column already implies.

`Drawer` is the app's one bottom dock. It is a host component rather than a kit node, because where
the icon rails are and how tall the top bar is are the shell's own geography, and because its height
is a pixel the resize grip produced, which is exactly what a kit node's props may not be. It reaches
plugins through `@acorn/plugin-api/ui/host` beside `PaletteSurface`. The terminal is its only caller.
Nothing behind a drawer goes inert, there is no backdrop, and Escape does not dismiss it: a drawer is
a second place to work rather than an interruption.

The toast stack sits above `--term-drawer-h`, the terminal drawer's published height (set on
`documentElement` by the terminal plugin, with a fallback for a window where that plugin is not
mounted), so a toast never renders behind the drawer. The stack itself ignores pointer events so it
never swallows a click on the app behind it, and each toast re-enables its own.

The command palette and the file finder share one surface, `PaletteSurface`, rather than the
near-duplicate `.palette-*` and `.finder-*` rule sets that used to exist side by side.

Modal dismissal (Escape, backdrop click, Tab focus containment) is `kit/lib/dismissable.ts`, a hook
returning handlers rather than a component; markup stays at the call site. Nine call sites
hand-wrote this before it existed, five of them with only a backdrop click and nothing else, so Tab
walked straight out of the dialog into the page behind it and Escape did nothing. `Modal` uses it
verbatim, which is what keeps it purely cosmetic and safely reviewable. The bottom `Drawer` above
does not, because it is not modal.

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
inside it and `data-tip` would otherwise be silently inert there. `kit/lib/frameTips.ts` mounts the same
delegated listener and bubble markup into a frame's document, the way frames already mount their
own copy of the shared CSS. It stays framework-free and importless on purpose: it is reached from
`@acorn/plugin-api/ui/sdk`, which bundles into a plugin's frame and must not drag a slice of the
shell, or a second copy of Solid, across that boundary.

## Drag-to-resize

`kit/lib/split.ts`'s `createSplitDrag` is the drag-resize hook behind the pane row divider, the terminal
drawer's height handle, and the splits the host layouts draw. Three hand-rolled splitters existed
before it, and none had a keyboard contract. A plugin never calls it: where a split is between two
*regions* the layout owns the handle ([docs/panes.md § Layout model](./panes.md#layout-model)), and
where it is inside one region the `ListDetail` and `SplitHandle` nodes call this for the pane.

It reports a pixel delta, not a value, because the three call sites model size differently: the
pane row resizes two adjacent panes against each other by a delta, the drawer owns one absolute
height, and the document surface owns a fraction. A delta is the one thing all three can turn into
their own units; a `value`/`onChange` hook would have fit only one of them. It owns pointer
capture, rAF coalescing, text-selection suppression during the drag, and `role="separator"` with
arrow/Home/End keys. Persistence stays with the caller, since only the caller knows what it is
persisting: a preference, a layout weight, a fraction. It is the same idiom as `dismissable.ts`:
behaviour as a hook, markup at the call site.

A drag clamps against the element it is resizing, never against `window.innerWidth`. That is the
never-do rule about reading the window, and it is what lets a mobile shell set its own breakpoints.

A drag that outlives its component would keep moving panes that no longer exist, so cleanup runs on
unmount. Clearing `document.body.style.userSelect` removes the property rather than restoring a
snapshot, because a snapshot taken while an earlier drag was still stuck would preserve `none`
forever; removal heals a document that already leaked one. Both `pointerup` and `pointercancel` are
handled, since an interrupted gesture fires `pointercancel` instead and losing pointer capture
mid-drag fires neither; missing either path once left the whole document unselectable for the rest
of the session.

## Interaction rules

Every one of these is a layer over the keymap rather than a handler somewhere: the engine, the intent
set, and the layer priorities are in
[command-palette-and-shortcuts.md § Focus and typing](./command-palette-and-shortcuts.md).

- Command palette opens with `⌘K` and uses contributed actions and rows.
- `⌘1`–`⌘9` activates the corresponding visible task, unless a `tabs` pane has focus, where the same
  chords pick that pane's tabs.
- `⌘⇧T` toggles the terminal drawer; `⌘⇧N` creates a task; `⌘P` opens the file finder; `⌘/` shows what
  the keyboard will do right here.
- F6 and Shift+F6 move between the regions of a pane; Ctrl+Option+Left and Ctrl+Option+Right move
  between panes.
- Pane chords are contribution-owned and user-overridable through Settings → Shortcuts.
- Typing fields, editors, terminals, and contenteditable elements stop global shortcuts unless the
  action is explicitly text-safe. That exemption is a property of the intent now, not of whoever
  remembered to declare it: `dismiss`, `commit`, and the four region and pane moves reach a focused
  composer and nothing else does.
- A node handles intents and never reads a key code. `Input`, `Textarea`, `Composer` and the inside of
  a rectangle are the only places a plugin sees a key event at all.
- Destructive actions and approvals use shell-owned confirmation chrome.

### Menus and right-click

There is one menu. `kit/components/overlays/Menu.tsx` owns the surface — `role="menu"`/`menuitem`, close-on-select, Escape,
outside-click, and focus returning to where it came from — and both ways of opening it mount that same
surface (`MenuSurface`) over the same hook (`kit/lib/anchor.ts`). The roving focus is not its own: a menu is
a collection, so the arrows, Home, End, the page keys and `j`/`k` arrive as intents from
`keys/collection.ts`, the same ones a list of rows gets. A
button anchors it to a rect; a right-click anchors it to a point, which is the only difference. A
right-click menu with its own markup would be a second place for the accessibility to be wrong.

**Right-click is never the only door.** The rows come from the context-menu registry
(`registries/panes/contextMenus.ts`), and the button menu on the same row renders the identical list, so
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

Both `Menu.tsx` and its anchoring hook (`kit/lib/anchor.ts`) replaced hand-rolled implementations that
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
(`createArmedConfirm`, `kit/lib/confirm.ts`) rather than close under it.

An `AnchorTarget` can be a point as well as an element; a point is a zero-size rect, so everything
downstream of the positioning math already works unchanged, which is what lets `ContextMenu` reuse
`MenuSurface` for a right-click instead of building a second menu. Visibility is the caller's state,
since a right-click menu belongs to whichever row was clicked; the surface remounts, keyed on the
`at` point, so right-clicking a second row does not leave the first row's items registered on it.

## States

A node's interaction states are the host's too, and held outside the node: `focused` and `pressed` for
every stop, `active`, `selected` and `offset` for every collection, and `hovered` on the DOM host only.
`keys/collectionState.ts` keys them by the item's own key, which is what makes a list keep its place
and its selection across a refetch. The data states below are a different question and are answered
per surface.

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

Keyboard traversal comes from the tree rather than from each pane. Each kit node's focus role is fixed
in `kit/tokens/focusRoles.ts` and a plugin sets none of it, and the ARIA follows from the role: a `Rows`
renders `listbox` or `tree` with `aria-activedescendant`, a tab strip renders `tablist`, a modal
renders `dialog` with `aria-modal` and hands focus back to its opener. Hover is never load-bearing:
anything a pointer can reach, focus can reach, so a `RowActions` that appears on hover appears on
focus too.

A long list says `virtual` on its `Rows` and changes nothing else. The scroller, the row placement and
the density number all become the kit's, and the collection stays keyed over the whole list rather than
the drawn window, so the arrows still walk past the last row on screen. Before it existed, GitHub's
pull list owned a virtualizer, a scroll element, two animation frames and a pair of hand-registered
`j` and `k` bindings to say the same thing.

## What the kit and layouts must never do

Twelve standing constraints. Each one keeps open a door that the terminal renderer
([docs/tui.md](./tui.md)) already walked through and a mobile PWA
([docs/future/remote.md](./future/remote.md)) walks through later, and each is cheap to hold now
and expensive to reopen. The arguments are in [What the kit refuses](#what-the-kit-refuses) above and
in [docs/security.md](./security.md).

1. No `class`, `className`, or `style` prop on any kit node, even "just for desktop".
2. No raw scale value in a plugin-facing enum. `space.row`, never `space.3` or a number.
3. No plugin-positioned layout. A plugin picks a layout; it never says where a region goes.
4. No key event reaches a plugin outside `Input`, `Textarea`, `Composer`, `MentionTextarea`, and the
   inside of a rectangle.
5. No second keymap. One engine, one command catalog, an adapter per host
   ([docs/command-palette-and-shortcuts.md](./command-palette-and-shortcuts.md)).
6. No kit node without a support row and an 80×24 sentence.
7. No layout without both projections written down.
8. No iframe inside an iframe; `frame-src 'none'` stays.
9. No `postMessage` between plugin origins that the host does not carry and validate.
10. No static widget schema. Logic stays in plugin code; the wire is a tree of kit nodes.
11. No hover-only affordance.
12. No node or layout that reads `window`, the pointer, or a key code.

### What a mobile PWA needs from this

The mobile client is a browser talking to a node, so it is the same DOM host at different widths with
a different shell. What the kit and the layouts owe it:

- **Every layout carries a narrow projection**, written before the layout lands
  ([docs/panes.md § Layout model](./panes.md#layout-model)).
- **Breakpoints are style tokens**, not numbers inside a layout, so the mobile shell can set them.
  Nothing in a layout reads the window width; a drag clamps against the layout's own element.
- **`formFactor` on surfaces stays** (`packages/protocol/src/plugin/contract.ts`). A rectangle that
  only makes sense wide says `['desktop']`, and the mobile shell hides it rather than mangling it.
- **No kit node carries a desktop-only assumption without a support row.** Hover is never
  load-bearing and every tooltip has a focus equivalent.

Host-owned layouts make a focused mobile subset cheap; they do not decide what is in it, which is
`remote.md`'s question.

### What a terminal renderer needs from this

A terminal host cannot run the web renderer, so it needs the tree, the kit, the layouts and the
keymap to be honest about intent. The host that reads these is `acorn`
([docs/tui.md](./tui.md)), which shipped on 2026-08-31 and draws the whole kit in cells.
Drawing all seventy-four nodes cost the kit one prop:
`Markdown` had an `onClick` beside its `onSelect`, handing over a DOM event that a remote tree cannot
receive and a terminal has no way to raise. Its two callers wanted the link's href and the browser on
a miss, so `onSelect` returns `false` for "I did not take it" and `onClick` is gone. Nothing else
moved. This is what the kit holds for it:

- **Every kit node has an 80×24 monochrome sentence** below and a `tui` level in
  `packages/client-core/src/kit/tokens/support.ts`, and both are read: the TUI host draws every node
  from its sentence, and a `reduced` one says what it loses beside its level.
  `tools/arch/kitTable.test.ts` fails if the appendix, the matrix and either host's component table
  disagree about which nodes exist.
- **Every layout has a terminal projection** in [docs/panes.md](./panes.md#layout-model).
- **Role tokens never expose pixels.** Each role has a documented terminal value, including
  `ignored`, in `packages/client-core/src/kit/tokens/roles.ts`, and `roleCell()` beside `roleVar()`
  hands the same answer to a cell renderer. A role names a colour slot, never a colour: which
  sixteenth or which hex is the appearance layer's (`apps/tui/src/appearance.ts`).
- **The keymap core is host-agnostic.** One engine, `@opentui/keymap`, and an adapter per host: the
  package's HTML one on the desktop, and the terminal client's own
  (`apps/tui/src/keys/keymapHost.ts`). acorn adds no key handling outside them. Nodes handle `next`,
  not `ArrowDown`.
- **Collection state is host-owned**, so a cell-buffer host keeps `active`, `selected` and `offset`
  the same way.
- **The tree protocol names nothing about the DOM.** The same mutations apply to a retained tree of
  any kind ([docs/plugins.md § The tree contract](plugins/descriptors.md#the-tree-contract)).
- **Rectangles are the only DOM-only thing**, and `kind="pty"` and `kind="editor"` are native there.
  A `pty` rectangle is filled through `attachPty`, which takes the channel rather than handing back a
  box: an xterm on the DOM, `@xterm/headless` in cells, one source in the plugin
  ([docs/terminal.md § Client](./terminal.md)). What crosses to a terminal plugin by plugin is in
  [docs/first-party-plugins.md](./first-party-plugins.md) § What each of these loses in a terminal.
- **A prop type is declared once and both hosts compile against it.** `ButtonProps`, `InputProps`,
  `SelectProps`, `PickerProps` and `MentionTextareaProps` are exported from the DOM kit and imported by
  the terminal one, because a node's props are one contract and a hand-written second copy loses a prop
  without anybody noticing. The pane sweep found four that had.
- **Nothing in the kit shrinks to make room.** Yoga answers a height deficit by taking it out of every
  child that will give, and a one-line row given half a line lands on the line above it. Every block
  node and every row refuses to shrink; the region around them clips, and a pane taller than the screen
  is the normal case at 24 rows.

## Every node at 80 by 24

The kit's admission rule asks for a written rendering on a host with no pixels, in monochrome, at 80
columns by 24 rows. This is that list, one row per node, and it is the reason `NODE_SUPPORT`'s `tui`
column can be filled in honestly rather than guessed.

A node's props are its exported type in `@acorn/plugin-api/ui` and are not restated here, because a
second copy would be wrong within a release and nothing would catch it. The focus column is
`kit/tokens/focusRoles.ts`, and `tools/arch/kitTable.test.ts` fails if this table and those two files
disagree about which nodes exist or what each one does with focus.

Every row here has a case in `apps/tui/src/kit/kit.test.tsx` that draws the node and reads the cells
back, and every node the focus column calls a stop, a collection or a conditional stop also has a
case that presses it or a written reason why the press is driven in a suite of its own. The reason
sentences are in `NOT_DRIVEN_HERE` in that file, and the list cannot grow quietly: a node cannot join
the kit as a stop without somebody deciding whether this host presses it.

### Grouping

The DOM `Fold` mounts its body on first open and retains it thereafter. Native `<details>` alone
only hides an already-rendered body; deferring that first mount avoids building hidden transcripts
and code blocks while preserving child state on subsequent toggles.

| Node | Focus | At 80×24 |
| --- | --- | --- |
| `Stack` | none | children on successive lines, `gap` as 0 or 1 blank lines. `grow` means the stack is the region rather than a run of content in one: it takes what is left of the box, so a scroller or a canvas inside it has a height to work against |
| `Inline` | none | children on one line separated by a space; wraps to a `Stack` when too wide |
| `Section` | conditional | label in grey uppercase, children below |
| `Fold` | stop | `▸ label` or `▾ label`, children indented two cells |
| `Card` | conditional | a box-drawing frame, or a blank line above and below in compact density |
| `Timeline` | collection | cards in sequence, a grey rule between turns. `follow` makes it the scroller and holds it on the last turn until the reader scrolls away, which is what leaves a pane's header and composer pinned around it; without `follow` it is a plain column and whatever is around it scrolls. `place` and `onChange` are dropped, and `Timeline.Turn` ignores its `key`: the reader is not put back on the turn they left, because a viewport here knows its own offset and nothing about where each turn sits, so a redrawn list opens at the newest turn. `Timeline.Turn` is a node of its own on both hosts |
| `Tabs` | collection | `Tab  [Tab]  Tab` on one line, the selected one in brackets. A tab's `icon` becomes the glyph in front of its label, and drops out where the name has no glyph; its `title` has nowhere to hover |
| `Toolbar` | none | children on one line where they fit and wrapped onto the next where they do not, because a bar written for a window is drawn here in a pane column and a row that shrinks its children cuts their labels to nothing |
| `Modal` | trap | a centred box with its title; Escape dismisses, which `keys/keys.test.tsx` drives. `Modal.Body` and `Modal.Actions` answer to their flat spellings too, on both hosts |
| `ModalBody` | none | the lines between the title rule and the actions line |
| `ModalActions` | none | the buttons on one line, right-aligned inside the box |
| `Menu` | trap | a vertical list in a box |
| `Popover` | none | reduced: the panel opens as a block under its anchor, not floating. Open, the anchor and its panel take a line of their own, because a row shares its width between its children and a panel laid out in a trigger's few cells reads as nothing |
| `ListDetail` | none | reduced: two columns above 80 cells. Below it, the `list` form draws the detail alone and the `split` form stacks its two column children, because this node has no keys of its own to switch with and a column of 38 cells is a column nobody can read |
| `ListColumn` | none | reduced: the left column, or the whole width when the split has collapsed |
| `DetailColumn` | none | the right column, or the whole width |
| `Sections` | collection | reduced: a strip of tabs over one panel — the header first, then each section, then `main` below 120 cells, where a diff in half the width is a diff wrapped at 45 columns. `h` and `l` walk the strip. A section's `meta` is not drawn: a strip has room for a label and a count |
| `SplitHandle` | stop | absent: a terminal split moves by a key, not a grip |
| `DocumentTabs` | collection | one line of tab labels with a `×` on the current one |
| `SectionHeader` | none | a bold line with its actions right-aligned |
| `TabPanel` | none | the rows under the tab strip |
| `ToolbarSpacer` | none | the padding that pushes what follows to the right edge |

### Showing

| Node | Focus | At 80×24 |
| --- | --- | --- |
| `Text` | none | plain text; `mono` is a no-op, `muted` is the palette grey, `strong` is bold |
| `Link` | stop | the text, underlined, pressable |
| `Heading` | none | eyebrow in grey uppercase, heading in bold |
| `Rows` | collection | its items on successive lines; `virtual` is the window of rows that fit, and it follows the active row because there is no pointer to scroll with |
| `Row` | item | one line: status glyph, title, meta right-aligned. `variant="stacked"` puts the second child on a second line, as it does on the DOM. `reveal` has no meaning, because there is no hover, so the trailing controls always show |
| `TreeRow` | item | `Row` indented `depth` cells with `▸` or `▾` |
| `RowActions` | none | the row's actions as glyphs at the right end, always drawn, never on hover |
| `Badge` | none | `[text]` in the tone's colour |
| `Chip` | conditional | `(text)`, with a trailing `×` when removable |
| `ChipRow` | collection | chips on one line, wrapping |
| `StatusDot` | none | `●` in colour, `○` for muted |
| `Facts` | none | two columns, labels grey; `grouping="rows"` is one pair per line; `wide` on an item is a desktop-only full-row tile |
| `DescriptionList` | none | as `Facts`, one pair per line |
| `Table` | none | reduced: box-drawn, truncating columns by the priority its heads declare |
| `TableHead` | none | reduced: the column's label in the bold header line; the lowest priority is dropped first, and a line under the table names the columns that went |
| `TableRow` | conditional | reduced: one line, cells separated by `│`, truncated by column priority; a tab stop only when it has an action |
| `TableCell` | none | reduced: the cell's text in its column's width, ellipsised where it does not fit; `header` makes it bold |
| `Grid` | collection | reduced: as `Table`, with a row-range indicator instead of a scrollbar |
| `Graph` | collection | reduced: the indented list, one line per card — glyph, label, `⇐ n` where the card waits on more than one, detail at the far end — indented by rank and capped at four levels. No positions and no wires: a picture is what this host cannot draw, and the ranks are what the picture was saying. Where an edge can be authored, a picker under the list draws one out of the selected card |
| `Meter` | none | `████░░░░ 62%` |
| `CodeBlock` | none | monospace lines, a grey rule above and below |
| `Log` | stop | monospace lines, find as a bottom line |
| `Markdown` | none | reduced: headings bold, lists as `•`, code in a `CodeBlock`, no images, no wide tables, and a link as its text with the URL beside it in grey |
| `DiffPane` | none | reduced: unified only, `+`/`-` in colour, annotations as indented lines under their row; windowed, so a long patch draws the rows around the viewport and not all of them |
| `DiffLine` | none | reduced: one line, `+`/`-`/space in the gutter, no intra-line highlight |
| `FileHead` | none | reduced: the path in bold with `+n −m` right-aligned |
| `NonCodeRow` | none | reduced: a grey line saying what is not being shown, such as `binary file` |
| `SplitCell` | none | absent: side-by-side needs 160 cells, so a terminal diff is unified |
| `EmptyState` | none | centred grey text |
| `Alert` | none | one line prefixed with the tone's glyph |
| `Spinner` | none | reduced: a braille spinner, or `…` where motion is off |
| `Kbd` | none | `⌘K` or `ctrl+k`, per host |
| `UserAvatar` | none | reduced: initials in brackets; no image |
| `Icon` | none | reduced: a glyph from a small name table, an emoji as itself, or nothing for a name the table has no glyph for |

### Asking

| Node | Focus | At 80×24 |
| --- | --- | --- |
| `Button` | stop | `[ label ]`, or `[l]abel` with a mnemonic. An icon-only button draws its `label`, because a glyph child has no text to read off it |
| `ConfirmButton` | stop | `[ Delete? ]` after the first press; the armed button is the prompt |
| `Input` | stop | a field taking the room its row has left; owns keys while focused |
| `Textarea` | stop | a boxed multi-line field; owns keys. `rows` is a floor rather than a fixed height, so an empty field still stands its ground and a full one grows past it; the frame lights in the accent tone while the keys are inside. A caller drawing its own frame, such as `Composer`, turns this one off |
| `Select` | stop | `[ value ▾ ]`, opening a `Menu` |
| `Checkbox` | stop | `[x] label`; Space toggles |
| `SegmentedControl` | collection | `( a \| [b] \| c )`, the selected one in brackets |
| `ToggleButton` | stop | `[x] label` |
| `Picker` | stop | a field that opens a `Menu` filtered by typing |
| `PickerRow` | item | one line in that menu: glyph, label, grey hint |
| `Composer` | stop | a boxed field with a `> ` prompt; commit submits |
| `MentionTextarea` | stop | reduced: a `Textarea` with the mention menu below it; no inline highlight of the token |
| `KeyValueEditor` | none | a two-column table with editable cells, each cell a stop |
| `FindBar` | stop | `/ query  3/12` on one line |
| `Field` | none | the label above its child |
| `CopyButton` | stop | fallback: the button copies over OSC 52 where the terminal takes it, and prints the value on its own line to copy by hand where it does not |
| `ModelBackendPicker` | stop | two `Select`s over the backends a Generate control can spend: a stored key, or an installed agent CLI |

### Pixels, and the host wrappers

| Node | Focus | At 80×24 |
| --- | --- | --- |
| `Rectangle` | stop | absent, with two exceptions the node handles itself: `kind="pty"` and `kind="editor"` are native, and `webview` and `frame` draw their `<Fallback>` child or nothing |
| `Only` | none | children exist on the named hosts and nowhere else; no fallback wanted |
| `Fallback` | none | what to draw where the matrix says this host cannot draw the node it is inside |
