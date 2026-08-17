# The grid gesture and panel chrome restyle

**SHIPPED** — phase 1 of the accepted redesign (`README.md § build order`). What the grid does now is
[`docs/dashboards.md § Layout`](../../dashboards.md); this file is kept for the reasoning behind it,
in particular the positioning decision in § 4 and the observer landmine under it.

Three deviations from the spec below, all deliberate:

- **§ 2 and § 5 use width tokens, not the literal pixel values.** `1.5px` became `--bw-strong` and the
  grip's strokes are drawn from `currentColor` at a token width. A px literal in a border is what
  `styles/cssHygiene.test.ts` ratchets against, and the spec's own rule was "no new tokens", not "new
  literals".
- **§ 3's border step-up to `--border-strong` was dropped.** `--surface-border` — what `.ui-card`
  already uses — resolves to `--border-strong` in every pack, so the declaration would have been dead
  CSS. The lift is carried by `--shadow-3` and the scale.
- **§ 5's grip is a `::before` on the header, not an element.** A pseudo-element is decoration the
  accessibility tree never sees, so it needs no `aria-hidden`, and `Panel.tsx` — which deliberately
  does not know whether its surface offers dragging — took no diff at all.

Durations landed on `--dur-short` (150ms) for the slot and `--dur-med` (220ms) for the neighbours
rather than the spec's 120/180, keeping the "slot leads, chain follows" relationship on tokens a pack
can retune.

---

Pure presentation: this file changes **no persisted shape, no wire contract, no layout arithmetic**.
`layout.ts` — push-down, wall-clamp, compaction, `firstFit`, `normalize` — is the spec this design
obeys, not a thing it touches. If an implementation of this file wants to edit `layout.ts`, the
implementation is wrong.

Files touched: `PanelGrid.tsx`, `Panel.tsx`, `dashboards.css`. Nothing else.

## What changes, precisely

### 1. The overlay: a dot lattice, not ruled lines

Today: two repeating linear-gradients drawing full grid lines at 0.5 opacity. Replace with a dot
field marking **cell intersections only**:

- One `radial-gradient(circle, <dot> 1.6px, transparent 1.8px)` background on `.dash-grid-overlay`,
  `background-size` = `--dash-pitch` × the row pitch, offset by `-gap/2` on both axes so dots sit in
  the gap centres between cells, where panel corners land.
- Dot colour is the existing `--border` token. No new token: the lattice is chrome, and chrome wears
  the border colour under every theme and style pack.
- Appearance behaviour is **unchanged**: the overlay fades in when a gesture arms and out when it
  ends (`--dur-short`), and `prefers-reduced-motion` kills the fade, not the lattice.

Why dots: ruled lines read as a spreadsheet behind the page and get loud under dense style packs; a
lattice reads as a surface things are placed on, and it is one declaration.

### 2. The placeholder: a soft slot, not a dashed wireframe

Today: `.dash-placeholder` is a dashed `--border-strong` rect over `--bg-subtle`. Replace with the
shape of the panel itself:

- Fill: the accent at low alpha — `color-mix(in srgb, var(--accent) 10%, transparent)`.
- Border: 1.5px **solid**, `color-mix(in srgb, var(--accent) 55%, transparent)`.
- Radius: `--radius-surface`, i.e. the same radius a real panel has. The slot must look like where
  the panel will *be*, not like a diagram of it.
- Position transitions on ~120ms ease-out so the slot glides between candidate cells instead of
  teleporting. Reduced motion: no transition.

`color-mix` over `--accent` rather than a new wash token, so the terminal pack's accent and a
plugin-contributed theme's accent both just work. If a pack's accent mixes illegibly, that is the
pack's bug to fix in its accent, not a reason for a dashboard token.

### 3. The dragged panel: a lift, not a flat translate

Today the dragged slot gets `z-float` + `shadow-3` + a sub-cell translate. Keep all of it and add:

- `transform: scale(1.015)` composed with the existing translate — a hair of lift, enough that
  source (the slot) and payload (the panel) never look alike.
- Border steps up to `--border-strong` while dragging.
- Cursor: header is `grab` at rest, `grabbing` while armed (already true; keep).

### 4. Neighbours glide

Today non-dragged panels jump to their new cells between frames. Give the non-dragging slots a
transition on their placement (~180ms, `cubic-bezier(.2,.7,.3,1)`) so push-down and compaction read
as a chain reaction rather than a reshuffle. The dragged slot itself gets **no** transition — it
tracks the pointer raw.

**The implementation decision this forces, recorded:** panels are positioned today by CSS grid
`grid-area`, which cannot be transitioned. Two options were considered:

- **(a) FLIP transforms over CSS grid** — measure before/after, animate the delta. Rejected: fragile
  under the mid-gesture re-layouts this grid does every frame, and it fights the sub-cell translate
  the dragged panel already carries.
- **(b) Absolute positioning from the measured cell** — the `ResizeObserver` already computes the
  one pixel measurement (`--dash-cell`/`--dash-pitch`); position slots with `top/left/width/height`
  computed from the same rects `layout.ts` already emits, and transition those. **Chosen.** The
  collapsed (single-column) mode keeps ordinary block flow exactly as today; absolute positioning
  applies only when the 12-column grid is active, which is also the only time gestures are armed.

**A landmine found while prototyping, on the record:** with absolute positioning the grid container's
height is set from the layout result, so a mid-gesture preview *changes the container's size*, which
fires the grid's own `ResizeObserver`, which must **not** re-apply the committed layout mid-gesture —
that stomps the preview with the stale model on every frame. Guard the observer while a gesture is
live (re-measure, but skip the re-apply). The prototype shipped this bug and the fix; do not
rediscover it.

### 5. The header: a grip that appears when wanted

- A six-dot grip glyph (2×3, `currentColor`) at the header's left edge, `opacity: 0` at rest,
  fading in on panel hover/focus-within. It is `aria-hidden` decoration — the whole header remains
  the drag surface and the keyboard path remains the overflow menu's "Move / resize".
- Header actions (refresh, overflow) fade in on hover/focus-within the same way. The freshness word
  (`Refreshing / Stale / Offline / Disabled / Error`) stays **always visible** when not live —
  state is not decoration and does not hide.
- Resize handles keep today's hover-reveal behaviour; the south-east corner gains a small chevron
  affordance (two 2px strokes) so the corner reads as grabbable before it is hovered.

### 6. Keyboard layout mode: the announcement becomes visible

Today keyboard move/resize announces through a visually-hidden `aria-live` region. Keep that region
exactly as is, and additionally render the same string ("Row 2, column 5 · 3 wide, 2 tall") as a
small floating caption near the panel while layout mode is active. Sighted keyboard users currently
get less feedback than screen-reader users; this closes that gap with zero new state — it is the
same computed string drawn twice.

## What deliberately does not change

- The gesture model: header-only drag, 4px arm threshold, Escape restores, release persists exactly
  the preview, the body stays gesture-free (reserved for `write-back.md`).
- The narrow-window collapse and its thresholds.
- All keyboard semantics and the live region.
- Every existing token contract: this file introduces **zero new appearance tokens**. Everything
  above is expressible in `--border`, `--accent`, `--radius-surface`, `--shadow-3`, `--dur-short`,
  `--ease-out`, `color-mix`, and the two existing measurements.

## Done when

- A drag shows the dot lattice, the soft slot gliding between candidates, the lifted panel, and
  neighbours animating through push-down and compaction — and releasing persists exactly what was
  previewed, byte-identical to today's commit path.
- Escape and `pointercancel` still cost nothing; `prefers-reduced-motion` yields today's instant
  behaviour with the new visuals.
- Keyboard layout mode shows the visible caption and the live region still announces.
- The collapsed mode is pixel-identical to today.
- `layout.ts` has no diff. `dashboards.css` still defines no tokens beyond the two measurements.

## Verify before building

- `PanelGrid.tsx` — whether slots are still `grid-area`-positioned and where the `ResizeObserver`
  writes `--dash-cell`/`--dash-pitch`; the observer-guard landmine above assumes that shape.
- `styles/cssHygiene.test.ts` — the two measurements' exemption list, if positioning moves inline.
- The repo rule that desktop e2e is frozen (`apps/desktop/e2e` is being extracted): verification is
  unit tests over `layout.ts` (unchanged) plus **manual checks** of the gesture in the running app.
- Every style pack (`terminal`, `modern`, `cozy`, `cute`) and a dark theme: the lattice, slot and
  lift must read under all of them, since they are drawn from pack-owned tokens.
