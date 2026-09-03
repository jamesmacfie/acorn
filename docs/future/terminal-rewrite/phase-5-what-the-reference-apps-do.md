# Phase 5: what the reference apps do that we do not

Status: not started. Independent of the other phases; reads better after phase 1, because each item
is a keyboard rule and phase 1 is where the keyboard's mechanism settles.

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
