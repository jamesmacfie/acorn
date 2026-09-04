# Phase 5: what the reference apps do that we do not

Status: built 2026-09-04. Independent of the other phases; reads better after phase 1, because each
item is a keyboard rule and phase 1 is where the keyboard's mechanism settles. Three of the five items
rested on a false premise and three of the five are refused; what was found is at the bottom of this
file (§ What building it found).

## Goal

The handful of conventions yazi, rainfrog, lazygit, lazydocker, and gh-dash share that the terminal
client lacks, each taken up against [tui.md](../../tui.md) § Keys and focus and either added as a host
key for an existing intent or refused with the reason in [refused.md](./refused.md). Nothing is copied
because it exists elsewhere.

## Why this phase, and why it is small

The review's third question was what makes those apps feel the way they do, and the answer was mostly
architecture: a frame that is a function of state, focus and keymaps as plain data, layout as
constraints, one compiled process. Phases 1 to 4 take the first two. The third is parked and the
fourth is out of reach.

What is left is convention, and the client already has most of it. `j`/`k` and the arrows move,
`h`/`l` cross columns, `/` filters, `?` opens the cheat sheet, Escape climbs one level, Tab cycles
regions, the footer says what the keys do where they are, Home and End go to the ends. Those are
lazygit's and gh-dash's conventions and they arrived through the intent table, not by imitation.

So this phase is a short list, and each item has to earn its place the same way Tab did: a key the
desktop cannot spare, added to an intent that already exists, with the footer able to say it. A key
that would mean something no desktop intent means is a second keymap, and
[tui.md](../../tui.md) § What must never happen refuses it.

## The items

### Digits jump to rail panels

lazydocker binds `1` to `6` to its panels. The client has three rail panels (Menu, Browse, Tasks)
and a pane strip, and Tab cycles them in order. A digit is a direct jump, which is what a reader who
knows the screen wants after the first week.

Against the rules: `nextRegion` and `prevRegion` are the intents and a digit is not a "next". This
would be a new intent, `region:n`, or a host command bound outside the intent table the way `w`, `p`,
`n`, `q`, and `?` are in `apps/tui/src/keys/commandLayer.ts`. The command layer is the right home: the
digits fire only at the screen's own depth, are inert while typing, and the footer can list them. Take
it up as a command with a topology-supplied region list, so the keys module still names no chrome id.

### The cheat sheet is generated from the dispatcher

lazygit's `?` menu and gh-dash's `FullHelp()` are produced from the same table that dispatches, which
is why they cannot lie. `apps/tui/src/chrome/CheatSheet.tsx` is drawn from its own list.
`apps/tui/src/chrome/bindings.ts` already asks the engine `getActiveKeys` for the footer; the cheat
sheet should ask the same question for every tier and group the answer by tier with the sentence from
`apps/tui/src/keys/tiers.ts`. Then adding a binding adds a cheat sheet row, and removing one removes
it. A test asserts that every key the sheet shows is one the engine reports live at the depth the
sheet opened from.

### `g g` and `G`

vim's first and last, which yazi, rainfrog, and lazygit all take. The intents are `first` and `last`
and they have Home and End. `G` is a bare key and fits the host-key rule exactly as `j` and `k` do.
`g g` is a two-key sequence, and the engine supports sequences; the question is whether a sequence
belongs in a host that has never had one. The footer cannot show "g then g" in a cell. Take `G`;
refuse `g g` unless a second sequence turns up wanting the same mechanism.

### A visible context stack

lazygit's contexts are a stack and Escape pops it; the reader can feel the depth. The client's
scopes are a stack too (`pushScope` in `apps/tui/src/keys/regions.ts`) and Escape climbs the topology,
but nothing draws the depth. The footer already says where Escape goes ("esc back to Browse"). The
item is to check that sentence is present at every depth the reachability suite visits, including
inside a `Modal` inside a `Menu`, and to add the one word that is missing where it is. This is a test
first and a change second.

### Per-view help in the footer

gh-dash's `ShortHelp()` shows `?` and the footer's two or three hints; `FullHelp()` shows everything
for the view. The client's footer shows the bare keys' hints and its cheat sheet shows all. The gap is
that the footer does not say which *view* it is describing when a pane has several regions. Check
whether a reader on a `list-detail` pane can tell from the footer alone whether the keys are in the
list or the detail; if not, the region's label belongs at the footer's left, which
`apps/tui/src/chrome/Footer.tsx` can read from the store.

### What is refused here

- **Vim's `i`, `v`, `y`, `x` modes** (rainfrog). A modal editor grammar is a second keymap by
  definition. The kit has typing-exempt intents and a focused input types; that is the mode.
- **User-remappable keys from a file** (rainfrog, gh-dash, lazygit). The desktop has a keybinding
  contribution and settings for it; the terminal has no settings surface yet
  ([tui.md](../../tui.md) § Doors left open, the device preference store). When the store exists the
  bindings come through the same contribution, not through a second file format.
- **A which-key popup** (yazi). The footer is the which-key; a popup would need a place on a 24-row
  screen that the footer already occupies.

## Code touched

- `apps/tui/src/keys/commandLayer.ts`: the digit commands.
- `apps/tui/src/chrome/topology.ts`: the ordered region list for the digits.
- `apps/tui/src/chrome/CheatSheet.tsx`, `apps/tui/src/chrome/bindings.ts`: generation from the engine.
- `apps/tui/src/keys/install.ts`: `G` as a host key for `last`.
- `apps/tui/src/chrome/Footer.tsx`: the region label, if the check finds it missing.

## Tests

- `apps/tui/src/chrome/chrome.test.tsx`: a digit lands in the named region; `G` on a list lands on
  its last row and on a document scrolls to its end.
- A new case beside the cheat sheet: every row's key is live per the engine at the depth the sheet
  opened from, and every live bare key has a row.
- `apps/tui/src/reachability.test.tsx`: the footer's Escape hint is present at every depth visited.

## Docs owed

[tui.md](../../tui.md) § The five key groups for `G`; § Navigation for the digits; § The footer for
the region label and the generated cheat sheet. [command-palette-and-shortcuts.md](../../command-palette-and-shortcuts.md)
if the host-key table is listed there.

## Done when

- Each of the five items above is either in the tree with its test, or in [refused.md](./refused.md)
  with its reason.
- The footer's hints and the cheat sheet's rows come from one source.

## Verify before building

- Confirm the command layer still binds `w`, `p`, `n`, `q`, and `?` at the screen's depth only and
  that the digits are unbound anywhere in the app; grep the tiers and the layers.
- Confirm the cheat sheet is still drawn from its own list rather than from the engine. Read at
  `9e5d90ca`.
- Confirm the engine still supports key sequences before deciding on `g g`; if it does not, the item
  is refused without the argument.

## What building it found (2026-09-04)

Built on `8ac62b1d`, at the end of phase 4. The verify list found three of the five items resting on a
false premise, and the two that survived turned out to be the same bug seen from two sides.

### The verify list, item by item

**The command layer does bind `w`, `p`, `n`, `q` and `?` at the screen's depth only, and the digits
are unbound.** `commandLayer.ts` drops a bare key when `scopeDepth() > 1`, and those five are
registered from `chrome/Shell.tsx` through the shared keybinding registry. No bare digit is bound
anywhere under `apps/tui/src`. `ctrl+1` to `ctrl+9` are the `tabs` layout's, and they are chords.

**The cheat sheet was never drawn from its own list.** Read at `9e5d90ca` as the phase says: it calls
`activeHints()`, which is the footer's own function over `getActiveKeys`, and it has done since before
this programme. The premise is false and the item's goal — one source — already held. What was
missing was the test, so that is what this phase added.

**The engine does support sequences.** `@opentui/keymap` 0.5.9's README names branch-aware multi-key
sequences with `runExact`, `continueSequence`, a public pending-sequence API and a Neovim-style
timeout resolver, and gives `g` against `gg` as its own example. So `g g` had to be argued rather than
dismissed, and it is refused in [refused.md](./refused.md) on `g` itself.

### Item by item

**1. Digits that jump to rail panels: refused.** The phase argued for taking it. The argument does not
survive the region list being built per screen rather than fixed. Reasons in
[refused.md](./refused.md) § Digits that jump to a rail panel; the sentence a reader gets is in
[tui.md](../../tui.md) § Navigation.

**2. The cheat sheet from the dispatcher: already true, and now pinned.** `chrome.test.tsx` grew a
case that reads the drawn rows out of the dialog's frame and asserts they equal `activeHints()` taken
at the depth the sheet opened from, in order and in both directions. Grouping the sheet by tier was
not taken: the sheet is the footer's list in full, and a sheet that showed more than the footer would
need a second source, which is the one thing this item exists to prevent.

**3. `G`: already bound, and shared.** `intentKeys` has `first: ['home', 'g']` and
`last: ['end', 'shift+g']` at `9e5d90ca` and earlier, `apps/tui/src/input/parser.ts` spells a shifted
letter `shift+g` naming `intentKeys` as the reason, and pressing `G` on the Menu list moves the caret
to the last row. Nothing to add. The regression test is in `chrome.test.tsx` and the doc line is
[tui.md](../../tui.md) § The five key groups. `g g` is refused.

**4. A visible context stack: the hint was there and no reader ever saw it.** `esc back` is in
`activeHints()` at every depth we could reach — the screen, an open `MenuList`, a `Modal` — and the
drawn footer carried it at none of them. The footer cuts rather than wraps and `dismiss` sat last in
reading order, so on the browse screen at 80 cells the line ended at `ctrl+k command…`, and inside the
cheat sheet, where a reader most needs the way out, it ended at `ct…`. Two changes in
`chrome/bindings.ts`: `dismiss` moves to third, ahead of the commands, and the `h/l` hint takes the
`regionsInScope() > 1` guard Tab already had, because inside a scope the pair's `column` word is a
promise the region tier cannot keep. `reachability.test.tsx` now reads the drawn footer line after
every press on every surface and asserts it names Escape.

Three scopes deep is not asserted, because a reader cannot get there. Every dialog the shell opens is
opened by a bare key and the command layer drops its bare keys above the screen's depth, so `?` over
an open menu does nothing; a third scope needs a pane that draws a `Menu` inside its own `Modal`, and
no pane in the roster does. `chrome.test.tsx` covers the two that exist.

**5. Per-view help in the footer: refused after the check.** On a `list-detail` pane the footer already
reads differently in the two halves — `j/k move · enter open` in the list and `j/k scroll · h/l column`
in the detail — but only because the kinds differ, so two regions of one kind would read the same. The
answer is that the screen says it in place: both halves draw a titled frame, the caret is in one of
them, and below 80 cells only the focused half is drawn. Adding a label would take cells from a line
that had already run out. [refused.md](./refused.md) § The region's name at the footer's left.

### The tests

`pnpm --filter @acorn/tui test` on Node 24.11.0 with no flag: 561 passing, 2 skipped, and one failing,
which is another session's in-flight palette work and fails on its own commit. Three cases are new in
`apps/tui/src/chrome/chrome.test.tsx` — the cheat sheet against the engine, the way out at each depth,
and `G` and `g` beside End and Home — and one assertion is new in `apps/tui/src/reachability.test.tsx`,
inside `invariants()`, so it runs after every press on all eight surfaces.

**One thing found and not chased.** `chrome.test.tsx` § what the footer costs counts the collects one
Tab is allowed and its bound is eight. It counts nine when a `pr` fixture has run earlier in the same
file, so opening that pane leaves something registered that the next screen's Tab pays for once. It is
deterministic rather than flaky, it is not the footer's cache, and it is not what this phase is about,
so the new case sits after the count rather than in front of it and says why.
