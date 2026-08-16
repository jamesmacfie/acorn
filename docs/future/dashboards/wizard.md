# The panel wizard

**Unbuilt — phase 2 of the accepted redesign**, behind the phase-0 foundation below
(`README.md § build order`). Panel *creation* becomes a staged wizard with a live preview. Panel
*editing* keeps the existing single-sheet generated editor unchanged. Two presentations, one truth:
both are views over the same pure derivations in `editor.ts`/`compose.ts`/`mapping.ts`/`chart.ts`,
and the wizard adds **no second implementation** of any rule the sheet already embodies.

The problem it solves: today "Add panel" opens one long form and the panel is first seen after
saving. Nobody can pick a view by looking at it, the field vocabulary is invisible until rows
arrive, and the cold-schema case is a paragraph of prose. The wizard makes the panel visible while
it is being composed.

## Invariants inherited, not re-decided

- **Views are derived, not chosen from a menu.** The wizard renders all five view cards but enables
  only what `viewsForSchema` passes — the change is that a failing card now says *why* (below).
- **The editor issues no fetch of its own.** The live preview reads exclusively from the node's
  query cache (`cachedCollectionPage`, reactive via `createCollectionCacheRevision`). Whether an
  editor may *run* a collection is the run-once-and-pin question (`dynamic-collections.md`) and it
  is answered there, once, with a person pressing a button. The wizard's Data step is where that
  button will *live* when it ships; the wizard does not pre-answer it.
- **Nothing persists until the final step commits.** The wizard holds a draft `PanelDefinition` in
  memory; "Add" runs `savePanel` + `placePanel` + a rect (below) in one commit. Escape or closing
  the modal at any step discards the draft entirely — the same "nothing was written" promise the
  grid gesture makes.
- **Selectors stay data-aware and `normalizePanel` stays the backstop.** Staging the questions does
  not move validation into the UI: a bad choice is still unofferable first, dropped by
  `normalizePanel` second.

## Phase 0 foundation (no pixels in this list)

Pure functions, all in the modules vitest can reach (components here are untestable — node vitest,
no Solid plugin). Build and test these before any wizard component exists:

1. **`viewAvailability(schema)`** in `editor.ts`, superseding call sites of bare `viewsForSchema`
   where a reason is wanted:

   ```ts
   type ViewReasonCode = 'ok' | 'needs-enum' | 'needs-axis' | 'cold-schema'
   type ViewAvailability = { kind: PanelViewKind; ok: boolean; reason: ViewReasonCode }
   viewAvailability(schema: PluginCollectionSchema | undefined): ViewAvailability[]
   ```

   Reason is a **code, not copy** — the component owns the words ("Board needs a status-like
   field — this data has none."), the function owns the truth, and the test asserts codes.
   `cold-schema` is the whole-schema-absent case (a self-describing collection never read on this
   device): stat/list/table are `ok`, board/chart carry `cold-schema`. The predicates themselves are
   `VIEW_REQUIRES`/`chartShapesFor`, reused not restated.

2. **`collectionCardMeta(contribution, nodeId)`** in `editor.ts` or `compose.ts` — everything the
   picker gallery shows, derived with **zero new wire data**:
   - field chips: `{ name, type }` per declared or answered field (via `schemaOf`), capped at the
     schema's own 24;
   - the declared `refresh`, if any;
   - cached-page facts from `cachedCollectionPage`: row count and answered-at, both optional —
     absent renders as "not read on this device yet", which is the cold case being honest;
   - `self-describing: boolean` (no static schema declared).
   The plugin's brand mark comes from the existing `brand:<pluginId>` registry, name fallback as
   everywhere.

3. **`sizePresets(kind)`** in `layout.ts` beside `sizeFor` — the Place step's S/M/L choices, as
   widths over the existing per-kind defaults: S = `minW` for the kind, M = `sizeFor(kind).w`,
   L = 12; height always `sizeFor(kind).h`. Presets are a *starting rect*, not stored config: the
   committed rect goes through the ordinary `firstFit` + `setLayoutAt` path and is thereafter just
   geometry. No persisted shape learns about presets.

4. **Draft assembly** — `panelForCollection` already builds the minimal draft; confirm it composes
   with `defaultPanelTitle`, `defaultGroupBy`, `defaultChartView` and `suggestFieldMapping` such
   that every wizard step is expressible as "edit the draft, re-derive". If any step needs logic
   that does not exist as a pure function, add it to the pure module first.

## The four steps

One `Modal` (size `wide`), three regions: a step rail (left), the step body (centre), the live
preview (right, always present). On narrow windows the rail collapses to a horizontal strip and the
preview drops below the body — same content, no alternate markup path.

**Step 1 — Data.** The picker becomes a gallery of collection cards: brand mark, name, providing
plugin, field chips with type glyphs, refresh cadence, cached-rows count or the not-yet-read notice
(`collectionCardMeta`). Declared params render here (the existing `ParamInput` controls), since a
param changes what the rows *are*. A second source may be added from this step (the union), which
makes the panel mapped; the mapping matrix itself lives in step 3. Suggested starter panels, if that
refusal's revisit ever lands, appear here as accept-into-your-own cards — noted so the seat is
known, not built.

**Step 2 — View.** Five cards, always all five, each with a small schematic figure; disabled cards
carry the `viewAvailability` reason as visible copy. Choosing `chart` pre-infers shape and axes
exactly as the sheet does today (`defaultChartView`). The preview redraws on selection — this is
the step the wizard exists for: picking a view by looking at it.

**Step 3 — Shape.** Filters (sentence grammar: field · type-legal operator · type-drawn value),
group-by, measure (stat/chart), chart shape and axes, sort, limit, the projection, and — for mapped
panels — the columns/value/fields matrix, all the existing selectors re-hosted. Every change
re-derives the preview. Nothing on this step may be reachable when its gate fails (a measure picker
with no number fields offers count only, exactly as today).

**Step 4 — Place.** Title (auto-filled by `defaultPanelTitle` until first keystroke — the existing
rule), size preset (S/M/L footprint drawn as a 12-cell strip), surface (Home, task pane; future
surfaces render disabled with their gate named). Commit = `savePanel`, `placePanel(scope, id)`,
rect = preset width first-fitted via the ordinary `normalize` path. Per-panel refresh stays on this
step too (it is about the placed, polling panel, not the shape of the data).

Steps are navigable back and forth; a step whose prerequisites vanished (source removed in step 1
after a view chosen in step 2) re-derives rather than blocks — `retainShaping` and view fallback
already define what survives.

## The live preview

- Rendered by the **real view components** over the real compose/shaping/mapping pipeline — not a
  thumbnail renderer. There is exactly one way to draw a panel; the preview is that way, in a
  fixed-size slot.
- Data: cached rows only, reactive to the cache revision, so an answer landing while the wizard is
  open fills the preview in place (the sheet's existing behaviour, made visible).
- Cold case: the preview slot renders the explanatory empty state ("this collection describes
  itself in the answer…"), and step 2's board/chart cards carry `cold-schema` reasons. When
  run-once-and-pin ships, its Run button replaces this notice in step 1 — the seat is the Data
  step, the behaviour is `dynamic-collections.md`'s.
- The preview panel is **not** wired to polling, row actions, or the risk strip: it is a rendering
  of the draft, not a live panel. Row actions render inert.

## Entry points

- "Add panel" (Home ghost button, pane header) opens the wizard.
- "Edit" on a placed panel opens the existing sheet, unchanged. The sheet remains able to do
  everything the wizard can — the wizard is a staging of creation, not a capability tier.
- The wizard footer carries a quiet "Open in editor" escape for people who want the whole sheet at
  once; it converts the draft to the sheet with nothing lost. (Cheap because both edit the same
  draft shape; if it proves unused, delete it.)

## Accessibility

- The step rail is a list with `aria-current="step"`; step bodies are labelled regions; focus moves
  to the step heading on navigation.
- The preview updates silently (no live region — it changes on every keystroke and would be noise);
  the view cards' disabled reasons are plain text, not tooltips.
- Everything the sheet's selectors already guarantee (native controls, `<Index>` for input lists)
  carries over by reuse.

## Done when

- A panel can be composed end-to-end without ever having existed: data → view (with visible reasons
  on what the data cannot support) → shape → place, with the preview live at every step, and the
  committed panel is byte-identical to what the sheet would have produced for the same choices.
- Escape at any step writes nothing.
- The cold collection composes to the three ungated views with the notice in place, and a cache
  answer arriving mid-wizard unlocks board/chart cards reactively.
- A mapped (two-source) panel can be fully composed in the wizard, including invented fields.
- `viewAvailability`, `collectionCardMeta` and `sizePresets` are unit-tested in node vitest; no new
  logic lives only in a component.
- The edit sheet's behaviour and tests are untouched.

## Verify before building

- `editor.ts` (`schemaOf`, `viewsFor`, `retainShaping`, `normalizePanel`), `compose.ts`
  (`collectionsForPicker`, `defaultPanelTitle`), `chart.ts` (`defaultChartView`), `mapping.ts`
  (`suggestFieldMapping`) — the derivations the steps re-host, and whether their signatures still
  match this file.
- `PanelEditor.tsx` — the current sheet's field order and gating, which step 3 must reproduce
  exactly; and `Modal` sizes (`wide` assumed to exist).
- `cachedCollectionPage` / `createCollectionCacheRevision` in `data.ts` — the preview's only data
  path.
- `Picker.tsx` — whether the gallery replaces it here or wraps it; the filter-input behaviour
  should survive either way.
- The vitest constraint (node, no Solid plugin) still holds — it is why the foundation list is all
  pure functions.
