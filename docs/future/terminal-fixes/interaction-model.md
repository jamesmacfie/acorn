# Interaction model: the focus and navigation programme

Design 2026-09-01. Not built, except step 1, which shipped with the analysis. Paths are hints;
verify before building. Everything here is independent of the rendering fix and of each other
except where the sequencing says otherwise.

## What a reader should be able to do

The five behaviours the shell owes, stated as the spec this programme fills:

1. Focus Browse and the first item is highlighted **and shown** in the main pane.
2. Moving the caret in Browse changes the main pane (select-on-move; this works).
3. Choosing a different Menu source swaps Browse and the main pane (shipped — see step 1).
4. `right` moves the keys from the left column into the main pane; `left` comes home. Today only
   Tab reaches it, three presses from Browse, one of them landing on an empty frame.
5. Whatever navigation the main pane has — GitHub's `Sections` strip, lists inside a detail —
   works once the keys are there (works; the strip's edge behaviour changes in step 4 below).

## The selection contract, restated once

Selection **is the URL path** plus one signal for which source is showing. A browse row navigates;
the detail region reads `useParams()`. There is no shared model object and the TUI router has no
query string. This is sufficient for every current source and stays the rule — see refused.md for
when it stops being sufficient and what the seam looks like then.

## The steps, in landing order

### 1. The Menu must be able to leave a source — SHIPPED

`chrome/routing.ts`'s rail-follows-path effect now reads the selection with `untrack`, so it
answers path changes only. `browse.test.tsx` § "lets the Menu leave a source" is the regression.

### 2. The pane strip stops being a dead Tab stop

`Shell.tsx` registers the strip's focus region unconditionally at order −50, but the strip renders
under `<Show when={model.task()}>` and `model.task()` is null whenever a source is selected — so
Tab lands on an empty frame, the exact hole the shell's own comments say it avoids. Move the `ref`
that registers the region (and its layer-40 j/k bindings) onto a box **inside** the `Show`;
`regionFocus`'s cleanup already unregisters. If focus is in the strip when the task closes, the
cycle recovers at index 0. Test: with a source selected, a full Tab cycle never lands on an empty
frame.

### 3. Descriptor sources keep their region identity

`chromeRegister.ts` calls the supplied source-panel factory inline on every
`syncChromeContributions()` (distribution, trust decisions, `plugins:changed`), and the TUI factory
mints fresh `list`/`detail` closures each time — `<Dynamic>` sees a new component and remounts,
taking caret, scroll window and query subscriptions with it. Fix at the TUI's own seam
(`apps/tui/src/plugins/SourcePanel.tsx`): memoise the returned panel per `(pluginId, descriptorId)`
and route descriptor changes through a signal so props update in place. Solid props are getters, so
`descriptor={current().descriptor}` re-renders without a remount. The desktop's `component:`
closure has the same churn; nothing forces fixing it now, note it and leave it. Test: two factory
calls return reference-equal `regions.list`; a changed label still re-renders.

### 4. Spatial `right`/`left` between the left column and the main pane

Two columns, not a second cycle: rail (Menu −130, Browse −120, Tasks −110) and main (strip −50,
source or layout regions ≥ 0). `right` moves rail → main, `left` moves main → rail, no wrap — at an
edge the key returns false and dies at the command layer. Tab keeps the full cycle.

**Spend no new keys.** `right`/`l` and `left`/`h` are already the `expand`/`collapse` intents, and
the key layers sort by priority descending: Sections' strip (45), collections (40), ListDetail's
narrow switch (30), the region tier (5). A vertical list with no `onExpand` already returns false
and lets the key bubble; so the spatial move is simply the region tier's interpretation of the
bubbled intent — the escalation `keys/install.ts`'s header already names. A tree that can expand
answers first, by construction, and Tab is always there.

Two changes make the ladder true:

- **Sections yields at its edges.** `step()` in `kit/grouping.tsx` wraps today, so it consumes
  `h`/`l` unconditionally and its own comment ("a collection answers first") is wrong under the
  real sort order — 45 outranks 40. Stop wrapping: at the first tab `h` returns false, at the last
  `l` returns false. That is what lets `h` from GitHub's detail come home to Browse, and it gives a
  tree inside a tab its first chance at these keys. TUI-local; the desktop's ARIA tab strip keeps
  wrapping.
- **Column membership is declared, not derived.** `regionFocus(ref, order, { column: 'rail' })` on
  the three rail panels; everything else defaults to `'main'`. `moveColumn(±1)` in
  `keys/regions.ts` targets the destination column's last-focused group (a module-level
  `lastByColumn`, written in `noteFocus`/`enter`), falling back to the first group with order ≥ 0
  for main and the first by order for rail. Bind at layer 5 in `keys/install.ts` with the
  `!isTyping()` guard — `left`/`right` inside an input move the cursor, not the region.

Test shape (`spatial.test.tsx`): caret on a Browse row, `l` → caret in the main panel; `h` at the
strip's first tab → back on the *same* Browse row (edge-yield and column memory in one assertion).

### 5. Entering Browse selects the row it lands on

`enter()` focuses the first stop but never writes collection state, so `onSelect` — which is
`navigate` — does not fire and the main pane stays empty until the first `j`/`k`. The
"off the row and back on it" dance in `browse.test.tsx` is this defect encoded.

Make it a property of the region, declared by the chrome — not of `Rows` (a kit prop would ripple
into every plugin list) and not universal (Tab transiting the Menu must not hijack the screen):
`regionFocus(..., { pickOnEnter: true })`, passed by the Browse panel only. `markItem` gains an
optional handler (`WeakMap<Renderable, () => void>`); after `enter()` lands on a marked item in a
`pickOnEnter` group — and after a `claimIfProvisional` into one, for the list that arrives late —
invoke it. The collection side registers `goTo(key)` as that handler, and select-on-move does the
rest. Re-entering re-navigates to the remembered row, which is idempotent.

Depends on step 1 (a navigation on entry must not snap the source back) and shares files with
step 4. Then delete the j/k dance from `browse.test.tsx` § browsing a source and let the entry
itself make the assertion.

### 6. Component-only sources stop wasting the Browse panel

Only github declares `regions`; docker and agents are `component`-only, so for them Browse draws
"Nothing to list here." and is a focus stop with nothing in it — the same hole as step 2. Now: keep
the frame (layout stability; Browse is the growing panel) but make its region registration
conditional on `!!source()?.regions?.list`, so Tab and `right` skip it. Direction: migrate docker
and agents to `regions` with github as the template — both are a list beside a detail at heart —
one source per change. Home and fleet stay unregistered on this host; the trigger for revisiting is
a TUI reader needing a landing surface that is not a task.

## Verify before building

- `apps/tui/src/keys/regions.ts` — `enter`, `firstStop`, `claimIfProvisional`, the order constants;
  step 4 and 5 both edit here, land them in that order.
- `apps/tui/src/keys/install.ts` — the layer table and the `!isTyping()` gate for bare keys.
- `apps/tui/src/kit/grouping.tsx` — `step()` and `MAIN_COLUMN_AT`; fix the stale precedence comment
  while there.
- `apps/tui/src/chrome/Shell.tsx` and `Rail.tsx` — region registrations and orders.
- `packages/client-core/src/host/chrome/chromeRegister.ts` — the factory call site for step 3.
