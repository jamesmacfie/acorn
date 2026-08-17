# Chart growth: series identity, legend, grouped bar, source split, sparkline

**SHIPPED — all five.** The series-colour decision landed as phase 0, the sparkline with
measure-history, and the legend, the grouped bar and the source split as phase 3.
[`docs/dashboards.md`](../../dashboards.md) owns the behaviour now; this file keeps the reasoning and
the deviations. This file absorbed the grouped-bar item that used to live in the README.

The standing rule stays: marks carry **tones, never literal colours** — a plugin's declared enum
tone where one exists, else a host-owned ramp — so charts restyle with the appearance pack and no
plugin ever names a colour. Everything below is about what the *host's own* ramp is allowed to be.

## 1. The series-identity colour decision (phase 0) — DECIDED AND SHIPPED

The old behaviour resolved every mark colour through the five status tones (`chart.ts § RAMP` cycled
`accent/ok/warn/bad/muted` for undeclared values). That is correct for **status** — a `Ready` bar
*should* be the ok colour — and wrong for **identity**: a line split by source (github vs linear) or
a bar grouped by a second enum is asking "which series is this", and answering with status colours
makes github permanently "ok-green" and linear permanently "warn-amber", which reads as a judgement
nobody made. Status colour on non-status identity is a lie of the same species as a guessed avatar.

**Option (b) was taken.** `--viz-series-1..3` are theme-axis tokens (`SERIES_TOKENS` in
`ui/tokenAxes.ts`, defaults in `styles/tokens-theme.css`), and `chart.ts` now emits `series` on a
mark whose colour is identity and `tone` on one whose meaning was declared — never both. `RAMP` is
gone. The rule and its ceiling are in
[`docs/dashboards.md § Views are derived`](../../dashboards.md); the rest of this file still stands
unbuilt on top of it.

Three slots, hard cap: series 4+ folds into an "other" series in the muted tone, counted in the
legend ("+2 more"). Three is what survives colour-vision checking as a set alongside the status
palette; past three the answer is fewer series or a table, not a fourth colour. Enum splits whose
values carry **declared tones keep them** (the plugin said what the value means); the ramp is only
for identity with no declared tone — sources, and undeclared enum values, which stopped borrowing
status tones the day this landed.

`ChartView.tsx` keeps its rule that no literal colour appears in the component: marks carry
`data-series="1|2|3|other"` beside the existing `data-tone`, and CSS maps them.

**Three deviations from the sketch above**, all recorded at the code:

- **A third token group, not a palette addition.** The tokens are neither primitives nor derived:
  `THEME_PALETTE_TOKENS` is the *strict* manifest contract for a plugin-contributed theme, so putting
  them there would reject every theme already in the wild for omitting three names it has never heard
  of. They carry `:root` defaults instead, `SERIES_TOKENS` is excluded from the axis test's primitives
  assertion, and a pack that wants its own restates them.
- **One set of values, not a light/dark pair.** Half the named theme blocks are dark; a `--dark-*`
  flip would have reached the two default paths and left Monokai and Nord on the light values anyway.
  All three sit at L≈0.6 in oklch, clearing 3:1 against both `#ffffff` and `#121212`. The accepted
  cost is the greyscale separation a three-step lightness ramp would have given — the three are told
  apart by hue alone, and a pack restating them is the calibration knob.
- **The single unsplit line keeps `--accent`** rather than taking slot 1, for the same reason § 5
  gives for the sparkline: one mark has no sibling to be told apart from.

**The colour-vision check, computed rather than asserted** (the verify list demanded it; sRGB
equivalents `#2279dc / #bc48bb / #009a9b`): on both grounds all three clear the lightness band, the
chroma floor, 3:1 contrast, and the normal-vision separation floor (worst pair ΔE 15.4) — but the
**slot-2 ↔ slot-3 pair sits in the CVD warn band** (deutan ΔE 6.1, tritan 4.8), which is legal
*only with secondary encoding*. No shipped mark wears two identity slots yet, so nothing renders
wrong today — the consequence lands on phase 3: **the § 2 legend is the required secondary encoding
for colour-vision-deficient readers, not optional polish**, and any chart drawing slots 2 and 3
together must have it. A pack restating the tokens re-runs this trade for its own ground.

## 2. The legend — SHIPPED

Required whenever a chart draws **two or more series**; never drawn for one (the title already
names a single series, and a one-swatch legend is noise). Spec:

- One row above the plot, inside the panel body; wraps rather than truncates; each key is a swatch
  in the mark's own shape — a short 2px line for line series, a small rect for bars — plus the
  label in ordinary text ink. Identity lives in the swatch, never in coloured text.
- Labels: the enum value's declared label for enum splits; the plugin's display name for source
  splits; "Other" for the fold.
- The legend is also the fold's disclosure: "+2 more" names what was folded.

Built as `legendFor` in `chart.ts` (the keys, pure and tested) plus a wrapping `<ul>` in
`ChartView.tsx` whose swatches wear the same `data-tone`/`data-series` on the same two classes as the
marks — so a swatch cannot drift to a different colour from the thing it stands for, and the
appearance pack restyles both at once. **Two deviations:**

- **The fold's disclosure is a count, not "+2 more".** All the folded series are equally anonymous —
  there is no first one for the rest to be "more" than — so the key reads `Other` for a single fold
  and `Other (3)` for several. The count is the disclosure the spec asked for; the phrasing is not.
- **It stands for the series that DREW, not the ones that exist.** `boardColumns` keeps a declared
  enum value whose column is empty (that is the board's rule and it is right there), but a series with
  no points draws no mark, and a swatch standing for nothing on screen is worse than no swatch.

## 3. Grouped bar (moved from the README small-items list) — SHIPPED

A bar whose series split comes from a **second** enum — the third chart shape by arithmetic but not
by config: it is `view.series` on `shape: 'bar'`, the key the codec already round-trips for lines.

- `chart.ts` already buckets per series for lines; the new arithmetic is only the grouped bar
  layout (per-category cluster, per-series offset, shared measure scale). Pure, in `chart.ts`,
  tested there.
- Editor/wizard offers the split only where **two enums exist** (the group-by enum and one more) —
  `chartAxisFields`-style derivation, unrepresentable over one enum.
- Series colours: declared tones when the splitting enum has them, else the series ramp. Legend
  required (≥2 series by construction).
- **Old-client behaviour is the acceptance test:** a definition carrying `series` on a bar renders
  in an old client as the ungrouped bar (it ignores the key today — verify, below), never as
  nothing.

Verified as claimed: the codec already round-tripped `series` and the old `buildBar` never read it, so
the codec diff is zero and an old client draws the ungrouped bar. The derivation is
`chartSeriesFields`, and the two axes' bucketing is `boardColumns` run twice with the intersection
taken by row identity — `boardColumns` has already decided which rows are in a series, and re-deriving
that from the cells would mean restating its three destinations. **Three deviations:**

- **The ungrouped bar became the one-group case of the same layout**, rather than the grouped bar
  being a second path. A cluster keeps the width one bar used to have and the series divide it, so an
  unsplit chart lays out byte-identically to before.
- **The bar's x-axis labels became ordinary `xTicks`**, the key the line plot already had. A cluster's
  label belongs to the cluster, not to one of its bars, and `ChartBar.labelled` could not say that.
  The view now draws x ticks the same way for both shapes and `labelled` is gone. `ChartBar` gained a
  `title` in exchange: the tooltip has to name the series as well as the category, and composing that
  string in the view would have been the view deciding something.
- **A split naming the category axis is dropped rather than drawn.** It would put exactly one bar in
  each cluster, which is the ungrouped chart with extra arithmetic. The editor does not offer it and
  `buildBar` ignores it, which is also what a definition written against a since-changed schema gets.

**One thing the grouped bar found and fixed everywhere:** a value **declared without a tone** was
being coloured `muted`, because `boardColumns` defaults every column's tone and so cannot tell "the
plugin said this means nothing good or bad" from "the plugin said nothing". Declaring that a value
*exists* is not declaring what it *means*, so an untoned declared value now takes an identity slot
like any other identity — otherwise every series of an untoned enum, which is most of them, drew in
the same faint ink and called it the plugin's decision. `chart.ts § declaredTone` reads the tone off
the field's declaration rather than off the built column, and lines got the fix with bars.

## 4. The source split: `source` as a panel-local field — SHIPPED

The prototype's "Activity, split by github vs linear" line cannot be expressed today: `series`
names a **field**, and a row's source is provenance, not a field. Rather than a special case in the
chart, make it a field where fields already grow:

- Mapped (multi-source) panels gain one built-in **panel-local field** `source` in
  `mapping.ts § panelFieldsFor`, beside the five roles and the user's invented fields: type `enum`,
  values = the panel's `panelSourceKey`s in query order, labels = the providing plugin's display
  name, tone none (identity, not status — the series ramp colours it).
- It is fed by the host's provenance stamp, not by any mapping row — the matrix does not show it as
  a mappable row, because there is nothing to answer; it is never absent and never user-fed.
- Because it is an ordinary panel-local enum, **everything downstream works uninvented**: `series`
  can name it (the split), `groupBy` can (a by-source board — legitimate), filters can (hide one
  source without unmapping it), the projection can (a Source column, which unifies the hardcoded
  multi-source "Source" column in `TableView.tsx` into the ordinary field path — delete the special
  case when this lands).
- Single-source panels do not grow the field; a split over one source is a no-op nobody should be
  offered.
- Id collision note: panel-local field ids live in the panel's own namespace (roles +
  `extraFields`), which never crosses the wire, so `source` cannot collide with a plugin's wire
  field id. It *can* collide with a user's invented field named `source`; reserve the id in the
  invented-field editor (reject it like a duplicate), which is one selector rule.

**Three deviations, all recorded at the code:**

- **The id reservation was not needed and was not built.** An invented field's id is *minted*
  (`newColumnId`), never typed — the person names a field's **label**, and the editor has no id box —
  so a user-invented `source` is already unreachable. The selector rule the sketch asked for would
  have guarded a state nothing can produce.
- **Labels are the plugin's id, not a display name.** `mapping.ts` lives in `dashboards-core`, which
  the node imports and which therefore cannot reach the client's collection registry where display
  names live. The id is what the provenance badge already falls back to, so the two agree. The
  collection is appended (`github · pulls-mine`) only where one plugin provides two of the panel's
  sources, which is the only case where the id alone is ambiguous. Pass a label down if it matters.
- **The list and the board keep their provenance badge and now exclude the field from the meta
  strip.** `TableView`'s hardcoded Source column is gone as the design asked, but a card's badge is a
  slot rather than a column — the same argument that already keeps the lead field and the grouped
  field out of the meta strip. Without the exclusion the field would print beside a badge that
  already says it.

## 5. The sparkline mark — SHIPPED, with measure-history

Built as part of the stat trend (`docs/dashboards.md § Trends`; arithmetic in
`dashboards-core/trend.ts`, marks in `StatView.tsx`): line + ~10% wash, end dot with a
surface-colour ring, no axes/grid/ticks, ≤ 32px and squeezed out before the number is, gaps drawn
as breaks. One deviation from this file's original spec, recorded here and in `measure-history.md`:
it wears **`--accent`, not series slot 1** — a sparkline is one mark with no sibling to be told
apart from, so identity colour has no job on it, and the ramp below no longer owns this mark. The
ramp's remaining consumers are multi-series charts only.

## Accessibility, all four

- Legend + `data-series` never replace the existing per-mark `<title>` tooltips and the
  `role="img"` label; the screen-reader data table (README small item) remains the real answer and
  none of this forecloses it.
- The fold ("Other") must appear in the legend and the tooltips, so nothing is visible in the
  render that is unnameable in text.

## Done when

- ~~The series ramp exists as theme tokens with the axis test updated, status tones are never applied
  to untoned identity series~~ Done — and every pack renders three distinguishable series on both
  light and dark themes, which is the one half still owed a look in the real app rather than a
  contrast calculation.
- ~~A two-enum collection can compose a grouped bar in editor and wizard; an old client draws it
  ungrouped; the codec diff is zero (the key already round-trips).~~ Done (§ 3). The wizard gets it
  for free: it and the sheet share `ViewOptions`.
- ~~A mapped panel can split a line, group a board, filter, and project by `source` with no
  chart-special-case code, and `TableView`'s hardcoded Source column is gone.~~ Done (§ 4).
- ~~Legends appear exactly when two or more series draw, with mark-shaped swatches and the fold
  disclosed.~~ Done (§ 2). Still owed a look in the real app rather than a calculation: the legend's
  wrap behaviour in a one-cell panel, which is the narrowest a chart is ever drawn.
- ~~The sparkline renders identically from both trend tiers, gaps preserved.~~ Done — shipped with
  measure-history (§ 5).

## Verify before building — all verified, results above

- `chart.ts` — `seriesSlot`, `buildChart`, the per-series bucketing the grouped bar reuses; whether
  `ChartView.tsx` currently ignores `series` on `shape: 'bar'` (the old-client acceptance claim
  rests on it). **It did**: `buildBar` never read the key, so the claim holds.
- `ui/tokenAxes.ts` + `styles/tokenAxes.test.ts` — the colour-axis token list and the disjointness
  test the ramp tokens must join; how plugin-contributed themes inherit defaults. **Done in phase 0**;
  phase 3 added no token.
- `mapping.ts § panelFieldsFor` — the one list all views walk, which `source` joins; and the
  invented-field id validation seam for reserving the id. **Joined; the reservation was unnecessary**
  (ids are minted, § 4).
- `TableView.tsx` — the provenance column special case slated for deletion. **Deleted.**
- The dark-mode steps of the chosen ramp values against both chart surfaces before committing hexes
  to packs — colour choices are computable; compute them. **Computed in phase 0** (§ 1).
