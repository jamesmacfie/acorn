# Terminal keyboard: the order of work

Plan, 2026-09-02. Nothing here is scheduled. Seven phases. Phases 0 to 3 are ordered and are the
core. Phases 4, 5, and 6 are independent of each other once 3 has landed. Each phase is a pull
request that leaves `pnpm --filter @acorn/tui test` and `pnpm lint` green, and each names the check
a reviewer runs to say it is done.

Every phase serves a rule in [design.md](./design.md). Every step names files. The line numbers are
from the baseline commit and are hints: read the file first.

Two things to know before starting any phase:

- **The tests can lie green.** Every rendering test is `describe.skipIf(!hasFfi)`. On a Node below
  26.4 the suite passes with zero rendering tests run. Check the test count in the summary line
  against the number in [testing.md](./testing.md) § The floor.
- **Do not add a settle step, a flag, or a priority number.** If a fix seems to need one, the fix is
  in the wrong place. Find the rule it breaks in `design.md` and fix that.

## Phase 0: pin the behaviour and see it

Serves observability and invariants 9 to 11. No production behaviour changes in this phase except
the trace flag.

**Why first.** Every later phase needs to prove it fixed something. Today there is no test that
shows any of the five symptoms, and no way to see what has focus in a running app. This phase writes
the failing tests as `it.fails`, so the suite stays green and each one flips to a real failure the
day a phase fixes its symptom. That flip is the signal to remove `.fails`.

**Steps.**

1. The trace flag. In `apps/tui/src/keys/install.ts`, when `process.env.ACORN_TUI_KEYS_TRACE` is
   set, register `engine.intercept('key-after', ctx => ...)` that appends one line per key to
   `keys.log` under the state directory (`design.md` § Observability has the format). Read region
   and scope from `keys/regions.ts` exports. Add a paragraph to `docs/tui.md § Keys and focus`.
2. The agreement assertion. In `apps/tui/src/reachability.test.tsx`, the `check` that runs after
   every press adds: `renderer.currentFocusedRenderable === focusedRenderable()`, and the node is
   not destroyed, is visible, and is `focusable`. The harness (`apps/tui/src/harness.tsx`) exposes
   the renderer already; if not, add it to `Screen`.
3. An overlay surface. Add to `SURFACES` a case that opens the palette (`ctrl+k` or the `?` cheat
   sheet) before the walk, so the walk runs with a `Modal` up. Expect it to fail on invariant 10
   today; mark that case `it.fails` until phase 2.
4. The six scenarios, each `it.fails`, in `apps/tui/src/symptoms.test.tsx` (new), so they are easy
   to find and easy to delete:
   - **A.** `renderFixture` with `pendingTrust` stubbed to one request (see how
     `plugins.test.tsx` stubs custody). Assert the caret is inside the dialog. Press `TAB`. Assert
     it still is. Press `RETURN` on "Run it". Assert the trust decision was recorded.
   - **B1.** Open any `Modal`, press `TAB`, assert
     `renderer.currentFocusedRenderable` is inside the modal.
   - **B2.** Render a `PtyRectangle` inside a `TabPanel`, focus it, press `RETURN` to enter, flip the
     tab signal from outside, press `j`. Assert the key reached the app (a list elsewhere moved), not
     the PTY.
   - **C.** Three presses: `l` on a file-tree leaf moves focus somewhere or bubbles to the column
     move; `l` on a `list-detail` list region lands in its detail region; `h` on the first tab of a
     `Sections` strip lands in the rail.
   - **D.** Hide the rail (`ctrl+b`) with no task active and press `TAB`. Assert either focus moved
     or the footer does not offer `tab`.
   - **E.** A non-virtual `Rows` of 30 items in a `list-detail` at 40 by 12: press `j` 20 times,
     assert the caret's row is on screen. A `Rows` of 10: press `PAGEDOWN`, assert the caret is on
     the last row. A `Rows` of 3: same.
5. Fix the F6 in `apps/tui/src/keys/keys.test.tsx:104`: press `TAB` as well as `F6`, and mark the
   Tab half `it.fails` until phase 2.

**Must not change.** Nothing in `keys/` or `kit/` beyond the trace registration.

**Done when.**

- `ACORN_TUI_KEYS_TRACE=1 pnpm --filter @acorn/tui dev`, press three keys, and `keys.log` has three
  lines with `reason=`, `focused=`, `region=`, `scope=`, `agree=`.
- `symptoms.test.tsx` exists with six `it.fails` cases and the suite is green.
- `reachability.test.tsx` runs the agreement check after every press on the existing seven surfaces
  and is green. If it is red on a surface, that is a real finding: record which and mark that
  surface's agreement check `.fails` with a comment naming the phase that owns it.

**Docs.** `docs/tui.md § Keys and focus` gains the trace paragraph. `docs/testing.md § Test layers`
names `symptoms.test.tsx` and says what `it.fails` means there.

## Phase 1: one truth

Serves rule 1.

**Why.** Every highlight-without-keys bug is a second writer of focus. Remove the writer.

**Steps.**

1. In `apps/tui/src/keys/regions.ts`, subscribe once to the renderer's `focused_renderable` event
   (the renderer is available from `main.tsx`; pass it to a new `installRegions(renderer)` called
   beside `installKeymap`, and have the test harnesses call it too). The listener writes
   `setFocusedNode`, `focused`, `group.last`, `group.lastIdentity`, and `lastByColumn`. Delete
   `noteFocus`.
2. `focusRenderable` returns `false` for a node that is not `focusable`, calls `focus()`, and
   returns `node.focused`. It no longer writes the signal. Every caller that ignored the return
   value now checks it or walks on.
3. Delete every other `setFocusedNode`: in `enter` (`regions.ts:449`), `holdInOverlay` (`:549`),
   `reviveFocus` (`:504`), `restoreFromOverlay` (`:563`). Delete `noteFocus` calls in
   `keys/collection.ts:70` and `:118`; they call `focusRenderable`.
4. Delete the mouse bridges: `keys/stops.ts:85` `onMouseDown`, `kit/scrolling.tsx:59-65`,
   `kit/showing.tsx:355-364`'s `focusRenderable(box)` (keep the wheel's window move). Native
   `autoFocus` plus the listener does this now.
5. `keys/stops.ts:63`: a disabled control stays `focusable`. `pressable`'s `activate` handler
   returns `false` when `off()`. Its `focused()` and the footer still read the signal.
6. `kit/rectangle.tsx:106`: `leave()` calls `focusRenderable(box)`.
7. `focusWithin` (`regions.ts:96`) may stay as the store's answer, but `rectangle.tsx:154` uses it
   too, so there is one idiom.
8. `keys/regions.test.ts`: the fake renderable gains `focusable` and a `focus()` that refuses when
   it is false, and the fake renderer emits `focused_renderable`. Any case that passed only because
   the fake accepted every focus is a case to rewrite, not delete.
9. `apps/tui/src/invariants.test.ts` adds three greps over `apps/tui/src`: `setFocusedNode(`
   appears once, `.focus()` appears once, and `focusable =` appears only inside a `ref=` callback or
   `regionFocus`.

**Must not change.** The kit's public props. The footer's words. The reachability walk order.

**Done when.**

- The three new greps in `invariants.test.ts` pass.
- The phase 0 agreement assertion is green on every surface with no `.fails` left on it.
- A new case in `kit/kit.test.tsx`: a mock left mouse-down on a `Button` (the test renderer's
  `mockMouse`, see `testing.md`) puts the caret on it and Enter presses it.
- Symptom B1's structural half: a `Button` disabled while focused can be blurred by pressing Tab.
  Add this to `kit.test.tsx` § every control is a stop.

**Docs.** `docs/tui.md § Focus regions`, the paragraph beginning "Focus is OpenTUI's focus and the
renderer owns it", is rewritten to say the store is a view of the renderer's event and mouse focus
needs no bridge.

## Phase 2: scopes

Serves rule 2.

**Why.** Tab leaks out of every modal because the swallow names keys from the wrong table. A scope
names nothing and leaks nothing.

**Steps.**

1. In `regions.ts`, add the `scopes` stack (`design.md` § Rule 2). Export `pushScope(box)` which
   records `{ box, returnTo: focused, returnIdentity }` and returns a pop function.
   `kit/grouping.tsx` `Modal` (`:326`) and `MenuList` (`:415`) call it from their box `ref` and pop in
   `onCleanup`, replacing `takeFocus`. Delete `takeFocus`, `overlays`, `openOverlay` (the
   `regions.ts` one), and `within` moves next to the scope code.
2. Scope every walk: `ordered()` filters groups to `inScope`; `stopsIn(box)` is unchanged (it is
   already scoped to a box) but `moveStop`'s choice of box is the region in scope; `moveColumn`
   considers columns in scope; `entryStop` is unchanged.
3. `keys/trap.ts`: delete `SWALLOWED`, `SWALLOW_PRIORITY`, and the second layer. `trapKeys` registers
   `dismiss` only. `overlayKeys` stays for the palette.
4. `keys/commandLayer.ts:90`: add `&& scopeDepth() === 1` to the `active` gate for bare keys.
5. `chrome/bindings.ts`: the `region` hint's probe also requires more than one region in scope, so
   the footer stops offering `tab` inside a dialog.
6. `regions.ts` `settleFocus`: for this phase only, the `holdInOverlay` step reads the top scope's
   box instead of `overlays`. Phase 3 replaces the pass.
7. `chrome/state.ts` is untouched. It answers "what does the shell draw".

**Must not change.** Escape still closes the top overlay first. The palette's own arrows still work
while typing. `Inbox`'s single-`Rows` rule may now be relaxed, but leave it until a reader asks.

**Done when.**

- Symptom A and B1 scenarios in `symptoms.test.tsx` flip. Remove `.fails`.
- The overlay surface in `reachability.test.tsx` is green without `.fails`: every stop inside the
  modal reachable, none outside it reached, invariant 10 after every press.
- `keys.test.tsx:104`'s Tab half flips.
- `grep -n SWALLOW apps/tui/src` finds nothing.
- The tier table test (phase 4 writes it; if phase 2 lands first, add the test here) has no
  swallow row.

**Docs.** `docs/tui.md § Traps` is rewritten: a trap is a scope, one layer for `dismiss`, why a
swallow cannot work. The trust prompt sentence in § Focus regions goes.

## Phase 3: one landing rule

Serves rule 3.

**Why.** The settle pass is the state machine nobody wrote down, and it has just gained a seventh
step. Replace it with a question.

**Steps.**

1. Write `ensureFocus()` as in `design.md` § Rule 3. `scheduleSettle` queues it on the one
   microtask. `pushScope` and its pop call `scheduleSettle`. `enter` calls it too, at its end, so a
   walk that lands wrong is corrected in the same turn.
2. Delete `provisional`, `overlayClosing`, `reviveFocus`, `openScreen`, `claimProvisional`,
   `restoreFromOverlay`, `holdInOverlay`, and `revealFocus` as separate steps. The frame-landing
   rule ("never remembered") becomes: `enter` does not write `group.last` when the target is the
   frame; the listener in phase 1 must skip it too (compare `node === group.box`).
3. Frames are `focusable` from `registerRegion`. Delete `regions.ts:447` and `:547`. `markParent`'s
   `node.focusable = true` (`:134`) moves to the `Tabs` ref.
4. One walk. `walkStops(from, delta, { within, wrap })` replaces `moveStop`, `moveFocusFrom`, and
   `stops.ts` `moveStopIn`. `wrap: false` walls; the callers that used `moveFocusFrom` for
   "bubble at an edge" pass `wrap: false` and return the boolean.
5. Rewrite `keys/regions.test.ts` as properties over `ensureFocus`: for any tree, after any
   sequence of mounts, unmounts, scope pushes and pops, focus is live, visible, focusable, and in
   the top scope; a frame landing is never remembered; a region that grows a stop while holding
   its frame lands on the stop at the next pass; a popped scope returns to what it recorded, by
   identity when the row was replaced. Keep the fakes from phase 1.
6. `apps/tui/src/kit/showing.tsx:320` and `:361`: the virtual container no longer flips
   `focusable`. It is `focusable` from its ref, and `stopsIn` already treats a collection as one stop.

**Must not change.** One `queueMicrotask` in `keys/`, none in `kit/`. The reconciler's `nextTick`
deferral. `pickOnEnter` for Menu and Browse.

**Done when.**

- `wc -l apps/tui/src/keys/regions.ts` is under 450.
- `grep -c queueMicrotask apps/tui/src/keys/*.ts` is 1 and `invariants.test.ts` still says so.
- `grep -n "focusable = " apps/tui/src/keys` finds only `registerRegion`.
- Symptom D3's half of the D scenario flips. Reachability green at both sizes
  (`ACORN_TUI_WIDE=1`), including the overlay surface.
- `browseStay.test.tsx`, `browseSlow.test.tsx`, and `workspaceFocus.test.tsx` still pass; they are
  the tests that pinned each of the six settle steps, and they are the regression net here.

**Docs.** `docs/tui.md § Focus regions`, the "One deferred decision" paragraphs, are replaced by the
four-step landing rule and its one question. The sentence "there were six of these" goes.

## Phase 4: honest cross keys and integer columns

Serves rule 4. Independent of 5 and 6.

**Why.** Left and Right are five owners deep and two of them lie. Symptom C.

**Steps.**

1. `keys/tiers.ts` with the ten names from `design.md` § Rule 4. Replace every literal priority in
   `apps/tui/src` with a name. `keys/tiers.test.ts` renders each surface, reads the engine's layers,
   and fails on two layers at one tier binding one key with the same target mode and target.
2. The two tier-5 Escapes: `chrome/Shell.tsx:195`'s layer goes; `keys/install.ts`'s `dismiss`
   handler calls `dismissNotifications()` first and falls to `moveBack()` when it returns `false`.
3. `column` becomes `x`. `RegionOptions.column` is replaced by `x?: number` (default 1); the rail's
   three `regionFocus` calls in `chrome/Rail.tsx` and topology pass `x: 0`. `moveColumn(delta)`
   finds the nearest `x` in scope in that direction. `lastByColumn` keys by `x`.
4. Layouts declare side-by-side regions: `layouts/ListDetail.tsx` passes `x: 2` for detail when
   wide; `layouts/DocumentSplit.tsx` and `layouts/StackSplit.tsx` pass `x: 2` for their second region
   when the axis is horizontal.
5. Honest claims. `kit/grouping.tsx:210`: `step()` returns `false` at an edge. `Tabs` gains a `k`/Up
   binding that walks to the previous stop and bubbles at an edge, matching the contract table.
   `packages/client-core/src/kit/keys/collectionIntents.ts:43`: `onExpand` may return `boolean |
   void`; `expand`/`collapse` return `options.onExpand(...) ?? true`. The TUI's tree rows (the
   `Rows` with `onExpand` in `plugins/editor/src/client/FileTree.tsx` and `plugins/changes`) return
   `false` on a leaf.
6. `chrome/bindings.ts` `WORDS`: `cross` for `parent` stays `tab`; for `item` in a vertical list
   with no `onExpand` it is `column` rather than `fold`. Check the table against
   `design.md` § The contract.

**Must not change.** Column wrap stays refused: Left in the rail does nothing. The topology's
first-crossing rule for the pane strip.

**Done when.**

- The three C scenarios flip.
- `keys/tiers.test.ts` passes on every surface.
- New in `reachability.test.tsx`: after the walk, for each focused kind met, press `l` and `h` and
  assert the footer's `cross` word's action (`fold` changed a tree row or bubbled; `tab` changed a
  tab; `column` moved to a different `x`). This is invariant 8 by pressing, and invariant 11 for the
  cross keys.
- Desktop: `pnpm --filter @acorn/client-core test` green. There is no desktop test on
  `collectionIntents.ts` today; add one, `packages/client-core/src/kit/keys/collectionIntents.test.ts` (new),
  covering `expand` on a leaf with a boolean `onExpand` and with a `void` one.

**Docs.** `docs/tui.md § The five key groups` cross row and § Focus regions' column paragraph.
`docs/command-palette-and-shortcuts.md § Focus and typing` gains the `onExpand` return value.

## Phase 5: viewports

Serves rule 5. Independent of 4 and 6.

**Why.** Eight of nine plugin lists have no viewport. Symptom E.

**Steps.**

1. Replace the five `overflow="scroll"` sites: `layouts/ListDetail.tsx:76` becomes
   `<ScrollViewport>`; `kit/showing.tsx:574` (`Log`) and `:899` (`DiffPane`) the same;
   `kit/grouping.tsx:564` and `:577` pass through to `ScrollViewport` when `scroll` is set.
   `chrome/Rail.tsx:152` Browse gets `scroll`. `kit/scrolling.tsx` is the one file that may spell
   `overflow="scroll"`.
2. `collectionIntents.ts:109-110`: `pageNext` and `pagePrev` clamp and return `false` at the edge.
   Home and End are already first and last.
3. Post-layout reveal. `ScrollViewport` subscribes to `focused_renderable`; when the node is inside
   its box, it calls `scrollChildIntoView(node.id)` on the renderer's next frame event (check the
   event name in `@opentui/core`; `design.md` § Verify before building). Unsubscribe in `onCleanup`.
4. `invariants.test.ts`: `overflow="scroll"` appears only in `kit/scrolling.tsx`.

**Must not change.** `Rows virtual` keeps its own window. `browseLong.test.tsx` stays green.

**Done when.**

- The E scenarios flip.
- `kit/scrolling.test.tsx` gains: a non-virtual `Rows` of 30 in a `ListDetail` list at 40 by 12,
  caret on screen after 20 Downs; PageDown in a 3-row and a 10-row list lands on the last row and a
  second PageDown bubbles; a freshly mounted list entered by Tab has its caret on screen on the
  next frame.
- Desktop: the new `collectionIntents.test.ts` covers the clamp. `pnpm --filter @acorn/client-core
  test` green.

**Docs.** `docs/tui.md § Scrolling viewports`: the rule "anything that can exceed its box is a
viewport", the clamp, and the second reveal.

## Phase 6: the rectangle, the docs, and retiring the folder

Serves the rectangle section of `design.md` and closes the programme. Independent of 4 and 5.

**Steps.**

1. `kit/rectangle.tsx`: `inside` becomes derived from `box.focused` and an `armed` flag set by Enter
   and cleared on the renderer's `blurred` event for the box. The intercept checks
   `box.focused && armed()`. Delete the module-level count; the footer reads a derived
   `enteredRectangle()` from the same flags.
2. Symptom B2 flips.
3. Rewrite `docs/tui.md § Keys and focus` end to end against the shipped code: § Focus regions,
   § Traps, § Scrolling viewports, § The Rectangle contract, § The invariants (eleven rows). Rewrite
   the TUI paragraph in `docs/command-palette-and-shortcuts.md § Focus and typing`.
4. Delete `docs/future/terminal-keyboard/` and add its retired-folder paragraph to
   `docs/future/README.md`, saying where each rule went.
5. Delete `symptoms.test.tsx` if every case has been promoted to a permanent test in `keys.test.tsx`,
   `kit.test.tsx`, or `scrolling.test.tsx`; otherwise promote the rest first.

**Done when.**

- No `.fails` remains in `apps/tui/src`.
- `pnpm lint`, `pnpm --filter @acorn/tui test` with `ACORN_TUI_WIDE=1`, and the docs path checker
  in `tools/arch` are green.
- A manual pass in a real terminal (and one that does not negotiate the kitty protocol, for
  Shift+Tab): the trust prompt at boot, Tab inside it, Escape out; enter a PTY, open the palette
  with a chord, close it, type in the PTY; a `list-detail` pane with Left, Right, and PageDown; the
  editor's file tree with Right on a leaf.

## Reading the phases as a whole

| Phase | Rule | Symptoms it flips | Files it centres on | Shared code |
| --- | --- | --- | --- | --- |
| 0 | observability, invariants | none (writes them) | `install.ts`, `reachability.test.tsx`, `symptoms.test.tsx` | no |
| 1 | 1 | B (structural half) | `regions.ts`, `stops.ts`, `collection.ts`, `rectangle.tsx`, `regions.test.ts` | no |
| 2 | 2 | A, B1, D1 | `regions.ts`, `trap.ts`, `grouping.tsx`, `commandLayer.ts`, `bindings.ts` | no |
| 3 | 3 | D3 | `regions.ts`, `stops.ts`, `showing.tsx`, `regions.test.ts` | no |
| 4 | 4 | C | `tiers.ts`, `regions.ts`, `install.ts`, layouts, `grouping.tsx`, `bindings.ts` | `collectionIntents.ts` |
| 5 | 5 | E | `scrolling.tsx`, `showing.tsx`, `grouping.tsx`, `ListDetail.tsx`, `Rail.tsx` | `collectionIntents.ts` |
| 6 | rectangle, docs | B2 | `rectangle.tsx`, `docs/tui.md` | no |
