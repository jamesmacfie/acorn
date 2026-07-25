# UI design

acorn's appearance is **two orthogonal axes**, both single attributes on `<html>`:

| Axis | Attribute | Owns | Options |
| --- | --- | --- | --- |
| **Theme** | `data-theme` | colour, and only colour | 12 (Light, Dark, Solarized ×2, Monokai, Nord, Catppuccin ×4, One Dark, Dracula) |
| **Style** | `data-style` | shape, typography, spacing, density, chrome, motion | 4 (Terminal, Modern, Cozy, Cute) |

Every style composes with every theme — 48 combinations, none of them special-cased. Both are
picked in Settings → Appearance.

The SPA imports `apps/desktop/src/core/client/styles.css` at boot, a manifest of the shell-owned
stylesheets under `apps/desktop/src/core/client/styles/`:

| File | Owns |
| --- | --- |
| `fonts.css` + `fonts/` | `@font-face` for the bundled packs (see `fonts/README.md`) |
| `tokens-invariant.css` | z-index ladder, third-party brand marks, `--tabular` — neither axis may set these |
| `tokens-style.css` | **every** style token, at the Terminal values. This file *is* the Terminal pack. |
| `tokens-theme.css` | the palette, the `--dark-*` values, and the 11 named theme blocks |
| `base.css` | reset, `body`, focus ring, `.glyph`, the null-default declarations, global utilities |
| `shell.css` | `.shell` / `.app` / `.panes` / `.pane` / `.section-header` |
| `primitives.css` | base styling for `core/client/ui/primitives.tsx` |
| `style-{modern,cozy,cute}.css` | one pack each: a token block plus a handful of structural overrides |
| `pull-list`, `pull-detail`, `diff`, `topbar`, `overlays`, `checks-panel`, `integrations-panel`, `copy`, `tabs` | feature chrome |

Feature modules co-locate their stylesheet next to the component and import it directly (for example
`plugins/terminal/client/terminal.css`), so the manifest covers only the shell. Vite still emits one
client CSS asset.

## The orthogonality contract

**The theme token set and the style token set are disjoint, and every declaration lives in exactly
one axis file.** Everything else follows from that one sentence:

- **Source order stops mattering.** `:root[data-theme=…]` and `:root[data-style=…]` are both
  `(0,2,0)`. If they ever set the same property, file order would silently decide the winner — the
  fragility the old single token file carried. Disjoint sets remove it.
- **Compound selectors are banned.** No `:root[data-theme="nord"][data-style="cute"]`. That is
  `(0,3,0)`, beats both axis files, and is the door back to a 48-cell matrix.
- **The classification rule is mechanical:** *if a token's value is a colour, it is theme; if its
  value is a `var()` pointing at a colour, or a scalar modulating one, it is style.* So
  `--card-bg: var(--bg-subtle)` is a style decision — "in this aesthetic a card sits on the
  secondary surface" — while the theme still owns what the secondary surface *is*.
  `--card-bg: #fafafa` in a pack would not be legal.
- **Completeness.** Every style token has a value on plain `:root` in `tokens-style.css`; packs only
  override. A pack therefore cannot leave a `var()` undefined.

`apps/desktop/src/core/client/ui/tokenAxes.ts` declares which token belongs to which axis, and
`styles/tokenAxes.test.ts` asserts all of the above against the stylesheets — including that no pack
contains a colour literal and that the two sets never intersect. This is what makes the 4 × 12 grid a
non-issue rather than a screenshot matrix.

### Protected names

`--bg`, `--bg-subtle`, `--bg-hover`, `--bg-selected`, `--text`, `--text-muted`, `--text-faint`,
`--font-mono`, `--is-dark` and `--term-fs` are read **from JavaScript** via `getComputedStyle`,
because xterm and Monaco render to a canvas and cannot use CSS
(`plugins/terminal/client/theme.ts`, `plugins/editor/client/EditorPane.tsx`,
`plugins/docker/client/DockerExecTerminal.tsx`). Renaming one breaks the terminal and the editor
with no type error, so they are listed as `BRIDGE_TOKENS` and asserted by the test.

Each theme declares `--is-dark` about itself. That replaced a `parseInt()` on `--bg`, which required
the palette to be literal 6-digit hex and silently classified every theme as light for any other
colour syntax. Likewise `--syntax-fg` (which side of Shiki's dual `--l`/`--r` output to read)
replaced two hardcoded lists of dark theme *names*, duplicated in `diff.css` and `checks-panel.css`,
that had to be edited whenever a dark theme was added.

## Style packs

| Pack | Register |
| --- | --- |
| **Terminal** (default) | Flat, square, monospaced, dense. 1px dividers, uppercase tracked labels, a 3px accent bar on the selected row. |
| **Modern** | Inter, 6–10px radii, inset pane cards with soft elevation, no row dividers, 40px rows, sentence-case labels. |
| **Cozy** | Literata, 1.7 line-height, 46px rows, the roomiest spacing scale, pill chips, quiet structure. |
| **Cute** | Nunito, 12–22px radii, pill rows, no dividers at all, springy hover/press. |

Terminal is the attribute-less `:root` default — exactly as `light` is for themes — which is why a
fresh install paints correctly before any JS runs and no FOUC script is needed.

### Adding a pack

1. `styles/style-<id>.css` with a `:root[data-style="<id>"]` token block.
2. Register `{ id, label, description }` in `settings/uiStyles.ts`.
3. `@import` it in `styles.css`, after `primitives.css`.

`settings/uiStyles.test.ts` fails if the picker and the stylesheets disagree.

**Escape-hatch budget: ≤25 override selectors per pack**, asserted by the test. Exceeding it means
the token vocabulary is wrong, and the fix is a new token — never a 26th override. All three packs
currently use 2–3.

**When a pack needs a property nothing declares**, add a *null default* to `base.css` rather than an
override to the pack. Nothing in the app set `transform` on hover, so Cute could not have added one
from a token; `base.css` declares `transform: var(--hover-lift)` with `--hover-lift: none`, costing
nothing until a pack fills it in.

## Token reference

### Theme — colour

The 21 palette primitives, restated per theme: `--bg`, `--bg-subtle`, `--bg-hover`, `--bg-selected`,
`--border`, `--border-strong`, `--text`, `--text-muted`, `--text-faint`, `--accent`, `--focus`,
`--add-bg`/`--add-marker`, `--del-bg`/`--del-marker`, `--add-word-bg`/`--del-word-bg`,
`--hunk-bg`/`--hunk-text`, `--warn`, `--badge-border`, `--shadow-popover`.

Plus three self-description tokens (`--is-dark`, `--color-scheme`, `--syntax-fg`) and a set of
**derived** colours declared once on `:root` as `var()` references, so they follow every theme
automatically: `--danger`, `--danger-fg`, `--success`, `--success-fg`, `--accent-fg`,
`--surface-sunken`, `--state-ok`/`--state-warn`/`--state-bad`, `--find-hit-bg`/`--find-current-bg`,
`--scrim-color`. Adding a derived colour is a one-line change, not a 12-block edit.

### Style — shape, type, space, density, chrome, motion

**Shape.** A `--radius-*` scale plus semantic aliases (`--radius-control`, `--radius-surface`,
`--radius-popover`, `--radius-chip`, `--radius-pill-fixed`, `--radius-marker`). Note the split
between `--radius-chip` (aesthetic — a chip may be square or a pill) and `--radius-pill-fixed`
(semantic — a capsule in every pack).

Border widths are **role-scoped**, not one token: `--divider-w` (list rows), `--chrome-divider-w`
(topbar, section headers), `--pane-divider-w`, `--pane-bw`, `--control-bw`, `--surface-bw`,
`--marker-w`, `--stripe-w`, `--tab-active-w`. A single width token sounds tidy until a pack zeroes it
to drop row dividers and also deletes the topbar rule, which every pack still wants. Four composite
recipes cover ~380 declarations: `--divider`, `--chrome-divider`, `--control-border`,
`--surface-border`.

**Picking the right recipe is load-bearing, because two of these widths are zero in some packs.**
Modern and Cute set `--divider-w: 0` and `--marker-w: 0`, so reaching for the wrong role does not
render "slightly differently" there — it renders *nothing*, with no test failure and no type error.
`--divider` is for row and list separators **only**; a pane split, toolbar, sticky head, banner or
footer bar is `--chrome-divider`, a button/input/select is `--control-border`, and a card, popover or
code block is `--surface-border`. `cssHygiene.test.ts` catches the mechanical half of this: a
four-sided `border: var(--divider)` can never be a row separator. Likewise `--marker-w` means "this
row is selected" (a pack may express that as a fill instead), while `--stripe-w` is the accent stripe
whose **colour carries information** — a workspace's identity colour, warn-vs-sent on a review note —
and no pack may zero it.

**Space.** A `--space-0…11` scale plus semantic spacings (`--pane-pad`, `--gap-*`, `--pad-*`).
Restated per pack, deliberately **not** derived from a density multiplier: `calc()` against a scalar
yields fractional pixels, which blur 1px borders and make every computed value unreadable in
devtools.

**Density.** `--row-h`, `--row-h-sm`, `--row-h-virt`, `--control-h`, `--topbar-h`, `--pane-head-h`,
`--tabrail-w`, `--icon-size`, `--avatar-*`, plus `--shell-pad`/`--pane-gap`/`--pane-radius`, which
are what turn the flat three-pane grid into inset cards with no markup change.

`--row-h-virt` is separate from `--row-h` because virtualized lists read it **from JS**
(`core/client/ui/metrics.ts`). `@tanstack/solid-virtual` needs a number and writes the result back as
an inline height, which beats any stylesheet rule — so a hardcoded estimate silently pinned the PR
list's density regardless of the pack.

**Typography.** Four font roles: `--font-mono` (**protected**), `--font-ui`, `--font-glyph`,
`--font-display`; a `--fs-2xs…xl` ramp; `--lh`/`--lh-tight`/`--lh-diff`; weights; and the label
tokens `--label-transform`/`--label-tracking`/`--label-weight`/`--label-size`, which are how a pack
switches the whole app from uppercase-tracked to sentence case in one line.

**Chrome.** `--shadow-0…5` plus two directional drawer recipes, aliased by role as `--elev-*`;
`--ring`; `--focus-ring-*`; `--scrim-alpha`/`--scrim-filter`; and the surface indirections
`--card-bg`, `--pane-bg`, `--popover-bg`, `--input-bg`, `--chip-bg`.

**Motion.** `--dur-*`, `--ease-out`/`--ease-in-out`/`--ease-spring`, `--transition-color`, and the
null-default `--hover-lift`/`--press-scale`.

## What never varies

- **Code surfaces are monospace and tabular in every pack** — diffs, the terminal, Monaco, the SQL
  result grid, CI logs. Their alignment is load-bearing, and xterm measures cell width from the font.
- **Diff body geometry is style-exempt.** `--lh-diff`, `--diff-line-h` and the gutter are fixed
  across packs. Diff density is a code-reading concern, not an aesthetic one; letting Cozy add 40%
  line-height to a 2,000-line diff would make the app worse.
- **Unicode contribution glyphs** (`◇` GitHub, `◷` Linear, `◍` Rollbar, `◧` Docker, `▦` Database,
  `⎇` Changes) stay on `--font-glyph`, a mono stack, because those box-drawing characters only align
  there. There is no icon library; see "Icons" below.
- **Never colour alone.** Diff add/delete state is always carried by a marker glyph and a background.

## Primitives

`core/client/ui/primitives.tsx` (+ `Modal.tsx`, `dismissable.ts`) is the shared layer. Each primitive
emits **one stable semantic class plus `data-*` variant attributes**, and appends `props.class`:

```
.ui-btn                                   (0,1,0)  base — the Terminal look
.ui-btn[data-variant="ghost"]             (0,2,0)  variant
:root[data-style="modern"] .ui-btn[…]     (0,3,0)  pack override, wins without !important
```

Packs therefore win on **specificity**, not source order. `data-*` was chosen over a class-recipe map
because it is already idiomatic here (`[data-severity]`, `[data-state]`, `data-tip*`, `[data-theme]`),
needs no class-merge utility or build step, and keeps a pack in CSS rather than in TypeScript.

`Button`, `Input`/`Select`/`Textarea`/`Field`, `Badge`, `Spinner`, `SectionHeader`, `Row`, `Modal`.
Primitives are named by **role, never by appearance** — there is deliberately no `Card`, because
"card" is a look and in the Terminal pack nothing is one, so every call site would read
`<Card variant="flat">`. A bounded region is `SectionHeader` plus a container, and the *pack* decides
whether it gets a radius and a shadow.

Not built, and why: `Tooltip`/`Toast` (the singleton attribute-delegated renderers in
`tooltip/RailTips.tsx` and `notifications/` are better than N portals), `Table` (n=1),
`Panel` (one call site, fully token-expressible), `Menu` (`Picker` is the only element-anchored
popover; `AccountMenu`/`NotificationBell` use plain CSS and `MentionTextarea` anchors to the caret).

`ui/adoption.test.ts` is the migration ledger: retired classes may not reappear, and converted files
may not regress to raw controls.

### Frozen surfaces

The virtualized and tabular surfaces — `DiffView`, `diff/DiffRows`, `PullDetail`, `ResultGrid`, and
the `.dbgrid-*` / `.diff-row` rules — keep their bespoke markup permanently. Their job is measured
geometry, where a changed box model corrupts scroll math with no type or test signal. They get
tokens, so radii, spacing and chrome type still vary per pack, but their structure is not migrated.

## Icons

There is no icon library and no icon dependency. Icons are Unicode glyphs carried as
`glyph: string` on contribution types, plus five hand-written inline SVGs.

When real icons are wanted, the mechanism is **keep the type and change what the string means** —
`glyph: '◇'` → `glyph: 'github'`, with a `<Glyph name>` resolver mapping names per pack and unmapped
names rendering as-is. Do **not** widen `glyph` to `string | Component`: that type lives in
`core/shared/integrations.ts` *and* `core/server/integrations/types.ts`, so it would put a `solid-js`
type into server code, and `core/boundaries.test.ts` enforces the client↔node split as a hard
invariant.

## Three-pane layout

`.shell` is a full-height flex row: the `TabRail` (`--tabrail-w`) on the far left, then `.app`, a
grid of `var(--topbar-h) 1fr`. `.panes` is a three-column grid:

```
grid-template-columns:
  var(--left, clamp(320px, 28vw, 420px))   /* left   — Reviews    */
  clamp(360px, 23vw, 430px)                /* mid    — Navigator  */
  minmax(0, 1fr);                          /* right  — Diff       */
```

Each `.pane` scrolls independently and sets `contain: layout paint` so a reflow in one cannot ripple
into the others. `--shell-pad` and `--pane-gap` (both `0` in Terminal) are what let a pack inset the
panes into cards.

⚠️ A zero-width grid column still emits its `gap`, so any pack setting `--pane-gap` must also
restate `.app.left-collapsed .panes` or an empty sliver appears where the left pane was. All three
non-Terminal packs do.

## Verifying a change

- `pnpm lint` and `pnpm test`. The appearance contract is covered by `styles/tokenAxes.test.ts`
  (orthogonality, completeness, no colour literals in packs, bridge tokens, z-order invariants),
  `styles/cssHygiene.test.ts` (no phantom tokens; ratcheting literal counts), the two drift guards,
  and `ui/adoption.test.ts`.
- **Settings → Style gallery** (dev builds only) renders every primitive × variant × tone plus the
  code surfaces, with style and theme pickers that write the DOM attributes without saving. It is the
  fastest way to author a pack.
- Because the axes are provably disjoint, style × theme is **not** a test matrix. Spot-check a pack
  against light and dark; the contract covers the rest.
